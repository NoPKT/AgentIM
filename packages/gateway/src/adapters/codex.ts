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

const CODEX_AGENTIM_CONTEXT_PREAMBLE = [
  '[AgentIM Room Communication]',
  'You are connected to an AgentIM room with other agents and users.',
  'If you have MCP tools available (send_message, request_reply, get_room_messages,',
  'list_room_members), use them to communicate with other agents directly.',
  'If not, mention other agents by name using @AgentName format in your messages.',
  'The room system will route your message to the mentioned agent.',
].join('\n')

export class CodexAdapter extends BaseAgentAdapter {
  private codex?: Codex
  private thread?: Thread
  private threadId?: string | null
  /** Whether prompt-based permission simulation is active for this adapter. */
  private readonly promptPermission: boolean

  // Runtime settings configurable via slash commands
  private modelOverride?: string
  private reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  private sandboxMode?: SandboxMode
  private webSearchMode?: WebSearchMode
  private networkAccess?: boolean

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

  get type() {
    return 'codex' as const
  }

  private async ensureCodex() {
    if (!this.codex) {
      const { Codex: CodexClass } = await import('@openai/codex-sdk')
      this.codex = new CodexClass({
        apiKey: this.env.OPENAI_API_KEY || this.env.CODEX_API_KEY || undefined,
        baseUrl: this.env.OPENAI_BASE_URL || undefined,
        env: Object.keys(this.env).length > 0 ? (this.env as Record<string, string>) : undefined,
      })
    }
  }

