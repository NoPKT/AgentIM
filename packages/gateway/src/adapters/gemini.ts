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

const log = createLogger('Gemini')

/**
 * Extract a human-readable error message from an unknown error value.
 * GaxiosError from Google SDKs is not a standard Error instance,
 * so `String(err)` produces `[object Object]`.
 *
 * For Google API JSON error responses (e.g. `[{"error":{"code":429,...}}]`),
 * this extracts the inner `error.message` for a cleaner display.
 */
function extractErrorMessage(err: unknown): string {
  let raw: string | undefined

  if (err instanceof Error) {
    raw = err.message
  } else if (typeof err === 'string') {
    raw = err
  } else if (err && typeof err === 'object') {
    if ('message' in err && typeof (err as Record<string, unknown>).message === 'string')
      raw = (err as Record<string, unknown>).message as string
    else {
      try {
        raw = JSON.stringify(err)
      } catch {
        /* fall through */
      }
    }
  }

  if (!raw) return String(err)

  // Parse Google API JSON error responses to extract the inner message.
  // GaxiosError.message is often a JSON string like: [{"error":{"code":429,"message":"..."}}]
  const trimmed = raw.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const obj = Array.isArray(parsed) ? parsed[0] : parsed
      if (obj?.error?.message) {
        const code = obj.error.code ? `HTTP ${obj.error.code}: ` : ''
        return `${code}${obj.error.message}`
      }
    } catch {
      /* not JSON — return raw */
    }
  }

  return raw
}

/**
 * Classify a raw retry error string from the Gemini SDK into a concise,
 * user-readable message.  The SDK's error payloads are often deeply nested
 * JSON or very long strings — this distils them into something actionable.
 */
function classifyRetryError(raw: string): string {
  // Capacity / resource exhaustion
  if (raw.includes('MODEL_CAPACITY_EXHAUSTED') || raw.includes('at capacity')) {
    return 'Model capacity exhausted — the model is overloaded. Try a different model or wait a while.'
  }
  if (raw.includes('RESOURCE_EXHAUSTED')) {
    return 'Resource exhausted — API quota or rate limit reached. Please wait before retrying.'
  }

  // Authentication / permission
  if (raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return 'Permission denied (403) — check your API key or OAuth credentials.'
  }
  if (raw.includes('UNAUTHENTICATED') || raw.includes('401')) {
    return 'Authentication failed (401) — your API key or token may be invalid or expired.'
  }

  // Model not found
  if (raw.includes('NOT_FOUND') || raw.includes('404') || raw.includes('not found')) {
    return `Model not found (404) — verify the model name is correct.`
  }

  // Generic rate limit (429 without specific sub-type)
  if (raw.includes('429') || raw.includes('RATE_LIMIT') || raw.includes('Too Many Requests')) {
    return 'Rate limited (429) — too many requests. Please wait before retrying.'
  }

  // Server errors
  if (raw.includes('500') || raw.includes('INTERNAL')) {
    return 'Server error (500) — the Gemini API encountered an internal error. Try again later.'
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return 'Service unavailable (503) — the Gemini API is temporarily down. Try again later.'
  }

  // Fallback: truncate the raw message to a reasonable length
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
}

// Cache the dynamically imported SDK module to avoid repeated import() calls
let _cachedSdk: typeof import('@google/gemini-cli-core') | null = null

/**
 * Gemini adapter — full implementation using @google/gemini-cli-core.
 *
 * Architecture mirrors ClaudeCodeAdapter:
 * - Lazy dynamic import of the SDK (cached after first load)
 * - Persistent client management across messages
 * - Streaming support via async iteration over sendMessageStream events
 * - Maps all 18 Gemini stream events to ParsedChunk types
 * - Slash commands: /clear, /compact, /model, /cost, /plan
 */
/** Per-room state for Gemini adapter. */
interface GeminiRoomState {
  config?: InstanceType<typeof import('@google/gemini-cli-core').Config>
  client?: InstanceType<typeof import('@google/gemini-cli-core').GeminiClient>
  initialized: boolean
  promptCounter: number
  modelOverride?: string
  planMode: boolean
  thinkingBudget: 'off' | 'low' | 'medium' | 'high'
}

