import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

/**
 * Extract human-readable text from a structured tool result object.
 * Gemini tool results (e.g. run_shell_command) often return objects like
 * `{ok: true, output: "..."}` or `{ok: false, error: "..."}`.
 * This extracts the meaningful text content instead of showing raw JSON.
 */
function formatToolResult(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)

  const obj = value as Record<string, unknown>

  // Shell command results: {ok, output, error, exitCode}
  if ('output' in obj && typeof obj.output === 'string') {
    const parts: string[] = []
    if (obj.output) parts.push(obj.output)
    if (obj.error && typeof obj.error === 'string') parts.push(obj.error)
    return parts.join('\n') || (obj.ok === false ? 'Command failed' : '')
  }

  // Error-only result: {ok: false, error: "..."}
  if ('error' in obj && typeof obj.error === 'string') {
    return obj.error
  }

  // Result with a message field
  if ('message' in obj && typeof obj.message === 'string') {
    return obj.message
  }

  // Fallback: pretty-print JSON
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
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
  // Per-room abort controllers for parallel stream processing
  private streamAborts = new Map<string, AbortController>()

  // Per-room state
  private roomStates = new Map<string, GeminiRoomState>()

  constructor(opts: AdapterOptions) {
    super(opts)
    // Eagerly trigger SDK load so model info is available for getAvailableModels()
    this.ensureSdk().catch(() => {})
  }

  // ─── Session Persistence ───

  /** Directory for storing per-room conversation history. */
  private getHistoryDir(): string | undefined {
    if (!this.workingDirectory) return undefined
    return join(this.workingDirectory, '.gemini', '.agentim-history')
  }

  /** Path to the history file for a specific room. */
  private getHistoryPath(roomId: string): string | undefined {
    const dir = this.getHistoryDir()
    if (!dir) return undefined
    // Sanitize roomId for filesystem safety
    const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(dir, `${safe}.json`)
  }

  /** Persist conversation history for a room to survive gateway restarts. */
  private persistHistory(roomId: string, history: unknown[]): void {
    const path = this.getHistoryPath(roomId)
    if (!path) return
    try {
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(history))
    } catch (err) {
      log.warn(`Failed to persist Gemini history: ${(err as Error).message}`)
    }
  }

  /** Load persisted conversation history for a room. */
  private loadPersistedHistory(roomId: string): unknown[] | undefined {
    const path = this.getHistoryPath(roomId)
    if (!path || !existsSync(path)) return undefined
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      if (Array.isArray(data) && data.length > 0) {
        log.info(`Loaded persisted Gemini history for room ${roomId} (${data.length} entries)`)
        return data
      }
    } catch {
      // Corrupt file — start fresh
    }
    return undefined
  }

  /** Remove persisted history for a room. */
  private removePersistedHistory(roomId: string): void {
    const path = this.getHistoryPath(roomId)
    if (!path || !existsSync(path)) return
    try {
      unlinkSync(path)
    } catch {
      // Non-critical
    }
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

  override get supportsParallelRooms() {
    return true
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

    // The Gemini SDK is an in-process library that reads auth directly from
    // process.env (not from constructor params).  We must bridge agent-specific
    // env vars into process.env.  GEMINI_CLI_HOME is critical for subscription
    // mode — the SDK's homedir() reads it to find the isolated auth directory.
    //
    // LIMITATION: process.env is global state.  Multiple Gemini agents with
    // different credentials in the same Node.js process will clobber each
    // other's env vars.  In practice each gateway runs one agent, so this
    // is acceptable.  We save/restore previous values to minimize pollution.
    const envKeys = [
      'GEMINI_API_KEY',
      'GEMINI_CLI_HOME',
      'GEMINI_BASE_URL',
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

    // Determine approval mode based on permission level and daemon mode.
    // When interactive permission bridge is available (onPermissionRequest callback),
    // use DEFAULT mode so the SDK's PolicyEngine emits ASK_USER decisions that
    // our MessageBus listener can intercept and forward to the web UI.
    const hasPermissionBridge = this.permissionLevel === 'interactive' && !!this.onPermissionRequest
    let approvalMode = sdk.ApprovalMode.DEFAULT
    if (this.permissionLevel === 'bypass') {
      approvalMode = sdk.ApprovalMode.YOLO
    } else if (!hasPermissionBridge && !process.stdin.isTTY) {
      // No permission bridge and no TTY — must auto-approve to avoid blocking
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

    // Register MessageBus listener for interactive permission bridging.
    // When the PolicyEngine decides ASK_USER, the request is emitted to this
    // listener instead of being auto-rejected. We forward it to the AgentIM
    // permission system and publish the response back.
    if (hasPermissionBridge) {
      const messageBus = rs.config.getMessageBus()
      const { MessageBusType: MBT, ToolConfirmationOutcome: TCO } = sdk
      type ToolConfirmationRequest = import('@google/gemini-cli-core').ToolConfirmationRequest
      const requestPermission = this.onPermissionRequest!
      const { nanoid: genId } = await import('nanoid')

      messageBus.subscribe<ToolConfirmationRequest>(MBT.TOOL_CONFIRMATION_REQUEST, (request) => {
        const toolName = request.toolCall?.name ?? 'unknown'
        const toolInput = (request.toolCall?.args ?? {}) as Record<string, unknown>
        if (request.details) {
          toolInput._confirmationDetails = request.details
        }
        if (request.serverName) {
          toolInput._serverName = request.serverName
        }

        const requestId = genId()
        requestPermission({
          requestId,
          toolName,
          toolInput,
          timeoutMs: 300_000,
        })
          .then((result) => {
            const confirmed = result.behavior === 'allow' || result.behavior === 'allowAlways'
            const outcome = confirmed
              ? result.behavior === 'allowAlways'
                ? TCO.ProceedAlways
                : TCO.ProceedOnce
              : TCO.Cancel

            messageBus.publish({
              type: MBT.TOOL_CONFIRMATION_RESPONSE,
              correlationId: request.correlationId,
              confirmed,
              outcome,
            })

            if (result.behavior === 'allowAlways') {
              messageBus.publish({
                type: MBT.UPDATE_POLICY,
                toolName,
              })
            }
          })
          .catch((err) => {
            log.error(`Permission request failed: ${(err as Error).message}`)
            messageBus.publish({
              type: MBT.TOOL_CONFIRMATION_RESPONSE,
              correlationId: request.correlationId,
              confirmed: false,
              outcome: TCO.Cancel,
            })
          })
      })
      log.info('Gemini MessageBus permission bridge registered')
    }

    // Use the Config's own pre-initialized geminiClient — it shares the
    // contentGenerator set by refreshAuth() above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rs.client = (rs.config as any).geminiClient as InstanceType<
      typeof import('@google/gemini-cli-core').GeminiClient
    >
    rs.initialized = true

    log.info(
      `Gemini client initialized (model: ${model}, session: ${sessionId}, approval: ${approvalMode})`,
    )

    // Restore persisted conversation history from a previous gateway run
    const key = roomId ?? DEFAULT_ROOM_KEY
    const savedHistory = this.loadPersistedHistory(key)
    if (savedHistory && rs.client) {
      try {
        await rs.client.resumeChat(savedHistory as import('@google/genai').Content[])
        log.info(`Resumed Gemini conversation for room ${key} from persisted history`)
      } catch (err) {
        log.warn(`Failed to resume Gemini history: ${(err as Error).message} — starting fresh`)
        this.removePersistedHistory(key)
      }
    }

    return rs.client!
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
    let fullContent = ''
    let capacityAborted = false
    let retryError = ''

    try {
      const rs = this.getRoomState(roomId)
      const client = await this.ensureClient(roomId)
      const sdk = await this.ensureSdk()
      const prompt = this.buildPrompt(content, context)

      const streamAbort = new AbortController()
      this.streamAborts.set(roomId, streamAbort)
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
        streamAbort.abort()
        log.warn(`Aborting SDK retries — surfacing error to user: ${retryError}`)
      }
      sdk.coreEvents.on(sdk.CoreEvent.RetryAttempt, retryListener)

      try {
        // Agentic tool execution loop: the SDK's sendMessageStream yields
        // events but does NOT execute tools.  When the model requests tool
        // calls, we execute them and feed the results back.
        const MAX_TOOL_TURNS = 50
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let request: any = prompt

        for (let turnIdx = 0; turnIdx < MAX_TOOL_TURNS; turnIdx++) {
          const stream = client.sendMessageStream(request, streamAbort.signal, promptId)

          // Manually iterate the async generator to capture the Turn return
          // value (which contains pendingToolCalls).  for-await-of discards it.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let turn: any
          let errorBailed = false

          for (;;) {
            const iterResult = await stream.next()
            if (iterResult.done) {
              turn = iterResult.value
              break
            }

            const event = iterResult.value
            const chunks = this.processEvent(event, sdk)
            for (const chunk of chunks) {
              if (chunk.type === 'text') {
                fullContent += chunk.content
              }
              onChunk(chunk)
            }

            if (event.type === sdk.GeminiEventType.Finished) {
              this.extractUsage(event, sdk)
            }

            if (event.type === sdk.GeminiEventType.Error) {
              const errVal = (event as { value: { error: unknown } }).value
              const errMsg = extractErrorMessage(errVal.error)
              this.setRoomBusy(roomId, false)
              this.streamAborts.delete(roomId)
              onError(errMsg)
              errorBailed = true
              break
            }
          }

          if (errorBailed) return

          // If the SDK handled the abort internally (no throw), the stream
          // ends normally but fullContent is empty.
          if (capacityAborted && !fullContent) {
            this.setRoomBusy(roomId, false)
            this.streamAborts.delete(roomId)
            onError(retryError || 'Request aborted due to retry failure')
            return
          }

          // No pending tool calls — conversation turn is complete
          if (!turn?.pendingToolCalls?.length) break

          // Execute pending tool calls and build function responses
          const pendingCalls = turn.pendingToolCalls as Array<{
            callId: string
            name: string
            args: Record<string, unknown>
          }>
          log.info(
            `Executing ${pendingCalls.length} tool call(s) (turn ${turnIdx + 1}): ${pendingCalls.map((c) => c.name).join(', ')}`,
          )

          const toolRegistry = rs.config!.getToolRegistry()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const functionResponseParts: any[] = []

          for (const tc of pendingCalls) {
            const tool = toolRegistry.getTool(tc.name)
            if (!tool) {
              functionResponseParts.push({
                functionResponse: {
                  id: tc.callId,
                  name: tc.name,
                  response: { error: `Tool "${tc.name}" not found` },
                },
              })
              onChunk({
                type: 'tool_result',
                content: `Error: Tool "${tc.name}" not found`,
                metadata: { toolId: tc.callId },
              })
              continue
            }

            try {
              const invocation = tool.build(tc.args)
              const result = await invocation.execute(streamAbort.signal)

              // Build function response parts for the Gemini API
              const responseParts = sdk.convertToFunctionResponse(
                tc.name,
                tc.callId,
                result.llmContent,
                rs.config!.getActiveModel(),
              )
              functionResponseParts.push(...responseParts)

              // Emit tool_result chunk for the UI.
              // Prefer returnDisplay (human-friendly), then llmContent (model-facing).
              // When the value is a structured object (e.g. shell command result
              // like {ok, output, error}), extract meaningful text instead of
              // showing raw JSON.
              const display = result.error
                ? `Error: ${result.error.message}`
                : typeof result.returnDisplay === 'string'
                  ? result.returnDisplay
                  : typeof result.llmContent === 'string'
                    ? result.llmContent
                    : formatToolResult(result.llmContent)
              onChunk({
                type: 'tool_result',
                content: display,
                metadata: { toolId: tc.callId },
              })
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err)
              log.warn(`Tool "${tc.name}" execution failed: ${errMsg}`)
              functionResponseParts.push({
                functionResponse: {
                  id: tc.callId,
                  name: tc.name,
                  response: { error: errMsg },
                },
              })
              onChunk({
                type: 'tool_result',
                content: `Error: ${errMsg}`,
                metadata: { toolId: tc.callId },
              })
            }
          }

          // Feed function responses back as the next request
          request = functionResponseParts
        }

        this.setRoomBusy(roomId, false)
        this.streamAborts.delete(roomId)

        // Persist conversation history for cross-restart recovery
        try {
          const history = client.getHistory()
          if (history.length > 0) {
            this.persistHistory(roomId, history)
          }
        } catch (err) {
          log.debug?.(`Failed to persist history after message: ${(err as Error).message}`)
        }
        onComplete(fullContent)
      } finally {
        sdk.coreEvents.off(sdk.CoreEvent.RetryAttempt, retryListener)
      }
    } catch (err: unknown) {
      this.setRoomBusy(roomId, false)
      this.streamAborts.delete(roomId)
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
            : formatToolResult(resp.resultDisplay)
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
          // Persist the compressed history
          const key = roomId ?? DEFAULT_ROOM_KEY
          try {
            const history = rs.client.getHistory()
            if (history.length > 0) this.persistHistory(key, history)
          } catch {
            // Non-critical
          }
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
    // Check any initialized room state for Gemini 3.1 launch flag
    let useGemini31 = true
    for (const [, rs] of this.roomStates) {
      if (rs.config) {
        useGemini31 = rs.config.getGemini31LaunchedSync?.() ?? true
        break
      }
    }
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
    const key = roomId ?? DEFAULT_ROOM_KEY
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
    this.removePersistedHistory(key)
    log.info('Gemini session reset')
  }

  stop() {
    // Abort all active room streams
    for (const [roomId, abort] of this.streamAborts) {
      abort.abort()
      this.resetSession(roomId)
    }
    this.streamAborts.clear()
    this.clearAllBusy()
    log.info('Gemini all streams aborted')
  }

  dispose() {
    for (const [, abort] of this.streamAborts) {
      abort.abort()
    }
    this.streamAborts.clear()
    this.clearAllBusy()
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
