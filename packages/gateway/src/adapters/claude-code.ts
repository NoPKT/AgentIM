import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { homedir } from 'node:os'
import { dirname, join } from 'path'
import type { ParsedChunk, ModelOption } from '@agentim/shared'
import { PERMISSION_TIMEOUT_MS } from '@agentim/shared'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'
import { createLogger } from '../lib/logger.js'
import type {
  Query,
  SDKMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  SDKRateLimitEvent as SDKRateLimitEventType,
  SDKPromptSuggestionMessage,
  SDKLocalCommandOutputMessage,
  SDKElicitationCompleteMessage,
  SDKTaskNotificationMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage as SDKTaskProgressMsgType,
  SDKToolUseSummaryMessage,
  Options,
  ModelInfo,
  AgentInfo,
  HookCallbackMatcher,
  HookEvent,
  ElicitationRequest,
  ElicitationResult,
} from '@anthropic-ai/claude-agent-sdk'

const log = createLogger('ClaudeCode')

// Cache the dynamically imported query function to avoid repeated import() calls
let _cachedQueryFn: (typeof import('@anthropic-ai/claude-agent-sdk'))['query'] | null = null

/** Per-room session and settings state. */
interface ClaudeRoomState {
  sessionId?: string
  modelOverride?: string
  thinkingConfig?:
    | { type: 'adaptive' }
    | { type: 'enabled'; budgetTokens?: number }
    | { type: 'disabled' }
  planMode: boolean
  effort?: 'low' | 'medium' | 'high'
  toolUseCount: number
  maxBudgetUsd?: number
  maxTurns?: number
  sandboxEnabled: boolean
  checkpointingEnabled: boolean
  lastModelUsage?: Record<
    string,
    {
      contextWindow: number
      maxOutputTokens: number
      costUSD: number
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
    }
  >
}

