import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ParsedChunk, ModelOption } from '@agentim/shared'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'
import { createLogger } from '../lib/logger.js'
import type { Codex, Thread, ThreadItem, SandboxMode, WebSearchMode } from '@openai/codex-sdk'

const log = createLogger('Codex')

// Prompt-based permission simulation for daemon mode.
// The Codex SDK does not expose a permission-request callback (unlike Claude Code's
// canUseTool), so we instruct the model itself to ask for approval before executing
// dangerous operations. The agentic loop naturally pauses: the model outputs a
// plan description (text turn), the user responds, and the model proceeds or stops.
const CODEX_PERMISSION_PREAMBLE = [
  '[AgentIM Permission Policy]',
  'Before executing any of the following operations, you MUST first describe your',
  'complete plan in a text message and wait for the user to approve:',
  '- Modifying, creating, or deleting files',
  '- Running shell commands that change system state (install, build, deploy, git push)',
  '- Accessing external services or APIs',
  '',
  'Workflow: (1) Describe exactly what you plan to do, (2) End your message and',
  'wait for the user to reply with approval, (3) Only execute after receiving',
  'explicit approval. If the user declines, suggest alternatives without executing.',
  '',
  'Read-only operations (reading files, searching, listing) do not require approval.',
].join('\n')

const CODEX_PLAN_MODE_PREAMBLE = [
  '[AgentIM Plan Mode]',
  'You are currently in PLAN MODE. In this mode:',
  '- Analyze the task and present a detailed plan of what you would do',
  '- DO NOT execute any commands, modify files, or make changes',
  '- Describe each step clearly and wait for the user to approve',
  '- Only after receiving explicit approval should you proceed with execution',
  '- If the user asks you to proceed, exit plan mode and execute the plan',
].join('\n')

const CODEX_AGENTIM_CONTEXT_PREAMBLE = [
  '[AgentIM Room Communication]',
  'You are connected to an AgentIM room with other agents and users.',
  'If you have MCP tools available (send_message, request_reply, get_room_messages,',
  'list_room_members), use them to communicate with other agents directly.',
  'If not, mention other agents by name using @AgentName format in your messages.',
  'The room system will route your message to the mentioned agent.',
].join('\n')

/** Per-room state for Codex adapter. */
interface CodexRoomState {
  thread?: Thread
  threadId?: string | null
  modelOverride?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  sandboxMode?: SandboxMode
  webSearchMode?: WebSearchMode
  networkAccess?: boolean
  planMode: boolean
}

const DEFAULT_ROOM_KEY = '__global__'

export class CodexAdapter extends BaseAgentAdapter {
  private codex?: Codex
  /** Whether prompt-based permission simulation is active for this adapter. */
  private readonly promptPermission: boolean

  // Per-room state
  private roomStates = new Map<string, CodexRoomState>()
  private currentRoomId?: string

  // Model info loaded from Codex CLI cache (~/.codex/models_cache.json)
  private cachedModelInfo: ModelOption[] = []

  // Promise for the async model fetch so waitForModels() can await it
  private fetchModelsPromise: Promise<void> | null = null

  // Abort controller for the current turn
  private turnAbort?: AbortController

  constructor(opts: AdapterOptions) {
    super(opts)
    // Enable prompt-based permissions when interactive mode is requested but the
    // SDK cannot support it natively (i.e. daemon mode / no TTY).
    this.promptPermission = this.permissionLevel === 'interactive' && !process.stdin.isTTY
    // Fetch model list from OpenAI API (async, non-blocking)
    this.fetchModelsPromise = this.fetchModels().catch(() => {})
  }

  private getRoomState(roomId?: string): CodexRoomState {
    const key = roomId ?? DEFAULT_ROOM_KEY
    let state = this.roomStates.get(key)
    if (!state) {
      state = { planMode: false }
      this.roomStates.set(key, state)
    }
    return state
  }

  get type() {
    return 'codex' as const
  }