const DEFAULT_ROOM_KEY = '__global__'

export class GeminiAdapter extends BaseAgentAdapter {
  // Stream control (global — only one message can be processed at a time)
  private streamAbort?: AbortController

  // Per-room state
  private roomStates = new Map<string, GeminiRoomState>()
  private currentRoomId?: string

  constructor(opts: AdapterOptions) {
    super(opts)
    // Eagerly trigger SDK load so model info is available for getAvailableModels()
    this.ensureSdk().catch(() => {})
  }

  private getRoomState(roomId?: string): GeminiRoomState {
    const key = roomId ?? DEFAULT_ROOM_KEY
    let state = this.roomStates.get(key)
    if (!state) {
      state = {
        initialized: false,
        promptCounter: 0,
        planMode: false,
        thinkingBudget: 'off',
      }
      this.roomStates.set(key, state)
    }
    return state
  }

  get type() {
    return 'gemini' as const
  }

  /**
   * Lazily load and cache the Gemini SDK module.
   * Uses dynamic import so the gateway does not fail at startup
   * when the SDK is not installed.
   */
  private async ensureSdk() {
    if (!_cachedSdk) {
      _cachedSdk = await import('@google/gemini-cli-core')
    }
    return _cachedSdk
  }

  /**
   * Ensure we have an initialized GeminiClient, creating Config + Client if needed.
   */
  private async ensureClient(
    roomId?: string,
  ): Promise<InstanceType<typeof import('@google/gemini-cli-core').GeminiClient>> {
    const rs = this.getRoomState(roomId)
    if (rs.client && rs.initialized) {
      return rs.client
    }

    const sdk = await this.ensureSdk()

    // The Gemini SDK reads API keys and auth from process.env.
    // Agent-specific env vars are stored in this.env, so we must bridge them.
    // Agent config takes priority — always override process.env.
    const envKeys = [
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_REGION',
      'GOOGLE_CLOUD_PROJECT_ID',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_GENAI_USE_VERTEXAI',
      'GOOGLE_GENAI_USE_GCA',
    ]
    for (const key of envKeys) {
      if (this.env[key]) {
        process.env[key] = this.env[key]
      }
    }

    // Log which auth credentials are available for diagnostics
    const hasGeminiKey = !!(process.env.GEMINI_API_KEY || this.env.GEMINI_API_KEY)
    const hasGoogleKey = !!(process.env.GOOGLE_API_KEY || this.env.GOOGLE_API_KEY)
    log.info(
      `Auth check: GEMINI_API_KEY=${hasGeminiKey}, GOOGLE_API_KEY=${hasGoogleKey}, ` +
        `env keys=[${Object.keys(this.env).join(', ')}]`,
    )

    // Determine approval mode
    let approvalMode = sdk.ApprovalMode.DEFAULT
    if (this.permissionLevel === 'bypass') {
      approvalMode = sdk.ApprovalMode.YOLO
    } else if (rs.planMode) {
      approvalMode = sdk.ApprovalMode.PLAN
    }

    const model = rs.modelOverride ?? this.env.GEMINI_MODEL ?? sdk.DEFAULT_GEMINI_MODEL

    const { nanoid } = await import('nanoid')
    const sessionId = nanoid()

    const configOpts = {
      sessionId,
      model,
      targetDir: this.workingDirectory ?? process.cwd(),
      cwd: this.workingDirectory ?? process.cwd(),
      debugMode: false,
      interactive: false,
      approvalMode,
    }
    rs.config = new sdk.Config(configOpts)

    // Config._initialize() calls geminiClient.initialize() which requires
    // a contentGenerator, but contentGenerator is only set inside
    // refreshAuth(). We must call refreshAuth() BEFORE initialize().
    const authType = sdk.getAuthTypeFromEnv()
    if (authType) {
      await rs.config.refreshAuth(authType)
    } else {
      // Default to API key auth — GEMINI_API_KEY should be set
      await rs.config.refreshAuth(sdk.AuthType.USE_GEMINI)
    }

    await rs.config.initialize()

    // Use the Config's own pre-initialized geminiClient — it shares the
    // contentGenerator set by refreshAuth() above.
    rs.client = (rs.config as any).geminiClient as InstanceType<
      typeof import('@google/gemini-cli-core').GeminiClient
    >
    rs.initialized = true

    log.info(`Gemini client initialized (model: ${model}, session: ${sessionId})`)
    return rs.client!
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
    let capacityAborted = false
    let retryError = ''

    try {
      const rs = this.getRoomState(context?.roomId)
      const client = await this.ensureClient(context?.roomId)
      const sdk = await this.ensureSdk()
      const prompt = this.buildPrompt(content, context)

      this.streamAbort = new AbortController()
      rs.promptCounter++
      const promptId = `prompt-${rs.promptCounter}`

      // Abort on the very first retry attempt.  The SDK retries up to 10×
      // with exponential backoff by default; we surface errors immediately
      // and let the user decide whether / when to retry.
      const retryListener = (payload: {
        error?: string
        attempt?: number
        maxAttempts?: number
        model?: string
      }) => {
        const raw = payload.error ?? '(unknown error)'
        log.warn(
          `Gemini retry ${payload.attempt ?? '?'}/${payload.maxAttempts ?? '?'} [${payload.model ?? '?'}]: ${raw.slice(0, 300)}`,
        )
        retryError = classifyRetryError(raw)
        capacityAborted = true
        this.streamAbort?.abort()
        log.warn(`Aborting SDK retries — surfacing error to user: ${retryError}`)
      }
      sdk.coreEvents.on(sdk.CoreEvent.RetryAttempt, retryListener)

      try {
        const stream = client.sendMessageStream(prompt, this.streamAbort.signal, promptId)

        for await (const event of stream) {
          const chunks = this.processEvent(event, sdk)
          for (const chunk of chunks) {
            if (chunk.type === 'text') {
              fullContent += chunk.content
            }
            onChunk(chunk)
          }

          // Extract usage from Finished events
          if (event.type === sdk.GeminiEventType.Finished) {
            this.extractUsage(event, sdk)
          }

          // Bail on error events
          if (event.type === sdk.GeminiEventType.Error) {
            const errVal = (event as { value: { error: unknown } }).value
            const errMsg = extractErrorMessage(errVal.error)
            this.isRunning = false
            this.streamAbort = undefined
            onError(errMsg)
            return
          }
        }

        this.isRunning = false
        this.streamAbort = undefined
        onComplete(fullContent)
      } finally {
        sdk.coreEvents.off(sdk.CoreEvent.RetryAttempt, retryListener)
      }
    } catch (err: unknown) {
      this.isRunning = false
      this.streamAbort = undefined
      if ((err as Error).name === 'AbortError' && capacityAborted) {
        // Aborted because the SDK tried to retry — surface the real error
        const msg = retryError || extractErrorMessage(err)
        log.warn(`Gemini error (retries aborted): ${msg}`)
        onError(msg)
      } else if ((err as Error).name === 'AbortError') {
        onComplete(fullContent || 'Interrupted')
      } else {
        const msg = extractErrorMessage(err)
        log.error(`Gemini SDK error: ${msg}`)
        onError(msg)
      }
    }
  }