const DEFAULT_ROOM_KEY = '__global__'

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  /** Per-room active queries for parallel room processing. */
  private currentQueries = new Map<string, Query>()

  // Per-room session and settings state
  private roomStates = new Map<string, ClaudeRoomState>()
  private readonly defaultSandbox: boolean

  // Cached model info from SDK supportedModels()
  private cachedModelInfo: ModelInfo[] = []
  private cachedAgentInfo: AgentInfo[] = []
  private modelInfoFetched = false

  // MCP server for agent-to-agent communication (lazy init)
  private mcpServerConfig?: unknown

  constructor(opts: AdapterOptions) {
    super(opts)
    this.defaultSandbox = opts.sandbox ?? false
    // Load persisted session IDs from previous gateway runs
    this.loadPersistedSessions()
  }

  // ─── Session Persistence ───

  /** Path to the file storing session-to-room mappings. */
  private getSessionStorePath(): string | undefined {
    if (!this.workingDirectory) return undefined
    return join(this.workingDirectory, '.claude', '.agentim-sessions.json')
  }

  /** Load previously persisted session IDs into room states. */
  private loadPersistedSessions(): void {
    const path = this.getSessionStorePath()
    if (!path || !existsSync(path)) return
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
      let count = 0
      for (const [roomId, sessionId] of Object.entries(data)) {
        if (typeof sessionId === 'string' && sessionId) {
          const rs = this.getRoomState(roomId)
          if (!rs.sessionId) {
            rs.sessionId = sessionId
            count++
          }
        }
      }
      if (count > 0) {
        log.info(`Loaded ${count} persisted session(s) from ${path}`)
      }
    } catch {
      // File corrupt or unreadable — start fresh
    }
  }

  /** Persist a session ID for a room so it survives gateway restarts. */
  private persistSession(roomId: string, sessionId: string): void {
    const path = this.getSessionStorePath()
    if (!path) return
    try {
      let data: Record<string, string> = {}
      try {
        data = JSON.parse(readFileSync(path, 'utf-8'))
      } catch {
        // File doesn't exist yet
      }
      data[roomId] = sessionId
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(data, null, 2))
    } catch (err) {
      log.warn(`Failed to persist session: ${(err as Error).message}`)
    }
  }

  /** Remove a persisted session for a room. */
  private removePersistedSession(roomId: string): void {
    const path = this.getSessionStorePath()
    if (!path || !existsSync(path)) return
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
      delete data[roomId]
      writeFileSync(path, JSON.stringify(data, null, 2))
    } catch {
      // Non-critical
    }
  }

  private getRoomState(roomId?: string): ClaudeRoomState {
    const key = roomId ?? DEFAULT_ROOM_KEY
    let state = this.roomStates.get(key)
    if (!state) {
      state = {
        planMode: false,
        toolUseCount: 0,
        sandboxEnabled: this.defaultSandbox || this.env.ANTHROPIC_SANDBOX === 'true',
        checkpointingEnabled: this.env.CLAUDE_FILE_CHECKPOINT === 'true',
      }
      this.roomStates.set(key, state)
    }
    return state
  }

  get type() {
    return 'claude-code' as const
  }

  override get supportsParallelRooms() {
    return true
  }

  async sendMessage(
    content: string,
    onChunk: ChunkCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
    context?: MessageContext,
  ) {
    const roomId = context?.roomId ?? DEFAULT_ROOM_KEY

    if (this.isRoomBusy(roomId)) {
      onError('Agent is already processing a message for this room')
      return
    }

    this.setRoomBusy(roomId, true)
    const roomState = this.getRoomState(context?.roomId)
    let fullContent = ''

    try {
      fullContent = await this.executeQuery(content, onChunk, roomState, roomId, context)
    } catch (err: unknown) {
      // If the query failed and we were trying to resume a session, retry without resume.
      // Stale/expired session IDs cause the subprocess to exit with code 1.
      if (roomState.sessionId) {
        const errMsg = err instanceof Error ? err.message : String(err)
        log.warn(`Query failed with resume session, retrying without resume: ${errMsg}`)
        roomState.sessionId = undefined
        this.removePersistedSession(roomId)
        this.currentQueries.delete(roomId)
        try {
          fullContent = await this.executeQuery(content, onChunk, roomState, roomId, context)
        } catch (retryErr: unknown) {
          this.setRoomBusy(roomId, false)
          this.currentQueries.delete(roomId)
          if ((retryErr as Error).name === 'AbortError') {
            onComplete(fullContent || 'Interrupted')
          } else {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
            log.error(`ClaudeCode SDK error (retry): ${msg}`)
            onError(msg)
          }
          return
        }
      } else {
        this.setRoomBusy(roomId, false)
        this.currentQueries.delete(roomId)
        if ((err as Error).name === 'AbortError') {
          onComplete(fullContent || 'Interrupted')
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          log.error(`ClaudeCode SDK error: ${msg}`)
          onError(msg)
        }
        return
      }
    }

    this.setRoomBusy(roomId, false)
    this.currentQueries.delete(roomId)
    onComplete(fullContent)
  }

  /** Core query execution — extracted so sendMessage can retry on stale session. */
  private async executeQuery(
    content: string,
    onChunk: ChunkCallback,
    roomState: ClaudeRoomState,
    roomId: string,
    context?: MessageContext,
  ): Promise<string> {
    if (!_cachedQueryFn) {
      const mod = await import('@anthropic-ai/claude-agent-sdk')
      _cachedQueryFn = mod.query
    }
    const query = _cachedQueryFn

    // Ensure PATH includes the current node binary's directory so the SDK
    // can spawn `node` even when running as a daemon with a minimal PATH.
    const nodeDir = dirname(process.execPath)
    const currentPath = process.env.PATH || ''
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...this.env,
      ...(currentPath.includes(nodeDir) ? {} : { PATH: `${nodeDir}:${currentPath}` }),
    }

    // Log auth mode for debugging
    if (env.ANTHROPIC_API_KEY) {
      log.info('Using ANTHROPIC_API_KEY for authentication')
    } else if (env.HOME && env.HOME !== process.env.HOME) {
      log.info(`Using isolated HOME for subscription auth: ${env.HOME}`)
    } else {
      log.info('Using default auth (keychain/OAuth)')
    }

    // Capture stderr output so it can be included in error messages
    const stderrLines: string[] = []
    const options: Options = {
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      cwd: this.workingDirectory,
      env,
      stderr: (data: string) => {
        const line = data.trimEnd()
        log.warn(`[stderr] ${line}`)
        stderrLines.push(line)
        // Keep only the last 20 lines to avoid memory bloat
        if (stderrLines.length > 20) stderrLines.shift()
      },
    }

    if (roomState.planMode) {
      options.permissionMode = 'plan'
    } else if (this.permissionLevel === 'bypass') {
      options.permissionMode = 'bypassPermissions'
      options.allowDangerouslySkipPermissions = true
    } else {
      options.permissionMode = 'default'
      if (this.onPermissionRequest) {
        const requestPermission = this.onPermissionRequest
        options.canUseTool = async (toolName: string, toolInput: Record<string, unknown>) => {
          const { nanoid } = await import('nanoid')
          const requestId = nanoid()
          const result = await requestPermission({
            requestId,
            toolName,
            toolInput,
            timeoutMs: PERMISSION_TIMEOUT_MS,
          })
          if (result.behavior === 'allow' || result.behavior === 'allowAlways') {
            return { behavior: 'allow' as const }
          }
          return {
            behavior: 'deny' as const,
            message: result.message || 'Permission denied by user',
          }
        }
      }
    }

    if (roomState.sessionId) {
      options.resume = roomState.sessionId
    }

    // Apply runtime settings from slash commands
    if (roomState.thinkingConfig) options.thinking = roomState.thinkingConfig
    if (roomState.effort) options.effort = roomState.effort
    if (roomState.modelOverride) options.model = roomState.modelOverride

    // Budget, turns, and fallback model
    if (roomState.maxBudgetUsd !== undefined) options.maxBudgetUsd = roomState.maxBudgetUsd
    if (roomState.maxTurns !== undefined) options.maxTurns = roomState.maxTurns
    if (this.env.CLAUDE_FALLBACK_MODEL) options.fallbackModel = this.env.CLAUDE_FALLBACK_MODEL

    // Sandbox configuration
    if (roomState.sandboxEnabled) {
      options.sandbox = { enabled: true, autoAllowBashIfSandboxed: true }
    }

    // Beta features
    if (this.env.CLAUDE_ENABLE_1M_CONTEXT === 'true') {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      options.betas = ['context-1m-2025-08-07' as any]
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }

    // Additional directories
    if (this.env.CLAUDE_ADDITIONAL_DIRS) {
      options.additionalDirectories = this.env.CLAUDE_ADDITIONAL_DIRS.split(':')
    }

    // File checkpointing
    if (roomState.checkpointingEnabled) {
      options.enableFileCheckpointing = true
    }

    // Subagent definitions from env
    if (this.env.CLAUDE_AGENTS_CONFIG) {
      try {
        const config = this.env.CLAUDE_AGENTS_CONFIG
        let parsed: Record<string, unknown>
        if (config.startsWith('{')) {
          parsed = JSON.parse(config)
        } else {
          parsed = JSON.parse(readFileSync(config, 'utf-8'))
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        options.agents = parsed as any
        /* eslint-enable @typescript-eslint/no-explicit-any */
      } catch (err) {
        log.warn(`Failed to parse CLAUDE_AGENTS_CONFIG: ${(err as Error).message}`)
      }
    }

    // Enable prompt suggestions so UI can show predicted next prompts
    options.promptSuggestions = true

    // Handle MCP elicitation requests (form input / URL auth from MCP servers).
    // Uses arrow function — no roomId capture needed since elicitation is agent-scoped.
    options.onElicitation = async (request: ElicitationRequest): Promise<ElicitationResult> => {
      if (this.onPermissionRequest) {
        const { nanoid } = await import('nanoid')
        const requestId = nanoid()
        const result = await this.onPermissionRequest({
          requestId,
          toolName: `elicitation:${request.serverName}`,
          toolInput: {
            message: request.message,
            mode: request.mode,
            url: request.url,
            requestedSchema: request.requestedSchema,
          },
          timeoutMs: PERMISSION_TIMEOUT_MS,
        })
        if (result.behavior === 'allow') {
          return { action: 'accept' as const, content: {} }
        }
        return { action: 'decline' as const }
      }
      return { action: 'decline' as const }
    }

    // Hooks for lifecycle events (pass roomId for per-room tool use tracking)
    options.hooks = this.buildHooks(onChunk, roomId)

    // Inject AgentIM MCP server for agent-to-agent communication
    if (this.mcpContext && !this.mcpServerConfig) {
      try {
        const { createAgentImMcpServer } = await import('../mcp/agentim-tools.js')
        this.mcpServerConfig = await createAgentImMcpServer(this.mcpContext)
        log.info('AgentIM MCP server created for agent-to-agent communication')
      } catch (err) {
        log.warn(`Failed to create AgentIM MCP server: ${(err as Error).message}`)
      }
    }
    if (this.mcpServerConfig) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const servers = (options as any).mcpServers ?? {}
      servers.agentim = this.mcpServerConfig
      ;(options as any).mcpServers = servers
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }

    // systemPrompt is included by buildPrompt() via [System: ...] prefix,
    // so we do NOT set options.systemPrompt to avoid double injection.
    const prompt = this.buildPrompt(content, context)

    let fullContent = ''
    const response = query({ prompt, options })
    this.currentQueries.set(roomId, response)

    try {
      for await (const message of response) {
        this.processMessage(
          message,
          onChunk,
          (text) => {
            fullContent += text
          },
          roomId,
        )
      }
    } catch (err) {
      // Enrich error with captured stderr for better diagnostics
      if (stderrLines.length > 0) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const stderrSuffix = stderrLines.join('\n')
        const enriched = new Error(`${errMsg}\n[stderr]: ${stderrSuffix}`)
        enriched.name = (err as Error).name ?? 'Error'
        throw enriched
      }
      throw err
    }

    // Fetch supported models and agents after first successful query (async, non-blocking)
    if (!this.modelInfoFetched && response) {
      this.modelInfoFetched = true
      response
        .supportedModels()
        .then((models) => {
          this.cachedModelInfo = models
          log.info(`Cached ${models.length} supported models from SDK`)
        })
        .catch((err) => {
          log.warn(`Failed to fetch supported models: ${err}`)
        })
      response
        .supportedAgents()
        .then((agents) => {
          this.cachedAgentInfo = agents
          log.info(`Cached ${agents.length} supported agents from SDK`)
        })
        .catch((err) => {
          log.warn(`Failed to fetch supported agents: ${err}`)
        })
    }

    return fullContent
  }

  private processMessage(
    message: SDKMessage,
    onChunk: ChunkCallback,
    appendText: (text: string) => void,
    roomId?: string,
  ) {
    // Use untyped access to avoid discriminated union narrowing issues.
    // SDKMessage is a wide union where many subtypes share type === 'system'.
    const msg = message as Record<string, unknown>
    const msgType = msg.type as string
    const msgSubtype = msg.subtype as string | undefined

    // Capture session ID from init message and persist for restart recovery
    if (msgType === 'system' && msgSubtype === 'init') {
      const initMsg = message as SDKSystemMessage
      const rs = this.getRoomState(roomId)
      rs.sessionId = initMsg.session_id
      const key = roomId ?? DEFAULT_ROOM_KEY
      this.persistSession(key, initMsg.session_id)
      log.info(`Session started for room ${key}: ${rs.sessionId}`)
      return
    }

    // Process assistant messages with content blocks
    if (msgType === 'assistant') {
      const assistantMsg = message as SDKAssistantMessage
      if (assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          const chunks = this.mapBlockToChunks(block)
          for (const chunk of chunks) {
            if (chunk.type === 'text') appendText(chunk.content)
            onChunk(chunk)
          }
        }
      }
      return
    }

    // Process streaming events for incremental text
    if (msgType === 'stream_event') {
      const streamMsg = message as SDKPartialAssistantMessage
      const event = streamMsg.event
      if ('delta' in event) {
        const delta = (event as { delta?: { type?: string; text?: string; thinking?: string } })
          .delta
        if (delta?.type === 'text_delta' && delta.text) {
          appendText(delta.text)
          onChunk({ type: 'text', content: delta.text })
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          onChunk({ type: 'thinking', content: delta.thinking })
        }
      }
      return
    }

    // Extract result — accumulate cost and token usage
    if (msgType === 'result') {
      const resultMsg = message as SDKResultMessage
      if (resultMsg.subtype === 'success') {
        this.accumulatedCostUSD += resultMsg.total_cost_usd ?? 0
        if (resultMsg.usage) {
          this.accumulatedInputTokens += resultMsg.usage.input_tokens ?? 0
          this.accumulatedOutputTokens += resultMsg.usage.output_tokens ?? 0
        }
        if (resultMsg.modelUsage) {
          const rs = this.getRoomState(roomId)
          rs.lastModelUsage = {}
          for (const [model, usage] of Object.entries(resultMsg.modelUsage)) {
            rs.lastModelUsage[model] = {
              contextWindow: usage.contextWindow,
              maxOutputTokens: usage.maxOutputTokens,
              costUSD: usage.costUSD,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
            }
            this.accumulatedCacheReadTokens += usage.cacheReadInputTokens ?? 0
          }
        }
      } else {
        // Error results still have cost data
        this.accumulatedCostUSD += resultMsg.total_cost_usd ?? 0
        if (resultMsg.usage) {
          this.accumulatedInputTokens += resultMsg.usage.input_tokens ?? 0
          this.accumulatedOutputTokens += resultMsg.usage.output_tokens ?? 0
        }
      }
      return
    }

    // Rate limit events — surface to UI
    if (msgType === 'rate_limit_event') {
      const rlMsg = message as SDKRateLimitEventType
      const info = rlMsg.rate_limit_info
      if (info.status === 'rejected' || info.status === 'allowed_warning') {
        const resetsAt = info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : 'unknown'
        onChunk({
          type: 'text',
          content: `[Rate limit ${info.status}: ${info.rateLimitType ?? 'unknown'}, resets at ${resetsAt}]`,
          metadata: { rateLimit: true },
        })
      }
      return
    }

    // Prompt suggestions — emit for UI to display
    if (msgType === 'prompt_suggestion') {
      const psMsg = message as SDKPromptSuggestionMessage
      onChunk({
        type: 'text',
        content: '',
        metadata: { promptSuggestion: psMsg.suggestion },
      })
      return
    }

    // Task lifecycle messages
    if (msgType === 'system' && msgSubtype === 'task_started') {
      const taskMsg = message as SDKTaskStartedMessage
      onChunk({
        type: 'text',
        content: `[Task started: ${taskMsg.description}]`,
        metadata: { taskEvent: 'started', taskId: taskMsg.task_id },
      })
      return
    }

    if (msgType === 'system' && msgSubtype === 'task_progress') {
      const taskMsg = message as SDKTaskProgressMsgType
      onChunk({
        type: 'text',
        content: `[Task progress: ${taskMsg.description}]`,
        metadata: { taskEvent: 'progress', taskId: taskMsg.task_id },
      })
      return
    }

    if (msgType === 'system' && msgSubtype === 'task_notification') {
      const taskMsg = message as SDKTaskNotificationMessage
      onChunk({
        type: 'text',
        content: `[Task ${taskMsg.status}: ${taskMsg.summary}]`,
        metadata: { taskEvent: taskMsg.status, taskId: taskMsg.task_id },
      })
      return
    }

    // Local command output (e.g. /cost, /voice)
    if (msgType === 'system' && msgSubtype === 'local_command_output') {
      const cmdMsg = message as SDKLocalCommandOutputMessage
      onChunk({ type: 'text', content: cmdMsg.content })
      appendText(cmdMsg.content)
      return
    }

    // Elicitation complete
    if (msgType === 'system' && msgSubtype === 'elicitation_complete') {
      const elMsg = message as SDKElicitationCompleteMessage
      log.info(`Elicitation complete: ${elMsg.mcp_server_name} (${elMsg.elicitation_id})`)
      return
    }

    // Tool use summary
    if (msgType === 'system' && msgSubtype === 'tool_use_summary') {
      const sumMsg = message as SDKToolUseSummaryMessage
      onChunk({
        type: 'text',
        content: sumMsg.summary,
        metadata: { toolUseSummary: true },
      })
      return
    }
  }

  private mapBlockToChunks(block: {
    type: string
    text?: string
    thinking?: string
    name?: string
    id?: string
    content?: unknown
    tool_use_id?: string
    input?: unknown
  }): ParsedChunk[] {
    switch (block.type) {
      case 'text':
        return [{ type: 'text', content: block.text ?? '' }]
      case 'thinking':
        return [{ type: 'thinking', content: block.thinking ?? '' }]
      case 'tool_use':
        return [
          {
            type: 'tool_use',
            content: JSON.stringify(
              { name: block.name, id: block.id, input: block.input },
              null,
              2,
            ),
            metadata: { toolName: block.name, toolId: block.id },
          },
        ]
      case 'tool_result':
        return [
          {
            type: 'tool_result',
            content:
              typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            metadata: { toolId: block.tool_use_id },
          },
        ]
      default:
        return []
    }
  }

  private buildHooks(
    onChunk: ChunkCallback,
    roomId: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      SubagentStart: [
        {
          hooks: [
            async (input) => {
              const data = input as { hook_event_name: string; [key: string]: unknown }
              const name = (data.agent_name ?? data.subagent_type ?? 'unknown') as string
              onChunk({
                type: 'text',
                content: `[Subagent started: ${name}]`,
                metadata: { hookEvent: 'SubagentStart' },
              })
              return { continue: true }
            },
          ],
        },
      ],
      SubagentStop: [
        {
          hooks: [
            async (input) => {
              const data = input as { hook_event_name: string; [key: string]: unknown }
              const name = (data.agent_name ?? data.subagent_type ?? 'unknown') as string
              onChunk({
                type: 'text',
                content: `[Subagent stopped: ${name}]`,
                metadata: { hookEvent: 'SubagentStop' },
              })
              return { continue: true }
            },
          ],
        },
      ],
      Notification: [
        {
          hooks: [
            async (input) => {
              const data = input as {
                hook_event_name: string
                message?: string
                [key: string]: unknown
              }
              if (data.message) {
                onChunk({
                  type: 'text',
                  content: `[Notification: ${data.message}]`,
                  metadata: { hookEvent: 'Notification' },
                })
              }
              return { continue: true }
            },
          ],
        },
      ],
      TaskCompleted: [
        {
          hooks: [
            async () => {
              onChunk({
                type: 'text',
                content: '[Task completed]',
                metadata: { hookEvent: 'TaskCompleted' },
              })
              return { continue: true }
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async () => {
              this.getRoomState(roomId).toolUseCount++
              return { continue: true }
            },
          ],
        },
      ],
      Elicitation: [
        {
          hooks: [
            async (input) => {
              const data = input as {
                hook_event_name: string
                mcp_server_name?: string
                message?: string
                [key: string]: unknown
              }
              onChunk({
                type: 'text',
                content: `[Elicitation from ${data.mcp_server_name ?? 'unknown'}: ${data.message ?? ''}]`,
                metadata: { hookEvent: 'Elicitation' },
              })
              return { continue: true }
            },
          ],
        },
      ],
      ElicitationResult: [
        {
          hooks: [
            async (input) => {
              const data = input as {
                hook_event_name: string
                action?: string
                mcp_server_name?: string
                [key: string]: unknown
              }
              onChunk({
                type: 'text',
                content: `[Elicitation result: ${data.action ?? 'unknown'} (${data.mcp_server_name ?? 'unknown'})]`,
                metadata: { hookEvent: 'ElicitationResult' },
              })
              return { continue: true }
            },
          ],
        },
      ],
      SessionStart: [
        {
          hooks: [
            async () => {
              log.info('Session started (hook)')
              return { continue: true }
            },
          ],
        },
      ],
      SessionEnd: [
        {
          hooks: [
            async () => {
              log.info('Session ended (hook)')
              return { continue: true }
            },
          ],
        },
      ],
    }
  }

  override getSlashCommands(): Array<{
    name: string
    description: string
    usage: string
    source: 'builtin' | 'skill'
  }> {
    const commands: Array<{
      name: string
      description: string
      usage: string
      source: 'builtin' | 'skill'
    }> = [
      {
        name: 'clear',
        description: 'Reset conversation session',
        usage: '/clear',
        source: 'builtin',
      },
      {
        name: 'compact',
        description: 'Compact conversation and reset session',
        usage: '/compact',
        source: 'builtin',
      },
      {
        name: 'model',
        description: 'Switch model or list available models',
        usage: '/model [name]',
        source: 'builtin',
      },
      {
        name: 'think',
        description: 'Set thinking mode: adaptive, enabled[:budget], disabled',
        usage: '/think [mode]',
        source: 'builtin',
      },
      {
        name: 'effort',
        description: 'Set effort level: low, medium, high',
        usage: '/effort [level]',
        source: 'builtin',
      },
      {
        name: 'cost',
        description: 'Show accumulated cost and token usage',
        usage: '/cost',
        source: 'builtin',
      },
      {
        name: 'context',
        description: 'Show context window and model info',
        usage: '/context',
        source: 'builtin',
      },
      {
        name: 'plan',
        description: 'Toggle plan mode (read-only)',
        usage: '/plan [on|off]',
        source: 'builtin',
      },
      {
        name: 'budget',
        description: 'Set max budget in USD',
        usage: '/budget [amount]',
        source: 'builtin',
      },
      {
        name: 'turns',
        description: 'Set max turns per message',
        usage: '/turns [count]',
        source: 'builtin',
      },
      {
        name: 'sandbox',
        description: 'Toggle sandbox mode',
        usage: '/sandbox [on|off]',
        source: 'builtin',
      },
      {
        name: 'checkpoint',
        description: 'Toggle file checkpointing',
        usage: '/checkpoint [on|off]',
        source: 'builtin',
      },
      {
        name: 'rewind',
        description: 'Rewind files to a previous message state',
        usage: '/rewind [messageId]',
        source: 'builtin',
      },
    ]

    // Discover custom slash commands from .claude/commands/
    if (this.workingDirectory) {
      try {
        const commandsDir = join(this.workingDirectory, '.claude', 'commands')
        const files: string[] = readdirSync(commandsDir).filter((f: string) => f.endsWith('.md'))
        for (const file of files) {
          const name = file.replace(/\.md$/, '')
          commands.push({
            name,
            description: `Custom command from .claude/commands/${file}`,
            usage: `/${name}`,
            source: 'skill',
          })
        }
      } catch {
        // Directory doesn't exist or not readable — skip
      }
    }

    return commands
  }

  override getMcpServers(): string[] {
    // Project-level configs take precedence, then global configs
    const candidates = [
      ...(this.workingDirectory
        ? [
            join(this.workingDirectory, '.claude', 'settings.json'),
            join(this.workingDirectory, '.claude.json'),
          ]
        : []),
      join(homedir(), '.claude', 'settings.json'),
      join(homedir(), '.claude.json'),
    ]

    // Merge MCP servers from all config files
    const allServers = new Set<string>()
    for (const filePath of candidates) {
      try {
        if (!existsSync(filePath)) continue
        const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
        const mcpServers = raw?.mcpServers
        if (mcpServers && typeof mcpServers === 'object') {
          for (const key of Object.keys(mcpServers)) {
            allServers.add(key)
          }
        }
      } catch {
        // Malformed JSON or unreadable — skip
      }
    }

    return Array.from(allServers)
  }

  override getModel(roomId?: string): string | undefined {
    return (
      this.getRoomState(roomId).modelOverride ||
      this.env.ANTHROPIC_MODEL ||
      this.env.CLAUDE_MODEL ||
      undefined
    )
  }

  override getAvailableModels(): string[] {
    if (this.cachedModelInfo.length > 0) {
      return this.cachedModelInfo.map((m) => m.value)
    }
    // Fallback until SDK models are fetched
    return [
      'sonnet',
      'opus',
      'haiku',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-haiku-4-5-20251001',
    ]
  }

  override getAvailableModelInfo(): ModelOption[] {
    return this.cachedModelInfo.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
    }))
  }

  /** Get cached agent info from SDK supportedAgents(). */
  getAvailableAgents(): AgentInfo[] {
    return this.cachedAgentInfo
  }

  override get supportsRewind() {
    return true
  }

  override async rewind(_messageId: string, roomId?: string) {
    // Clear session so the next message starts a fresh conversation.
    // The server has already deleted messages; room_context will provide
    // the truncated history on the next send_to_agent.
    const key = roomId ?? DEFAULT_ROOM_KEY
    this.getRoomState(roomId).sessionId = undefined
    this.removePersistedSession(key)
    return { success: true }
  }

  override getAvailableEffortLevels(): string[] {
    return ['low', 'medium', 'high']
  }

  override getAvailableThinkingModes(): string[] {
    return ['adaptive', 'enabled', 'disabled']
  }

  override getThinkingMode(roomId?: string): string | undefined {
    const tc = this.getRoomState(roomId).thinkingConfig
    if (!tc) return undefined
    if (tc.type === 'enabled' && 'budgetTokens' in tc) {
      return `enabled:${tc.budgetTokens}`
    }
    return tc.type
  }

  override getEffortLevel(roomId?: string): string | undefined {
    return this.getRoomState(roomId).effort
  }

  override getPlanMode(roomId?: string): boolean {
    return this.getRoomState(roomId).planMode
  }

  override async handleSlashCommand(
    command: string,
    args: string,
    roomId?: string,
  ): Promise<{ success: boolean; message?: string }> {
    const rs = this.getRoomState(roomId)
    switch (command) {
      case 'clear': {
        rs.sessionId = undefined
        this.removePersistedSession(roomId ?? DEFAULT_ROOM_KEY)
        return { success: true, message: 'Session cleared' }
      }
      case 'compact': {
        rs.sessionId = undefined
        this.removePersistedSession(roomId ?? DEFAULT_ROOM_KEY)
        return { success: true, message: 'Session compacted (reset)' }
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
        // Apply immediately if a query is active for this room
        const activeQuery = this.currentQueries.get(roomId ?? DEFAULT_ROOM_KEY)
        if (activeQuery) {
          await activeQuery.setModel(name)
        }
        return { success: true, message: `Model set to: ${name}` }
      }
      case 'think': {
        const mode = args.trim().toLowerCase()
        if (!mode) {
          const current = rs.thinkingConfig
            ? rs.thinkingConfig.type === 'enabled' && 'budgetTokens' in rs.thinkingConfig
              ? `enabled (budget: ${rs.thinkingConfig.budgetTokens})`
              : rs.thinkingConfig.type
            : '(default)'
          return {
            success: true,
            message: `Thinking mode: ${current}\nOptions: adaptive, enabled[:budget], disabled`,
          }
        }
        if (mode === 'adaptive') {
          rs.thinkingConfig = { type: 'adaptive' }
          return { success: true, message: 'Thinking set to: adaptive' }
        }
        if (mode === 'disabled' || mode === 'off') {
          rs.thinkingConfig = { type: 'disabled' }
          return { success: true, message: 'Thinking set to: disabled' }
        }
        if (mode.startsWith('enabled') || mode.startsWith('on')) {
          const budgetMatch = mode.match(/:(\d+)/)
          if (budgetMatch) {
            rs.thinkingConfig = { type: 'enabled', budgetTokens: parseInt(budgetMatch[1], 10) }
            return {
              success: true,
              message: `Thinking set to: enabled (budget: ${budgetMatch[1]} tokens)`,
            }
          }
          rs.thinkingConfig = { type: 'enabled' }
          return { success: true, message: 'Thinking set to: enabled' }
        }
        return {
          success: false,
          message: `Unknown thinking mode: ${mode}\nOptions: adaptive, enabled[:budget], disabled`,
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
      case 'effort': {
        const level = args.trim().toLowerCase()
        if (!level) {
          return {
            success: true,
            message: `Effort level: ${rs.effort ?? '(default)'}\nOptions: low, medium, high`,
          }
        }
        const valid = ['low', 'medium', 'high'] as const
        if (!valid.includes(level as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid effort level: ${level}\nOptions: low, medium, high`,
          }
        }
        rs.effort = level as 'low' | 'medium' | 'high'
        return { success: true, message: `Effort set to: ${level}` }
      }
      case 'cost': {
        const summary = this.getCostSummary()
        const lines = [
          'Session Cost Summary',
          `  Cost:         $${summary.costUSD.toFixed(4)}`,
          `  Input tokens:  ${summary.inputTokens.toLocaleString()}`,
          `  Output tokens: ${summary.outputTokens.toLocaleString()}`,
          `  Cache read:    ${summary.cacheReadTokens.toLocaleString()}`,
        ]
        return { success: true, message: lines.join('\n') }
      }
      case 'context': {
        const lines: string[] = ['Context Info']
        const model = this.getModel(roomId)
        if (model) lines.push(`  Model: ${model}`)
        if (rs.lastModelUsage) {
          for (const [modelName, usage] of Object.entries(rs.lastModelUsage)) {
            lines.push(`  ${modelName}:`)
            lines.push(`    Context window:  ${usage.contextWindow.toLocaleString()}`)
            lines.push(`    Max output:      ${usage.maxOutputTokens.toLocaleString()}`)
            lines.push(`    Input tokens:    ${usage.inputTokens.toLocaleString()}`)
            lines.push(`    Output tokens:   ${usage.outputTokens.toLocaleString()}`)
            lines.push(`    Cost:            $${usage.costUSD.toFixed(4)}`)
          }
        } else {
          lines.push('  No model usage data yet (send a message first)')
        }
        return { success: true, message: lines.join('\n') }
      }
      case 'budget': {
        const val = args.trim()
        if (!val) {
          return {
            success: true,
            message: `Max budget: ${rs.maxBudgetUsd !== undefined ? `$${rs.maxBudgetUsd}` : '(none)'}\nUse /budget <amount> to set`,
          }
        }
        const amount = parseFloat(val)
        if (isNaN(amount) || amount <= 0) {
          return { success: false, message: 'Budget must be a positive number' }
        }
        rs.maxBudgetUsd = amount
        return { success: true, message: `Max budget set to: $${amount}` }
      }
      case 'turns': {
        const val = args.trim()
        if (!val) {
          return {
            success: true,
            message: `Max turns: ${rs.maxTurns !== undefined ? rs.maxTurns : '(none)'}\nUse /turns <count> to set`,
          }
        }
        const count = parseInt(val, 10)
        if (isNaN(count) || count <= 0 || !Number.isInteger(parseFloat(val))) {
          return { success: false, message: 'Turns must be a positive integer' }
        }
        rs.maxTurns = count
        return { success: true, message: `Max turns set to: ${count}` }
      }
      case 'sandbox': {
        const arg = args.trim().toLowerCase()
        if (arg === 'on' || arg === 'true' || arg === '1') {
          rs.sandboxEnabled = true
        } else if (arg === 'off' || arg === 'false' || arg === '0') {
          rs.sandboxEnabled = false
        } else {
          rs.sandboxEnabled = !rs.sandboxEnabled
        }
        return {
          success: true,
          message: `Sandbox: ${rs.sandboxEnabled ? 'enabled' : 'disabled'}`,
        }
      }
      case 'checkpoint': {
        const arg = args.trim().toLowerCase()
        if (arg === 'on' || arg === 'true' || arg === '1') {
          rs.checkpointingEnabled = true
        } else if (arg === 'off' || arg === 'false' || arg === '0') {
          rs.checkpointingEnabled = false
        } else {
          rs.checkpointingEnabled = !rs.checkpointingEnabled
        }
        return {
          success: true,
          message: `File checkpointing: ${rs.checkpointingEnabled ? 'enabled' : 'disabled'}`,
        }
      }
      case 'rewind': {
        const messageId = args.trim()
        if (!messageId) {
          return { success: false, message: 'Usage: /rewind <messageId>' }
        }
        const rewindQuery = this.currentQueries.get(roomId ?? DEFAULT_ROOM_KEY)
        if (!rewindQuery) {
          return { success: false, message: 'No active query to rewind' }
        }
        if (!rs.checkpointingEnabled) {
          return {
            success: false,
            message: 'File checkpointing is not enabled. Use /checkpoint on',
          }
        }
        try {
          await rewindQuery.rewindFiles(messageId)
          return { success: true, message: `Files rewound to message: ${messageId}` }
        } catch (err) {
          return { success: false, message: `Rewind failed: ${(err as Error).message}` }
        }
      }
      default:
        return { success: false, message: `Unknown command: ${command}` }
    }
  }

  stop() {
    // Interrupt all active room queries and remove persisted sessions
    for (const [roomId, query] of this.currentQueries) {
      query.interrupt()
      this.getRoomState(roomId).sessionId = undefined
      this.removePersistedSession(roomId)
    }
    this.currentQueries.clear()
    this.clearAllBusy()
  }

  dispose() {
    for (const [, query] of this.currentQueries) {
      query.close()
    }
    this.currentQueries.clear()
    this.clearAllBusy()
    this.roomStates.clear()
  }
}
