import type { ParsedChunk } from '@agentim/shared'
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

// Hypothetical SDK type declarations based on known Gemini CLI patterns.
// These mirror the structure of @anthropic-ai/claude-agent-sdk but adapted
// for the Gemini CLI tool-use / streaming interface.
//
// The SDK is expected to export:
//   - createSession(): creates a persistent conversation session
//   - GeminiSession: manages queries within a session
//   - Stream event types for incremental output
interface GeminiSessionOptions {
  apiKey?: string
  model?: string
  cwd?: string
  env?: Record<string, string>
  systemPrompt?: string
  allowedTools?: string[]
  permissionMode?: 'auto_approve' | 'interactive'
  canUseTool?: (
    toolName: string,
    toolInput: Record<string, unknown>,
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>
}

interface GeminiSession {
  readonly sessionId: string
  query(prompt: string): GeminiQuery
  close(): void
}

interface GeminiQuery {
  [Symbol.asyncIterator](): AsyncIterator<GeminiStreamEvent>
  abort(): void
}

// Stream event types the SDK is expected to emit
type GeminiStreamEvent =
  | GeminiInitEvent
  | GeminiTextDeltaEvent
  | GeminiThinkingDeltaEvent
  | GeminiToolCallEvent
  | GeminiToolResultEvent
  | GeminiTurnCompleteEvent
  | GeminiErrorEvent

interface GeminiInitEvent {
  type: 'init'
  sessionId: string
}

interface GeminiTextDeltaEvent {
  type: 'text_delta'
  text: string
}

interface GeminiThinkingDeltaEvent {
  type: 'thinking_delta'
  thought: string
}

interface GeminiToolCallEvent {
  type: 'tool_call'
  id: string
  name: string
  input: Record<string, unknown>
}

interface GeminiToolResultEvent {
  type: 'tool_result'
  toolCallId: string
  output: string | Record<string, unknown>
}

interface GeminiTurnCompleteEvent {
  type: 'turn_complete'
  text?: string
}

interface GeminiErrorEvent {
  type: 'error'
  message: string
  code?: string
}

// Hypothetical SDK module shape
interface GeminiSdkModule {
  createSession(options: GeminiSessionOptions): Promise<GeminiSession>
}

const log = createLogger('Gemini')

// Set to true once @google/gemini-cli-sdk is published to npm
const GEMINI_SDK_AVAILABLE = false

// Cache the dynamically imported SDK module to avoid repeated import() calls
let _cachedSdkModule: GeminiSdkModule | null = null

/**
 * Gemini adapter — full implementation gated behind SDK availability.
 *
 * Architecture mirrors ClaudeCodeAdapter:
 * - Lazy dynamic import of the SDK (cached after first load)
 * - Persistent session management across messages
 * - Streaming support via async iteration over query events
 * - Permission handling delegated to the hub via onPermissionRequest callback
 * - Maps all Gemini stream events to ParsedChunk types
 *
 * Will be activated once @google/gemini-cli-sdk is published to npm.
 */
export class GeminiAdapter extends BaseAgentAdapter {
  private session?: GeminiSession
  private currentQuery?: GeminiQuery

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  get type() {
    return 'gemini' as const
  }

  /**
   * Lazily load and cache the Gemini SDK module.
   * Uses dynamic import so the gateway does not fail at startup
   * when the SDK is not installed.
   */
  private async ensureSdk(): Promise<GeminiSdkModule> {
    if (!_cachedSdkModule) {
      // Dynamic import — will throw if the package is not installed
      const mod = (await import('@google/gemini-cli-sdk' as string)) as unknown as GeminiSdkModule
      _cachedSdkModule = mod
    }
    return _cachedSdkModule
  }

  /**
   * Ensure we have an active session, creating one if needed.
   * Reuses an existing session for multi-turn conversations.
   */
  private async ensureSession(context?: MessageContext): Promise<GeminiSession> {
    if (this.session) {
      return this.session
    }

    const sdk = await this.ensureSdk()

    const options: GeminiSessionOptions = {
      apiKey: this.env.GOOGLE_API_KEY || this.env.GEMINI_API_KEY || undefined,
      model: this.env.GEMINI_MODEL || undefined,
      cwd: this.workingDirectory,
      env: Object.keys(this.env).length > 0 ? this.env : undefined,
      allowedTools: [
        'read_file',
        'write_file',
        'edit_file',
        'run_command',
        'search_files',
        'web_search',
      ],
    }

    // Configure permission handling
    if (this.permissionLevel === 'bypass') {
      options.permissionMode = 'auto_approve'
    } else {
      options.permissionMode = 'interactive'
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
          if (result.behavior === 'allow') {
            return { behavior: 'allow' as const }
          }
          return { behavior: 'deny' as const, message: 'Permission denied by user' }
        }
      }
    }

    // Inject system prompt from room context if available
    if (context?.roomContext?.systemPrompt) {
      options.systemPrompt = context.roomContext.systemPrompt
    }