  /**
   * Map a ServerGeminiStreamEvent to zero or more ParsedChunks.
   */
  private processEvent(
    event: import('@google/gemini-cli-core').ServerGeminiStreamEvent,
    sdk: typeof import('@google/gemini-cli-core'),
  ): ParsedChunk[] {
    switch (event.type) {
      case sdk.GeminiEventType.Content:
        return [{ type: 'text', content: (event as { value: string }).value }]

      case sdk.GeminiEventType.Thought: {
        const thought = (event as { value: { subject: string; description: string } }).value
        const text = thought.subject
          ? `**${thought.subject}** ${thought.description}`
          : thought.description
        return [{ type: 'thinking', content: text }]
      }

      case sdk.GeminiEventType.ToolCallRequest: {
        const req = (
          event as {
            value: { callId: string; name: string; args: Record<string, unknown> }
          }
        ).value
        return [
          {
            type: 'tool_use',
            content: JSON.stringify({ name: req.name, id: req.callId, input: req.args }, null, 2),
            metadata: { toolName: req.name, toolId: req.callId },
          },
        ]
      }

      case sdk.GeminiEventType.ToolCallResponse: {
        const resp = (
          event as {
            value: {
              callId: string
              resultDisplay: unknown
              error: Error | undefined
            }
          }
        ).value
        const display = resp.error
          ? `Error: ${resp.error.message}`
          : typeof resp.resultDisplay === 'string'
            ? resp.resultDisplay
            : JSON.stringify(resp.resultDisplay ?? '')
        return [
          {
            type: 'tool_result',
            content: display,
            metadata: { toolId: resp.callId },
          },
        ]
      }

      case sdk.GeminiEventType.ToolCallConfirmation:
        // Permission was processed internally; no chunk emitted
        return []

      case sdk.GeminiEventType.Error: {
        const errVal = (event as { value: { error: unknown } }).value
        const errMsg = extractErrorMessage(errVal.error)
        return [{ type: 'error', content: errMsg }]
      }

      case sdk.GeminiEventType.Finished:
        // Usage extracted separately; no chunk emitted
        return []

      case sdk.GeminiEventType.ChatCompressed: {
        const info = (
          event as { value: { originalTokenCount: number; newTokenCount: number } | null }
        ).value
        if (info) {
          return [
            {
              type: 'text',
              content: `[Chat compressed: ${info.originalTokenCount} → ${info.newTokenCount} tokens]`,
              metadata: { compressed: true },
            },
          ]
        }
        return []
      }

      case sdk.GeminiEventType.Retry:
        // Suppressed — retries are handled by retryListener which surfaces errors
        return []

      case sdk.GeminiEventType.Citation: {
        const citation = (event as { value: string }).value
        return [
          {
            type: 'text',
            content: `[Citation: ${citation}]`,
            metadata: { citation: true },
          },
        ]
      }

      case sdk.GeminiEventType.ModelInfo:
        // Suppressed — model info is already shown in the agent panel
        log.info(`Model: ${(event as { value: string }).value}`)
        return []

      case sdk.GeminiEventType.LoopDetected:
        return [{ type: 'error', content: 'Loop detected — stopping execution' }]

      case sdk.GeminiEventType.MaxSessionTurns:
        return [{ type: 'error', content: 'Maximum session turns reached' }]

      case sdk.GeminiEventType.ContextWindowWillOverflow: {
        const overflow = (
          event as {
            value: { estimatedRequestTokenCount: number; remainingTokenCount: number }
          }
        ).value
        return [
          {
            type: 'text',
            content: `[Context window warning: ${overflow.estimatedRequestTokenCount} tokens requested, ${overflow.remainingTokenCount} remaining]`,
            metadata: { contextWarning: true },
          },
        ]
      }

      case sdk.GeminiEventType.InvalidStream:
        // Internal retry; log but don't emit
        log.debug('Invalid stream detected, SDK will retry')
        return []

      case sdk.GeminiEventType.UserCancelled:
        return []

      case sdk.GeminiEventType.AgentExecutionStopped: {
        const stopped = (event as { value: { reason: string; systemMessage?: string } }).value
        return [
          {
            type: 'text',
            content: `[Agent stopped: ${stopped.reason}${stopped.systemMessage ? ` — ${stopped.systemMessage}` : ''}]`,
          },
        ]
      }

      case sdk.GeminiEventType.AgentExecutionBlocked: {
        const blocked = (event as { value: { reason: string; systemMessage?: string } }).value
        return [
          {
            type: 'text',
            content: `[Agent blocked: ${blocked.reason}${blocked.systemMessage ? ` — ${blocked.systemMessage}` : ''}]`,
          },
        ]
      }

      default:
        log.debug(`Ignoring unknown Gemini event type: ${(event as { type: string }).type}`)
        return []
    }
  }

