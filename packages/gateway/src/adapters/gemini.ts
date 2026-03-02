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
export class GeminiAdapter extends BaseAgentAdapter {
  // SDK instances (lazy)
  private config?: InstanceType<typeof import('@google/gemini-cli-core').Config>
  private client?: InstanceType<typeof import('@google/gemini-cli-core').GeminiClient>
  private initialized = false

  // Stream control
  private streamAbort?: AbortController
  private promptCounter = 0

  // Runtime settings
  private modelOverride?: string
  private planMode = false
  private thinkingBudget: 'off' | 'low' | 'medium' | 'high' = 'off'

  constructor(opts: AdapterOptions) {
    super(opts)
    // Eagerly trigger SDK load so model info is available for getAvailableModels()
    this.ensureSdk().catch(() => {})
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
    _context?: MessageContext,
  ): Promise<InstanceType<typeof import('@google/gemini-cli-core').GeminiClient>> {
    if (this.client && this.initialized) {
      return this.client
    }

    const sdk = await this.ensureSdk()

    // Determine approval mode
    let approvalMode = sdk.ApprovalMode.DEFAULT
    if (this.permissionLevel === 'bypass') {
      approvalMode = sdk.ApprovalMode.YOLO
    } else if (this.planMode) {
      approvalMode = sdk.ApprovalMode.PLAN
    }

    const model = this.modelOverride ?? this.env.GEMINI_MODEL ?? sdk.DEFAULT_GEMINI_MODEL

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
      ...(this.thinkingBudget !== 'off' ? { thinkingBudget: this.thinkingBudget } : {}),
    }
    this.config = new sdk.Config(configOpts)

    // Config._initialize() calls geminiClient.initialize() which requires
    // a contentGenerator, but contentGenerator is only set inside
    // refreshAuth(). We must call refreshAuth() BEFORE initialize().
    const authType = sdk.getAuthTypeFromEnv()
    if (authType) {
      await this.config.refreshAuth(authType)
    } else {
      // Default to API key auth — GEMINI_API_KEY should be set
      await this.config.refreshAuth(sdk.AuthType.USE_GEMINI)
    }

    await this.config.initialize()

    // Use the Config's own pre-initialized geminiClient — it shares the
    // contentGenerator set by refreshAuth() above.
    this.client = (this.config as any).geminiClient as InstanceType<
      typeof import('@google/gemini-cli-core').GeminiClient
    >
    this.initialized = true

    log.info(`Gemini client initialized (model: ${model}, session: ${sessionId})`)
    return this.client!
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
      const client = await this.ensureClient(context)
      const sdk = await this.ensureSdk()
      const prompt = this.buildPrompt(content, context)

      this.streamAbort = new AbortController()
      this.promptCounter++
      const promptId = `prompt-${this.promptCounter}`

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
          const errMsg = errVal.error instanceof Error ? errVal.error.message : String(errVal.error)
          this.isRunning = false
          this.streamAbort = undefined
          onError(errMsg)
          return
        }
      }

      this.isRunning = false
      this.streamAbort = undefined
      onComplete(fullContent)
    } catch (err: unknown) {
      this.isRunning = false
      this.streamAbort = undefined
      if ((err as Error).name === 'AbortError') {
        onComplete(fullContent || 'Interrupted')
      } else {
        const msg = err instanceof Error ? err.message : String(err)
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
        const errMsg = errVal.error instanceof Error ? errVal.error.message : String(errVal.error)
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
        return [
          {
            type: 'text',
            content: '[Retrying request...]',
            metadata: { retry: true },
          },
        ]

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

      case sdk.GeminiEventType.ModelInfo: {
        const modelInfo = (event as { value: string }).value
        return [
          {
            type: 'text',
            content: `[Model: ${modelInfo}]`,
            metadata: { modelInfo: true },
          },
        ]
      }

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
  ): Promise<{ success: boolean; message?: string }> {
    switch (command) {
      case 'clear': {
        this.resetSession()
        return { success: true, message: 'Session cleared' }
      }
      case 'compact': {
        if (!this.client || !this.initialized) {
          return { success: true, message: 'No active session to compress' }
        }
        try {
          const { nanoid } = await import('nanoid')
          const info = await this.client.tryCompressChat(nanoid(), true)
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
          const current = this.getModel() ?? '(default)'
          return {
            success: true,
            message: `Current model: ${current}\nUse /model <name> to switch`,
          }
        }
        this.modelOverride = name
        // Reset session so next message uses the new model
        this.resetSession()
        return { success: true, message: `Model set to: ${name} (session will restart)` }
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
          this.planMode = true
        } else if (arg === 'off' || arg === 'false' || arg === '0') {
          this.planMode = false
        } else {
          this.planMode = !this.planMode
        }
        // Reset session so approval mode updates
        this.resetSession()
        return {
          success: true,
          message: `Plan mode: ${this.planMode ? 'enabled' : 'disabled'}`,
        }
      }
      case 'think': {
        const level = args.trim().toLowerCase()
        if (!level) {
          return {
            success: true,
            message: `Thinking budget: ${this.thinkingBudget}\nOptions: off, low, medium, high`,
          }
        }
        const valid = ['off', 'low', 'medium', 'high'] as const
        if (!valid.includes(level as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid thinking level: ${level}\nOptions: off, low, medium, high`,
          }
        }
        this.thinkingBudget = level as 'off' | 'low' | 'medium' | 'high'
        // Reset session so Config is recreated with the new thinking budget
        this.resetSession()
        return {
          success: true,
          message: `Thinking budget set to: ${level} (session will restart)`,
        }
      }
      default:
        return { success: false, message: `Unknown command: ${command}` }
    }
  }

  // ─── Model Management ───

  override getModel(): string | undefined {
    return this.modelOverride ?? this.env.GEMINI_MODEL ?? undefined
  }

  // Model list derived from the SDK's VALID_GEMINI_MODELS set.
  // Automatically stays in sync when the SDK is upgraded.
  override getAvailableModels(): string[] {
    if (!_cachedSdk) return []
    return [..._cachedSdk.VALID_GEMINI_MODELS].filter(
      (m) => !m.includes('customtools'), // internal variant
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

  override getPlanMode(): boolean {
    return this.planMode
  }

  override getThinkingMode(): string | undefined {
    return this.thinkingBudget
  }

  override getAvailableThinkingModes(): string[] {
    return ['off', 'low', 'medium', 'high']
  }

  // ─── Session Lifecycle ───

  private resetSession() {
    if (this.config) {
      try {
        this.config.dispose()
      } catch {
        // Ignore disposal errors
      }
    }
    this.config = undefined
    this.client = undefined
    this.initialized = false
    log.info('Gemini session reset')
  }

  stop() {
    if (this.streamAbort) {
      this.streamAbort.abort()
      log.info('Gemini stream aborted')
    }
    this.streamAbort = undefined
    this.isRunning = false
    this.resetSession()
  }

  dispose() {
    if (this.streamAbort) {
      this.streamAbort.abort()
    }
    this.streamAbort = undefined
    this.isRunning = false
    this.resetSession()
    _cachedSdk = null
  }
}