    this.session = await sdk.createSession(options)
    log.info(`Gemini session started: ${this.session.sessionId}`)
    return this.session
  }

  async sendMessage(
    content: string,
    onChunk: ChunkCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
    context?: MessageContext,
  ) {
    // Gate behind SDK availability flag
    if (!GEMINI_SDK_AVAILABLE) {
      onError(
        'Gemini SDK (@google/gemini-cli-sdk) is not yet published to npm. ' +
          'Gemini agent support will be enabled once the SDK is available. ' +
          'Follow https://github.com/NoPKT/AgentIM for updates.',
      )
      return
    }

    if (this.isRunning) {
      onError('Agent is already processing a message')
      return
    }

    this.isRunning = true
    let fullContent = ''

    try {
      const session = await this.ensureSession(context)
      const prompt = this.buildPrompt(content, context)

      const query = session.query(prompt)
      this.currentQuery = query

      for await (const event of query) {
        const chunks = this.mapEventToChunks(event)
        for (const chunk of chunks) {
          if (chunk.type === 'text') {
            fullContent += chunk.content
          }
          onChunk(chunk)
        }

        // If the SDK emits an error event, report and bail out
        if (event.type === 'error') {
          this.isRunning = false
          this.currentQuery = undefined
          onError((event as GeminiErrorEvent).message)
          return
        }
      }

      this.isRunning = false
      this.currentQuery = undefined
      onComplete(fullContent)
    } catch (err: unknown) {
      this.isRunning = false
      this.currentQuery = undefined
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
   * Map a single Gemini stream event to zero or more ParsedChunks.
   *
   * Event type mapping:
   *   init            -> (captured internally, no chunk emitted)
   *   text_delta      -> ParsedChunk { type: 'text' }
   *   thinking_delta  -> ParsedChunk { type: 'thinking' }
   *   tool_call       -> ParsedChunk { type: 'tool_use' }
   *   tool_result     -> ParsedChunk { type: 'tool_result' }
   *   turn_complete   -> ParsedChunk { type: 'text' } (if final text present)
   *   error           -> ParsedChunk { type: 'error' }
   */
  private mapEventToChunks(event: GeminiStreamEvent): ParsedChunk[] {
    switch (event.type) {
      case 'init':
        // Session ID already captured during ensureSession;
        // log it here in case it is re-emitted during a query
        log.debug(`Gemini query init, session: ${event.sessionId}`)
        return []

      case 'text_delta':
        return [{ type: 'text', content: event.text }]

      case 'thinking_delta':
        return [{ type: 'thinking', content: event.thought }]

      case 'tool_call':
        return [
          {
            type: 'tool_use',
            content: JSON.stringify(
              { name: event.name, id: event.id, input: event.input },
              null,
              2,
            ),
            metadata: { toolName: event.name, toolId: event.id },
          },
        ]

      case 'tool_result': {
        const output =
          typeof event.output === 'string' ? event.output : JSON.stringify(event.output)
        return [
          {
            type: 'tool_result',
            content: output,
            metadata: { toolId: event.toolCallId },
          },
        ]
      }

      case 'turn_complete':
        // If the turn_complete event carries final assembled text,
        // emit it as a text chunk (it may be empty if all text was
        // already streamed via text_delta events)
        if (event.text) {
          return [{ type: 'text', content: event.text }]
        }
        return []

      case 'error':
        return [{ type: 'error', content: event.message }]

      default:
        // Unknown event type — ignore gracefully
        log.debug(`Ignoring unknown Gemini event type: ${(event as { type: string }).type}`)
        return []
    }
  }

  override getSlashCommands(): Array<{
    name: string
    description: string
    usage: string
    source: 'builtin' | 'skill'
  }> {
    return [{ name: 'clear', description: 'Reset session', usage: '/clear', source: 'builtin' }]
  }

  override async handleSlashCommand(
    command: string,
    _args: string,
  ): Promise<{ success: boolean; message?: string }> {
    if (command === 'clear') {
      this.session = undefined
      return { success: true, message: 'Session cleared' }
    }
    return { success: false, message: `Unknown command: ${command}` }
  }

  /**
   * Abort the current query and reset session state.
   * The session is discarded so the next sendMessage() starts fresh.
   */
  stop() {
    if (this.currentQuery) {
      this.currentQuery.abort()
      log.info('Gemini query aborted')
    }
    this.currentQuery = undefined
    this.isRunning = false
    // Discard session so a new one is created on next message,
    // avoiding stale conversation context after interruption
    if (this.session) {
      this.session.close()
      this.session = undefined
    }
  }

  /**
   * Fully dispose of the adapter: close session and release all resources.
   */
  dispose() {
    if (this.currentQuery) {
      this.currentQuery.abort()
    }
    this.currentQuery = undefined
    this.isRunning = false
    if (this.session) {
      this.session.close()
      this.session = undefined
    }
    // Clear the cached SDK module reference so it can be garbage collected
    // (only relevant if no other GeminiAdapter instances exist)
    _cachedSdkModule = null
  }
}