  /**
   * Extract token usage from a Finished event.
   */
  private extractUsage(
    event: import('@google/gemini-cli-core').ServerGeminiStreamEvent,
    sdk: typeof import('@google/gemini-cli-core'),
  ) {
    if (event.type !== sdk.GeminiEventType.Finished) return

    const finished = (
      event as {
        value: {
          usageMetadata?: {
            promptTokenCount?: number
            candidatesTokenCount?: number
            cachedContentTokenCount?: number
          }
        }
      }
    ).value

    if (finished.usageMetadata) {
      this.accumulatedInputTokens += finished.usageMetadata.promptTokenCount ?? 0
      this.accumulatedOutputTokens += finished.usageMetadata.candidatesTokenCount ?? 0
      this.accumulatedCacheReadTokens += finished.usageMetadata.cachedContentTokenCount ?? 0
    }
  }

  // ─── Slash Commands ───

  override getSlashCommands(): Array<{
    name: string
    description: string
    usage: string
    source: 'builtin' | 'skill'
  }> {
    return [
      { name: 'clear', description: 'Reset session', usage: '/clear', source: 'builtin' },
      {
        name: 'compact',
        description: 'Compress chat context',
        usage: '/compact',
        source: 'builtin',
      },
      {
        name: 'model',
        description: 'Switch model or show current',
        usage: '/model [name]',
        source: 'builtin',
      },
      {
        name: 'cost',
        description: 'Show token usage summary',
        usage: '/cost',
        source: 'builtin',
      },
      {
        name: 'plan',
        description: 'Toggle plan mode (read-only)',
        usage: '/plan [on|off]',
        source: 'builtin',
      },
      {
        name: 'think',
        description: 'Set thinking budget: off, low, medium, high',
        usage: '/think [level]',
        source: 'builtin',
      },
    ]
  }