  private async ensureCodex() {
    if (!this.codex) {
      const { Codex: CodexClass } = await import('@openai/codex-sdk')
      const apiKey = this.env.OPENAI_API_KEY || this.env.CODEX_API_KEY || undefined
      const opts: {
        apiKey?: string
        baseUrl?: string
        env?: Record<string, string>
      } = {
        baseUrl: this.env.OPENAI_BASE_URL || undefined,
      }
      // The Codex SDK's envOverride completely REPLACES process.env for the
      // child process (not merged).  We must merge manually so the subprocess
      // inherits system env vars (PATH, HOME, etc.) while our overrides
      // (HOME for subscription isolation, API keys) take precedence.
      if (Object.keys(this.env).length > 0) {
        const merged: Record<string, string> = {}
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) merged[key] = value
        }
        Object.assign(merged, this.env)
        opts.env = merged
      }
      // Only pass apiKey if present — omitting it lets SDK discover auth from $HOME/.codex/auth.json
      if (apiKey) opts.apiKey = apiKey
      this.codex = new CodexClass(opts)
    }
  }

  /** Whether the current credentials are OAuth (subscription) rather than an API key. */
  private get isOAuthMode(): boolean {
    // Subscription via HOME override: no API keys set, HOME points to isolated dir
    return !this.env.OPENAI_API_KEY && !this.env.CODEX_API_KEY
  }

  /** Shared regex filter for Codex-relevant models. */
  private static readonly MODEL_FILTER = /codex|^gpt-[5-9]/i

  /** Path to the Codex CLI local model cache file. */
  private static readonly MODEL_CACHE_PATH = join(homedir(), '.codex', 'models_cache.json')

  /** Model entry from the /v1/chat/models (ChatGPT subscription) endpoint. */
  private static parseChatModels(
    body: unknown,
  ): Array<{ slug: string; display_name?: string; priority?: number }> {
    const data = body as {
      models?: Array<{
        slug: string
        display_name?: string
        visibility?: string
        priority?: number
      }>
    }
    if (!Array.isArray(data?.models)) return []
    return data.models.filter(
      (m) => m.visibility === 'list' && CodexAdapter.MODEL_FILTER.test(m.slug),
    )
  }

  /** Convert chat/cache model entries into ModelOption[]. */
  private static chatModelsToOptions(
    models: Array<{ slug: string; display_name?: string; priority?: number }>,
  ): ModelOption[] {
    return models
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((m) => ({
        value: m.slug,
        displayName: m.display_name || CodexAdapter.prettifyModelId(m.slug),
      }))
  }

  /** "gpt-5.3-codex" → "GPT 5.3 Codex" */
  private static prettifyModelId(id: string): string {
    return id
      .split('-')
      .map((s) => (s === 'gpt' ? 'GPT' : s.charAt(0).toUpperCase() + s.slice(1)))
      .join(' ')
  }

  /**
   * Fetch models from the ChatGPT subscription endpoint (/v1/chat/models).
   * This endpoint accepts OAuth tokens that would get 403 on /v1/models.
   * On success, also writes the result to the local cache file so that
   * subsequent startups can use it even when the network is unavailable.
   */
  private async fetchChatModels(token: string): Promise<ModelOption[]> {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/models', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        log.warn(`/v1/chat/models fetch failed: HTTP ${res.status}`)
        return []
      }
      const body = await res.json()
      const models = CodexAdapter.parseChatModels(body)
      if (models.length === 0) return []
      // Persist to local cache so future startups can use it offline
      try {
        writeFileSync(CodexAdapter.MODEL_CACHE_PATH, JSON.stringify({ models }, null, 2))
      } catch {
        // Non-critical: cache write failure is fine
      }
      log.info(`Fetched ${models.length} Codex models from /v1/chat/models`)
      return CodexAdapter.chatModelsToOptions(models)
    } catch (err) {
      log.warn(`/v1/chat/models fetch error: ${(err as Error).message}`)
      return []
    }
  }

  /**
   * Fetch models from the standard /v1/models endpoint (works with API keys).
   */
  private async fetchApiModels(token: string): Promise<ModelOption[]> {
    const baseUrl = (this.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const url = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        log.warn(`/v1/models fetch failed: HTTP ${res.status}`)
        return []
      }
      const body = (await res.json()) as { data?: Array<{ id: string }> }
      if (!body.data) return []
      const ids = body.data
        .filter((m) => CodexAdapter.MODEL_FILTER.test(m.id))
        .map((m) => m.id)
        .sort()
        .reverse()
      if (ids.length === 0) return []
      log.info(`Fetched ${ids.length} Codex models from /v1/models`)
      return ids.map((id) => ({
        value: id,
        displayName: CodexAdapter.prettifyModelId(id),
      }))
    } catch (err) {
      log.warn(`/v1/models fetch error: ${(err as Error).message}`)
      return []
    }
  }

  /**
   * Read model list from the Codex CLI local cache (~/.codex/models_cache.json).
   */
  private readModelCache(): ModelOption[] {
    try {
      const raw = readFileSync(CodexAdapter.MODEL_CACHE_PATH, 'utf-8')
      const models = CodexAdapter.parseChatModels(JSON.parse(raw))
      if (models.length === 0) return []
      log.info(`Loaded ${models.length} Codex models from CLI cache`)
      return CodexAdapter.chatModelsToOptions(models)
    } catch {
      return []
    }
  }

  /**
   * Last-resort: run `codex --version` to trigger CLI startup side effects
   * that may refresh the model cache, then re-read the cache file.
   */
  private tryRefreshCacheViaCli(): ModelOption[] {
    try {
      // Check if codex binary is available
      const bin = existsSync('/usr/local/bin/codex')
        ? '/usr/local/bin/codex'
        : existsSync('/usr/bin/codex')
          ? '/usr/bin/codex'
          : 'codex'
      execFileSync(bin, ['--version'], { timeout: 5_000, stdio: 'ignore' })
      // Re-read cache after CLI execution
      const models = this.readModelCache()
      if (models.length > 0) {
        log.info(`Refreshed ${models.length} Codex models via CLI cache regeneration`)
      }
      return models
    } catch {
      log.debug?.('codex CLI not available or failed to refresh model cache')
      return []
    }
  }

  /**
   * Read OAuth access_token from the HOME-overridden auth.json file.
   * In subscription mode, HOME points to a per-credential isolated directory.
   */
  private readOAuthTokenFromFile(): string | undefined {
    const homeBase = this.env.HOME || homedir()
    const authPath = join(homeBase, '.codex', 'auth.json')
    try {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8')) as {
        access_token?: string
        tokens?: { access_token?: string }
      }
      return auth.tokens?.access_token || auth.access_token || undefined
    } catch {
      return undefined
    }
  }

  /**
   * Fetch available models using a multi-strategy approach:
   *
   * **OAuth (subscription) mode** — HOME overridden to per-credential dir:
   *   1. Local cache file (~/.codex/models_cache.json, primary — fastest)
   *   2. /v1/chat/models with token from auth.json (ChatGPT subscription endpoint)
   *   3. Run `codex` CLI to regenerate cache (last resort)
   *
   * **API key mode** — OPENAI_API_KEY set:
   *   1. /v1/models (standard OpenAI endpoint, primary)
   *   2. Local cache file (fallback)
   */
  private async fetchModels(): Promise<void> {
    const token = this.env.CODEX_API_KEY || this.env.OPENAI_API_KEY

    if (this.isOAuthMode) {
      // OAuth mode: prioritize local cache (no network needed), then try API
      const cached = this.readModelCache()
      if (cached.length > 0) {
        this.cachedModelInfo = cached
        return
      }
      // Try reading token from the HOME-overridden auth.json
      const oauthToken = this.readOAuthTokenFromFile()
      if (oauthToken) {
        const chatModels = await this.fetchChatModels(oauthToken)
        if (chatModels.length > 0) {
          this.cachedModelInfo = chatModels
          return
        }
        const apiModels = await this.fetchApiModels(oauthToken)
        if (apiModels.length > 0) {
          this.cachedModelInfo = apiModels
          return
        }
      }
    } else if (token) {
      // API key mode: prefer /v1/models
      const apiModels = await this.fetchApiModels(token)
      if (apiModels.length > 0) {
        this.cachedModelInfo = apiModels
        return
      }
      // Fallback: read local cache file
      const cached = this.readModelCache()
      if (cached.length > 0) {
        this.cachedModelInfo = cached
        return
      }
    } else {
      log.warn('No API key or OAuth credentials — skipping API model fetch')
    }

    // Last resort: try running codex CLI to regenerate cache
    const cliModels = this.tryRefreshCacheViaCli()
    if (cliModels.length > 0) {
      this.cachedModelInfo = cliModels
    }
  }

  /**
   * Ensure a thread exists. On first call, starts a new thread because the
   * Codex SDK only provides the threadId via the 'thread.started' event
   * emitted during the first runStreamed() call. After that, threadId is
   * captured and subsequent calls (e.g. after stop()) will use resumeThread()
   * to continue the same conversation.
   *
   * Limitation: the SDK does not support pre-setting a threadId before the
   * first query, so true cross-process session resumption is not possible
   * unless the caller persists and injects threadId externally.
   */
  private async ensureThread(roomId?: string) {
    await this.ensureCodex()
    const rs = this.getRoomState(roomId)
    if (!rs.thread) {
      // Codex SDK limitation: no permission-request callback or event in its API.
      // The only control is `approvalPolicy`:
      //   - 'never'      = auto-approve all tool executions
      //   - 'on-request' = SDK prompts interactively via stdin (TTY only)
      //
      // In daemon mode (no TTY), 'on-request' blocks indefinitely on stdin, so we
      // always fall back to 'never'. To compensate, prompt-based permission
      // simulation injects instructions into the model prompt that make the AI ask
      // for user approval through the chat before executing dangerous operations.
      const isDaemonMode = !process.stdin.isTTY
      const approvalPolicy =
        this.permissionLevel === 'bypass' || isDaemonMode ? 'never' : 'on-request'
      if (isDaemonMode && this.permissionLevel !== 'bypass') {
        if (this.promptPermission) {
          log.info(
            [
              '',
              '╔══════════════════════════════════════════════════════════════════╗',
              '║  ℹ  CODEX DAEMON MODE — PROMPT-BASED PERMISSION ACTIVE         ║',
              '╠══════════════════════════════════════════════════════════════════╣',
              '║  No TTY detected. The Codex SDK auto-approves tool executions   ║',
              '║  (approvalPolicy="never"), but prompt-based permission is       ║',
              '║  enabled: the model is instructed to describe its plan and wait  ║',
              '║  for your approval before executing operations.                 ║',
              '║                                                                 ║',
              '║  Note: This is a soft safeguard — the model generally follows   ║',
              '║  the instruction but compliance is not guaranteed by the SDK.   ║',
              '╚══════════════════════════════════════════════════════════════════╝',
              '',
            ].join('\n'),
          )
        } else {
          log.warn(
            [
              '',
              '╔══════════════════════════════════════════════════════════════════╗',
              '║  ⚠  CODEX DAEMON MODE — AUTO-APPROVE ENABLED                   ║',
              '╠══════════════════════════════════════════════════════════════════╣',
              '║  No TTY detected. The Codex SDK requires interactive stdin for  ║',
              '║  permission prompts, so approvalPolicy has been set to "never"  ║',
              '║  (all tool executions will be auto-approved).                   ║',
              '║                                                                 ║',
              '║  To suppress this warning, launch the gateway with:             ║',
              '║    --permission-level bypass                                    ║',
              '╚══════════════════════════════════════════════════════════════════╝',
              '',
            ].join('\n'),
          )
        }
      }
      const threadOpts: {
        model?: string
        modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
        workingDirectory?: string
        approvalPolicy?: 'never' | 'on-request'
        sandboxMode?: SandboxMode
        networkAccessEnabled?: boolean
        webSearchMode?: WebSearchMode
        additionalDirectories?: string[]
      } = {
        workingDirectory: this.workingDirectory,
        approvalPolicy,
      }
      if (rs.modelOverride || this.env.CODEX_MODEL) {
        threadOpts.model = rs.modelOverride || this.env.CODEX_MODEL
      }
      if (rs.reasoningEffort) {
        threadOpts.modelReasoningEffort = rs.reasoningEffort
      }
      if (rs.sandboxMode) {
        threadOpts.sandboxMode = rs.sandboxMode
      }
      if (rs.networkAccess !== undefined) {
        threadOpts.networkAccessEnabled = rs.networkAccess
      }
      if (rs.webSearchMode) {
        threadOpts.webSearchMode = rs.webSearchMode
      }
      if (this.env.CODEX_ADDITIONAL_DIRS) {
        threadOpts.additionalDirectories = this.env.CODEX_ADDITIONAL_DIRS.split(':')
      }
      if (rs.threadId) {
        rs.thread = this.codex!.resumeThread(rs.threadId, threadOpts)
        log.info(`Resumed Codex thread: ${rs.threadId}`)
      } else {
        rs.thread = this.codex!.startThread(threadOpts)
        log.info(`Started new Codex thread (approvalPolicy=${approvalPolicy})`)
      }
    }
  }

  /**
   * Override buildPrompt to inject the permission preamble when prompt-based
   * permission simulation is active. The preamble instructs the model to
   * describe its plan and wait for user approval before executing operations.
   */
  protected override buildPrompt(content: string, context?: MessageContext): string {
    const base = super.buildPrompt(content, context)
    const parts: string[] = []
    if (this.getRoomState(this.currentRoomId).planMode) {
      parts.push(CODEX_PLAN_MODE_PREAMBLE)
    }
    if (this.promptPermission) {
      parts.push(CODEX_PERMISSION_PREAMBLE)
    }
    // Add AgentIM context for agent-to-agent awareness
    if (this.mcpContext) {
      parts.push(CODEX_AGENTIM_CONTEXT_PREAMBLE)
    }
    if (parts.length === 0) return base
    return `${parts.join('\n\n')}\n\n${base}`
  }

  async sendMessage(
    content: string,
    onChunk: ChunkCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
    context?: MessageContext,
  ) {
    if (this.isRunning) {
      onError('Agent is already processing a message')
      return
    }

    this.isRunning = true
    this.currentRoomId = context?.roomId
    let fullContent = ''

    try {
      const rs = this.getRoomState(context?.roomId)
      await this.ensureThread(context?.roomId)
      const prompt = this.buildPrompt(content, context)
      const abortController = new AbortController()
      this.turnAbort = abortController
      const { events } = await rs.thread!.runStreamed(prompt, {
        signal: abortController.signal,
      })

      for await (const event of events) {
        // Capture thread ID
        if (event.type === 'thread.started') {
          rs.threadId = event.thread_id
          log.info(`Codex thread ID: ${rs.threadId}`)
          continue
        }

        // Note: Codex SDK handles permissions via approvalPolicy parameter.
        // In daemon mode with interactive permission level, the model is prompted
        // to describe its plan and wait for user approval (see CODEX_PERMISSION_PREAMBLE).

        if (event.type === 'turn.completed') {
          if (event.usage) {
            this.accumulatedInputTokens += event.usage.input_tokens ?? 0
            this.accumulatedOutputTokens += event.usage.output_tokens ?? 0
            this.accumulatedCacheReadTokens += event.usage.cached_input_tokens ?? 0
          }
          continue
        }

        if (event.type === 'item.completed') {
          const chunks = this.mapItemToChunks(event.item)
          for (const chunk of chunks) {
            if (chunk.type === 'text') fullContent += chunk.content
            onChunk(chunk)
          }
        }

        if (event.type === 'turn.failed') {
          this.isRunning = false
          onError(event.error.message)
          return
        }

        if (event.type === 'error') {
          this.isRunning = false
          onError(event.message)
          return
        }
      }

      this.isRunning = false
      this.turnAbort = undefined
      onComplete(fullContent)
    } catch (err: unknown) {
      this.isRunning = false
      this.turnAbort = undefined
      if ((err as Error).name === 'AbortError') {
        onComplete(fullContent || 'Interrupted')
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`Codex SDK error: ${msg}`)
        onError(msg)
      }
    }
  }

  private mapItemToChunks(item: ThreadItem): ParsedChunk[] {
    switch (item.type) {
      case 'agent_message':
        return [{ type: 'text', content: item.text }]
      case 'reasoning':
        return [{ type: 'thinking', content: item.text }]
      case 'command_execution':
        return [
          {
            type: 'tool_use',
            content: `$ ${item.command}\n${item.aggregated_output}`,
            metadata: { toolName: 'command', toolId: item.id },
          },
        ]
      case 'file_change':
        return [
          {
            type: 'tool_result',
            content: item.changes.map((c) => `${c.kind}: ${c.path}`).join('\n'),
            metadata: { toolId: item.id },
          },
        ]
      case 'mcp_tool_call':
        return [
          {
            type: 'tool_use',
            content: JSON.stringify(
              { server: item.server, tool: item.tool, arguments: item.arguments },
              null,
              2,
            ),
            metadata: { toolName: `${item.server}:${item.tool}`, toolId: item.id },
          },
        ]
      case 'web_search':
        return [
          {
            type: 'tool_use',
            content: `Web search: ${item.query}`,
            metadata: { toolName: 'web_search', toolId: item.id },
          },
        ]
      case 'error':
        return [{ type: 'error', content: item.message }]
      case 'todo_list':
        return [
          {
            type: 'text',
            content: item.items.map((t) => `${t.completed ? '✅' : '⬜'} ${t.text}`).join('\n'),
          },
        ]
      default:
        return []
    }
  }

  override getSlashCommands(): Array<{
    name: string
    description: string
    usage: string
    source: 'builtin' | 'skill'
  }> {
    return [
      {
        name: 'clear',
        description: 'Reset conversation thread',
        usage: '/clear',
        source: 'builtin',
      },
      {
        name: 'model',
        description: 'Switch model',
        usage: '/model [name]',
        source: 'builtin',
      },
      {
        name: 'effort',
        description: 'Set reasoning effort: minimal, low, medium, high, xhigh',
        usage: '/effort [level]',
        source: 'builtin',
      },
      {
        name: 'cost',
        description: 'Show token usage',
        usage: '/cost',
        source: 'builtin',
      },
      {
        name: 'sandbox',
        description: 'Set sandbox mode: read-only, workspace-write, danger-full-access',
        usage: '/sandbox [mode]',
        source: 'builtin',
      },
      {
        name: 'websearch',
        description: 'Set web search mode: disabled, cached, live',
        usage: '/websearch [mode]',
        source: 'builtin',
      },
      {
        name: 'network',
        description: 'Toggle network access',
        usage: '/network [on|off]',
        source: 'builtin',
      },
      {
        name: 'plan',
        description: 'Toggle plan mode (read-only)',
        usage: '/plan [on|off]',
        source: 'builtin',
      },
    ]
  }

  override getModel(roomId?: string): string | undefined {
    return this.getRoomState(roomId).modelOverride || this.env.CODEX_MODEL || 'codex-mini-latest'
  }

  // Models are fetched dynamically from the OpenAI /v1/models API.
  // Returns empty arrays until the async fetch completes.
  override getAvailableModels(): string[] {
    return this.cachedModelInfo.map((m) => m.value)
  }

  override getAvailableModelInfo(): ModelOption[] {
    return this.cachedModelInfo
  }

  override async waitForModels(timeoutMs = 5000): Promise<void> {
    if (!this.fetchModelsPromise) return
    await Promise.race([
      this.fetchModelsPromise,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      }),
    ])
  }

  override getPlanMode(roomId?: string): boolean {
    return this.getRoomState(roomId).planMode
  }

  override getAvailableEffortLevels(): string[] {
    return ['minimal', 'low', 'medium', 'high', 'xhigh']
  }

  override getEffortLevel(roomId?: string): string | undefined {
    return this.getRoomState(roomId).reasoningEffort
  }

  override async handleSlashCommand(
    command: string,
    args: string,
    roomId?: string,
  ): Promise<{ success: boolean; message?: string }> {
    const rs = this.getRoomState(roomId)
    switch (command) {
      case 'clear': {
        rs.thread = undefined
        rs.threadId = undefined
        return { success: true, message: 'Thread cleared' }
      }
      case 'model': {
        const name = args.trim()
        if (!name) {
          const current = this.getModel(roomId) ?? '(default)'
          return {
            success: true,
            message: `Current model: ${current}\nUse /model <name> to switch`,
          }
        }
        rs.modelOverride = name
        // Force thread recreation to apply the new model
        rs.thread = undefined
        return { success: true, message: `Model set to: ${name} (thread will restart)` }
      }
      case 'effort': {
        const level = args.trim().toLowerCase()
        if (!level) {
          return {
            success: true,
            message: `Reasoning effort: ${rs.reasoningEffort ?? '(default)'}\nOptions: minimal, low, medium, high, xhigh`,
          }
        }
        const valid = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
        if (!valid.includes(level as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid effort level: ${level}\nOptions: minimal, low, medium, high, xhigh`,
          }
        }
        rs.reasoningEffort = level as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
        // Force thread recreation to apply the new effort level
        rs.thread = undefined
        return { success: true, message: `Reasoning effort set to: ${level} (thread will restart)` }
      }
      case 'cost': {
        const summary = this.getCostSummary()
        const lines = [
          'Session Token Usage',
          `  Input tokens:  ${summary.inputTokens.toLocaleString()}`,
          `  Output tokens: ${summary.outputTokens.toLocaleString()}`,
          `  Cache read:    ${summary.cacheReadTokens.toLocaleString()}`,
        ]
        return { success: true, message: lines.join('\n') }
      }
      case 'sandbox': {
        const mode = args.trim().toLowerCase()
        if (!mode) {
          return {
            success: true,
            message: `Sandbox mode: ${rs.sandboxMode ?? '(default)'}\nOptions: read-only, workspace-write, danger-full-access`,
          }
        }
        const valid = ['read-only', 'workspace-write', 'danger-full-access'] as const
        if (!valid.includes(mode as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid sandbox mode: ${mode}\nOptions: read-only, workspace-write, danger-full-access`,
          }
        }
        rs.sandboxMode = mode as SandboxMode
        rs.thread = undefined
        return { success: true, message: `Sandbox set to: ${mode} (thread will restart)` }
      }
      case 'websearch': {
        const mode = args.trim().toLowerCase()
        if (!mode) {
          return {
            success: true,
            message: `Web search mode: ${rs.webSearchMode ?? '(default)'}\nOptions: disabled, cached, live`,
          }
        }
        const valid = ['disabled', 'cached', 'live'] as const
        if (!valid.includes(mode as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid web search mode: ${mode}\nOptions: disabled, cached, live`,
          }
        }
        rs.webSearchMode = mode as WebSearchMode
        rs.thread = undefined
        return { success: true, message: `Web search set to: ${mode} (thread will restart)` }
      }
      case 'network': {
        const arg = args.trim().toLowerCase()
        if (arg === 'on' || arg === 'true' || arg === '1') {
          rs.networkAccess = true
        } else if (arg === 'off' || arg === 'false' || arg === '0') {
          rs.networkAccess = false
        } else if (!arg) {
          return {
            success: true,
            message: `Network access: ${rs.networkAccess === undefined ? '(default)' : rs.networkAccess ? 'enabled' : 'disabled'}\nUse /network on|off`,
          }
        } else {
          rs.networkAccess = !rs.networkAccess
        }
        rs.thread = undefined
        return {
          success: true,
          message: `Network access: ${rs.networkAccess ? 'enabled' : 'disabled'} (thread will restart)`,
        }
      }
      case 'plan': {
        const arg = args.trim().toLowerCase()
        if (arg === 'on' || arg === 'true' || arg === '1') {
          rs.planMode = true
        } else if (arg === 'off' || arg === 'false' || arg === '0') {
          rs.planMode = false
        } else {
          rs.planMode = !rs.planMode
        }
        return {
          success: true,
          message: `Plan mode: ${rs.planMode ? 'enabled' : 'disabled'}`,
        }
      }
      default:
        return { success: false, message: `Unknown command: ${command}` }
    }
  }

  stop() {
    log.info('Codex stop requested')
    this.isRunning = false
    // Use AbortSignal to cancel the running turn, then discard the thread
    if (this.turnAbort) {
      this.turnAbort.abort()
      this.turnAbort = undefined
    }
    // threadId is preserved so ensureThread() can resume the conversation
    const rs = this.getRoomState(this.currentRoomId)
    rs.thread = undefined
  }

  dispose() {
    this.isRunning = false
    if (this.turnAbort) {
      this.turnAbort.abort()
      this.turnAbort = undefined
    }
    this.roomStates.clear()
    this.codex = undefined
  }
}