  /**
   * Fetch available models from the OpenAI /v1/models endpoint.
   * Credentials (API key or OAuth token) are already resolved into
   * env by agentConfigToEnv() at connection time.
   */
  private async fetchModels(): Promise<void> {
    const token = this.env.CODEX_API_KEY || this.env.OPENAI_API_KEY
    if (!token) {
      log.warn('No CODEX_API_KEY or OPENAI_API_KEY — cannot fetch model list')
      return
    }

    const baseUrl = (this.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const url = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        log.warn(`Model list fetch failed: HTTP ${res.status}`)
        return
      }
      const body = (await res.json()) as { data?: Array<{ id: string }> }
      if (!body.data) return
      const models = body.data
        .filter((m) => /^gpt-.*codex/i.test(m.id))
        .map((m) => m.id)
        .sort()
        .reverse()
      if (models.length === 0) {
        log.warn('Model list fetched but no matching models found')
        return
      }
      this.cachedModelInfo = models.map((id) => ({
        value: id,
        displayName: id
          .split('-')
          .map((s) => (s === 'gpt' ? 'GPT' : s.charAt(0).toUpperCase() + s.slice(1)))
          .join(' '),
      }))
      log.info(`Fetched ${this.cachedModelInfo.length} Codex models from API`)
    } catch (err) {
      log.warn(`Model list fetch error: ${(err as Error).message}`)
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
  private async ensureThread() {
    await this.ensureCodex()
    if (!this.thread) {
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
      if (this.modelOverride || this.env.CODEX_MODEL) {
        threadOpts.model = this.modelOverride || this.env.CODEX_MODEL
      }
      if (this.reasoningEffort) {
        threadOpts.modelReasoningEffort = this.reasoningEffort
      }
      if (this.sandboxMode) {
        threadOpts.sandboxMode = this.sandboxMode
      }
      if (this.networkAccess !== undefined) {
        threadOpts.networkAccessEnabled = this.networkAccess
      }
      if (this.webSearchMode) {
        threadOpts.webSearchMode = this.webSearchMode
      }
      if (this.env.CODEX_ADDITIONAL_DIRS) {
        threadOpts.additionalDirectories = this.env.CODEX_ADDITIONAL_DIRS.split(':')
      }
      if (this.threadId) {
        this.thread = this.codex!.resumeThread(this.threadId, threadOpts)
        log.info(`Resumed Codex thread: ${this.threadId}`)
      } else {
        this.thread = this.codex!.startThread(threadOpts)
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
    let fullContent = ''

    try {
      await this.ensureThread()
      const prompt = this.buildPrompt(content, context)
      const abortController = new AbortController()
      this.turnAbort = abortController
      const { events } = await this.thread!.runStreamed(prompt, {
        signal: abortController.signal,
      })

      for await (const event of events) {
        // Capture thread ID
        if (event.type === 'thread.started') {
          this.threadId = event.thread_id
          log.info(`Codex thread ID: ${this.threadId}`)
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
    ]
  }

  override getModel(): string | undefined {
    return this.modelOverride || this.env.CODEX_MODEL || 'codex-mini-latest'
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

  override getAvailableEffortLevels(): string[] {
    return ['minimal', 'low', 'medium', 'high', 'xhigh']
  }

  override getEffortLevel(): string | undefined {
    return this.reasoningEffort
  }

  override async handleSlashCommand(
    command: string,
    args: string,
  ): Promise<{ success: boolean; message?: string }> {
    switch (command) {
      case 'clear': {
        this.thread = undefined
        this.threadId = undefined
        return { success: true, message: 'Thread cleared' }
      }
      case 'model': {
        const name = args.trim()
        if (!name) {
          const current = this.getModel() ?? '(default)'
          return {
            success: true,
            message: `Current model: ${current}\nUse /model <name> to switch`,
          }
        }
        this.modelOverride = name
        // Force thread recreation to apply the new model
        this.thread = undefined
        return { success: true, message: `Model set to: ${name} (thread will restart)` }
      }
      case 'effort': {
        const level = args.trim().toLowerCase()
        if (!level) {
          return {
            success: true,
            message: `Reasoning effort: ${this.reasoningEffort ?? '(default)'}\nOptions: minimal, low, medium, high, xhigh`,
          }
        }
        const valid = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
        if (!valid.includes(level as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid effort level: ${level}\nOptions: minimal, low, medium, high, xhigh`,
          }
        }
        this.reasoningEffort = level as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
        // Force thread recreation to apply the new effort level
        this.thread = undefined
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
            message: `Sandbox mode: ${this.sandboxMode ?? '(default)'}\nOptions: read-only, workspace-write, danger-full-access`,
          }
        }
        const valid = ['read-only', 'workspace-write', 'danger-full-access'] as const
        if (!valid.includes(mode as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid sandbox mode: ${mode}\nOptions: read-only, workspace-write, danger-full-access`,
          }
        }
        this.sandboxMode = mode as SandboxMode
        this.thread = undefined
        return { success: true, message: `Sandbox set to: ${mode} (thread will restart)` }
      }
      case 'websearch': {
        const mode = args.trim().toLowerCase()
        if (!mode) {
          return {
            success: true,
            message: `Web search mode: ${this.webSearchMode ?? '(default)'}\nOptions: disabled, cached, live`,
          }
        }
        const valid = ['disabled', 'cached', 'live'] as const
        if (!valid.includes(mode as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid web search mode: ${mode}\nOptions: disabled, cached, live`,
          }
        }
        this.webSearchMode = mode as WebSearchMode
        this.thread = undefined
        return { success: true, message: `Web search set to: ${mode} (thread will restart)` }
      }
      case 'network': {
        const arg = args.trim().toLowerCase()
        if (arg === 'on' || arg === 'true' || arg === '1') {
          this.networkAccess = true
        } else if (arg === 'off' || arg === 'false' || arg === '0') {
          this.networkAccess = false
        } else if (!arg) {
          return {
            success: true,
            message: `Network access: ${this.networkAccess === undefined ? '(default)' : this.networkAccess ? 'enabled' : 'disabled'}\nUse /network on|off`,
          }
        } else {
          this.networkAccess = !this.networkAccess
        }
        this.thread = undefined
        return {
          success: true,
          message: `Network access: ${this.networkAccess ? 'enabled' : 'disabled'} (thread will restart)`,
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
    this.thread = undefined
  }

  dispose() {
    this.isRunning = false
    if (this.turnAbort) {
      this.turnAbort.abort()
      this.turnAbort = undefined
    }
    this.thread = undefined
    this.threadId = undefined
    this.codex = undefined
  }
}