  override async handleSlashCommand(
    command: string,
    args: string,
    roomId?: string,
  ): Promise<{ success: boolean; message?: string }> {
    const rs = this.getRoomState(roomId)
    switch (command) {
      case 'clear': {
        this.resetSession(roomId)
        return { success: true, message: 'Session cleared' }
      }
      case 'compact': {
        if (!rs.client || !rs.initialized) {
          return { success: true, message: 'No active session to compress' }
        }
        try {
          const { nanoid } = await import('nanoid')
          const info = await rs.client.tryCompressChat(nanoid(), true)
          return {
            success: true,
            message: `Chat compressed: ${info.originalTokenCount} → ${info.newTokenCount} tokens`,
          }
        } catch (err) {
          return {
            success: false,
            message: `Compression failed: ${(err as Error).message}`,
          }
        }
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
        // Update model in-place if session is active; otherwise it takes effect on next init
        if (rs.config && rs.initialized) {
          rs.config.setModel(name)
          log.info(`Model switched in-place to: ${name}`)
        }
        return { success: true, message: `Model set to: ${name}` }
      }
      case 'cost': {
        const summary = this.getCostSummary()
        const lines = [
          'Token Usage Summary',
          `  Input tokens:  ${summary.inputTokens.toLocaleString()}`,
          `  Output tokens: ${summary.outputTokens.toLocaleString()}`,
          `  Cache read:    ${summary.cacheReadTokens.toLocaleString()}`,
        ]
        return { success: true, message: lines.join('\n') }
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
        // Update approval mode in-place if session is active
        if (rs.config && rs.initialized) {
          const sdk = _cachedSdk!
          const mode = rs.planMode ? sdk.ApprovalMode.PLAN : sdk.ApprovalMode.DEFAULT
          rs.config.setApprovalMode(mode)
          log.info(`Plan mode switched in-place to: ${rs.planMode}`)
        }
        return {
          success: true,
          message: `Plan mode: ${rs.planMode ? 'enabled' : 'disabled'}`,
        }
      }
      case 'think': {
        const level = args.trim().toLowerCase()
        if (!level) {
          return {
            success: true,
            message: `Thinking budget: ${rs.thinkingBudget}\nOptions: off, low, medium, high`,
          }
        }
        const valid = ['off', 'low', 'medium', 'high'] as const
        if (!valid.includes(level as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid thinking level: ${level}\nOptions: off, low, medium, high`,
          }
        }
        rs.thinkingBudget = level as 'off' | 'low' | 'medium' | 'high'
        // Note: thinking config in the Gemini SDK is per-model in defaultModelConfigs
        // and cannot be changed at runtime via Config. This setting is stored locally
        // and takes effect only when a new session is created (e.g. after /clear).
        return {
          success: true,
          message: `Thinking budget set to: ${level} (takes effect on next session)`,
        }
      }
      default:
        return { success: false, message: `Unknown command: ${command}` }
    }
  }

  // ─── Model Management ───

  override getModel(roomId?: string): string | undefined {
    return this.getRoomState(roomId).modelOverride ?? this.env.GEMINI_MODEL ?? undefined
  }

  // Model list derived from the SDK's VALID_GEMINI_MODELS set.
  // Automatically stays in sync when the SDK is upgraded.
  // Filters out internal variants and models that would be aliased away
  // (e.g. gemini-3-pro-preview → gemini-3.1-pro-preview when 3.1 is launched).
  override getAvailableModels(): string[] {
    if (!_cachedSdk) return []
    // For API key / Vertex auth, getGemini31LaunchedSync() returns true,
    // meaning gemini-3-pro-preview is aliased to gemini-3.1-pro-preview.
    // Use isActiveModel() to filter out aliased models so the user cannot
    // select a model that silently maps to a different one.
    const rs = this.getRoomState(this.currentRoomId)
    const useGemini31 = rs.config?.getGemini31LaunchedSync?.() ?? true
    return [..._cachedSdk.VALID_GEMINI_MODELS].filter((m) =>
      _cachedSdk!.isActiveModel(m, useGemini31),
    )
  }

  override getAvailableModelInfo(): ModelOption[] {
    return this.getAvailableModels().map((id) => ({
      value: id,
      displayName: id
        .split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' '),
    }))
  }

  override getPlanMode(roomId?: string): boolean {
    return this.getRoomState(roomId).planMode
  }

  override get supportsRewind() {
    return true
  }

  override async rewind(_messageId: string, roomId?: string) {
    // Reset the session so next message starts clean.
    // Server already deleted messages; room_context will resend truncated history.
    this.resetSession(roomId)
    return { success: true }
  }

  override getThinkingMode(roomId?: string): string | undefined {
    return this.getRoomState(roomId).thinkingBudget
  }

  override getAvailableThinkingModes(): string[] {
    return ['off', 'low', 'medium', 'high']
  }

  // ─── Session Lifecycle ───

  private resetSession(roomId?: string) {
    const rs = this.getRoomState(roomId)
    if (rs.config) {
      try {
        rs.config.dispose()
      } catch {
        // Ignore disposal errors
      }
    }
    rs.config = undefined
    rs.client = undefined
    rs.initialized = false
    log.info('Gemini session reset')
  }

  stop() {
    if (this.streamAbort) {
      this.streamAbort.abort()
      log.info('Gemini stream aborted')
    }
    this.streamAbort = undefined
    this.isRunning = false
    this.resetSession(this.currentRoomId)
  }

  dispose() {
    if (this.streamAbort) {
      this.streamAbort.abort()
    }
    this.streamAbort = undefined
    this.isRunning = false
    // Dispose all room sessions
    for (const [, rs] of this.roomStates) {
      if (rs.config) {
        try {
          rs.config.dispose()
        } catch {
          // Ignore disposal errors
        }
      }
    }
    this.roomStates.clear()
    _cachedSdk = null
  }
}
