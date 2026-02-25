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
import type {
  OpencodeClient,
  Event,
  TextPart,
  ReasoningPart,
  ToolPart,
  Part,
} from '@opencode-ai/sdk'

const log = createLogger('OpenCode')

export class OpenCodeAdapter extends BaseAgentAdapter {
  // SDK state managed by createOpencode()
  private client?: OpencodeClient
  private serverClose?: () => void
  private sessionId?: string

  // Streaming state: track deltas to avoid duplicate content
  private lastTextLength = new Map<string, number>()
  private lastToolStatus = new Map<string, string>()

  // Abort handle for the current SSE event stream
  private streamAbort?: AbortController

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  get type() {
    return 'opencode' as const
  }

  /** Initialize the OpenCode server and SDK client. */
  private async ensureClient(): Promise<OpencodeClient> {
    if (this.client) return this.client

    // If user provides OPENCODE_BASE_URL, connect to existing server
    const envUrl = this.env.OPENCODE_BASE_URL
    if (envUrl) {
      const { createOpencodeClient } = await import('@opencode-ai/sdk')
      this.client = createOpencodeClient({
        baseUrl: envUrl,
        ...(this.workingDirectory ? { directory: this.workingDirectory } : {}),
      })
      log.info(`Connected to existing OpenCode server at ${envUrl}`)
      return this.client
    }

    // Otherwise, spawn a managed server via createOpencode()
    const { createOpencode } = await import('@opencode-ai/sdk')
    const { client, server } = await createOpencode()
    this.client = client
    this.serverClose = server.close
    log.info(`OpenCode server started at ${server.url}`)
    return this.client
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
    let completed = false

    // Reset per-message tracking state
    this.lastTextLength.clear()
    this.lastToolStatus.clear()

    try {
      const client = await this.ensureClient()

      // Create or reuse session
      if (!this.sessionId) {
        const { data: session } = await client.session.create({})
        if (!session) throw new Error('Failed to create OpenCode session')
        this.sessionId = session.id
        log.info(`Created OpenCode session: ${this.sessionId}`)
      }

      const prompt = this.buildPrompt(content, context)
      const sessionId = this.sessionId

      // Determine model and provider from env
      const modelID = this.env.OPENCODE_MODEL_ID
      const providerID = this.env.OPENCODE_PROVIDER_ID

      // Start SSE event stream before sending the prompt
      const abortController = new AbortController()
      this.streamAbort = abortController
      const sseResult = await client.event.subscribe({
        signal: abortController.signal,
      })

      // Fire off the prompt (async — returns full response when done)
      const promptPromise = client.session
        .prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: 'text', text: prompt }],
            ...(modelID && providerID ? { model: { modelID, providerID } } : {}),
            ...(context?.roomContext?.systemPrompt
              ? { system: context.roomContext.systemPrompt }
              : {}),
          },
        })
        .catch((err: unknown) => {
          if (!completed) throw err
        })

      // Process SSE events for streaming
      for await (const event of sseResult.stream) {
        if (!this.isRunning) break

        const ev = event as Event

        if (ev.type === 'message.part.updated') {
          const props = ev.properties as { part: Part; delta?: string }
          const part = props.part
          if (!('sessionID' in part) || part.sessionID !== sessionId) continue

          const chunks = this.mapPartToChunks(part, props.delta)
          for (const chunk of chunks) {
            if (chunk.type === 'text') fullContent += chunk.content
            onChunk(chunk)
          }
        }

        if (ev.type === 'session.error') {
          const props = ev.properties as {
            sessionID?: string
            error?: { data?: { message?: string } }
          }
          if (props.sessionID === sessionId) {
            completed = true
            this.isRunning = false
            this.streamAbort = undefined
            const errMsg =
              props.error?.data?.message || JSON.stringify(props.error) || 'Unknown OpenCode error'
            onError(errMsg)
            break
          }
        }

        if (ev.type === 'session.idle') {
          const props = ev.properties as { sessionID?: string }
          if (props.sessionID === sessionId) {
            break
          }
        }

        if (ev.type === 'permission.updated') {
          const perm = ev.properties as {
            id: string
            sessionID: string
            title: string
            metadata: Record<string, unknown>
          }
          if (perm.sessionID === sessionId && this.onPermissionRequest) {
            // Relay permission request through AgentIM's permission flow
            this.handlePermission(client, sessionId, perm).catch((err: unknown) => {
              log.warn(`Permission handling failed: ${(err as Error).message}`)
            })
          }
        }
      }

      // Ensure the prompt request completes
      try {
        await promptPromise
      } catch {
        // Error already handled via SSE or will be caught by outer catch
      }

      if (!completed) {
        completed = true
        this.isRunning = false
        this.streamAbort = undefined
        onComplete(fullContent)
      }
    } catch (err: unknown) {
      this.isRunning = false
      this.streamAbort = undefined
      if (completed) return

      if ((err as Error).name === 'AbortError') {
        onComplete(fullContent || 'Interrupted')
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`OpenCode SDK error: ${msg}`)
        onError(msg)
      }
    }
  }

  /** Relay a permission request from OpenCode through AgentIM's permission flow. */
  private async handlePermission(
    client: OpencodeClient,
    sessionId: string,
    perm: { id: string; title: string; metadata: Record<string, unknown> },
  ) {
    if (!this.onPermissionRequest) return

    const { nanoid } = await import('nanoid')
    const requestId = nanoid()
    const result = await this.onPermissionRequest({
      requestId,
      toolName: perm.title,
      toolInput: perm.metadata,
      timeoutMs: PERMISSION_TIMEOUT_MS,
    })

    const response = result.behavior === 'allow' ? 'once' : 'reject'
    await client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: perm.id },
      body: { response },
    })
  }

  /**
   * Map an SSE part update to ParsedChunk(s).
   * Uses the `delta` field for text when available; otherwise computes delta
   * by comparing with the last seen text length.
   */
  private mapPartToChunks(part: Part, delta?: string): ParsedChunk[] {
    if (part.type === 'text') {
      const textPart = part as TextPart
      // Prefer the SSE delta if available
      if (delta) {
        return [{ type: 'text', content: delta }]
      }
      // Fall back to length-based delta tracking
      const partId = textPart.id
      const text = textPart.text
      const lastLen = this.lastTextLength.get(partId) ?? 0
      if (text.length > lastLen) {
        const textDelta = text.slice(lastLen)
        this.lastTextLength.set(partId, text.length)
        return [{ type: 'text', content: textDelta }]
      }
      return []
    }

    if (part.type === 'reasoning') {
      const reasoningPart = part as ReasoningPart
      if (delta) {
        return [{ type: 'thinking', content: delta }]
      }
      const partId = reasoningPart.id
      const text = reasoningPart.text
      const lastLen = this.lastTextLength.get(partId) ?? 0
      if (text.length > lastLen) {
        const textDelta = text.slice(lastLen)
        this.lastTextLength.set(partId, text.length)
        return [{ type: 'thinking', content: textDelta }]
      }
      return []
    }

    if (part.type === 'tool') {
      const toolPart = part as ToolPart
      const { callID, tool, state } = toolPart

      // Only emit on state transitions
      const prevStatus = this.lastToolStatus.get(callID)
      if (prevStatus === state.status) return []
      this.lastToolStatus.set(callID, state.status)

      if (state.status === 'running') {
        const title = state.title ?? ''
        const input = state.input
        return [
          {
            type: 'tool_use',
            content: title || JSON.stringify(input, null, 2),
            metadata: { toolName: tool, toolId: callID },
          },
        ]
      }

      if (state.status === 'completed') {
        return [
          {
            type: 'tool_result',
            content: typeof state.output === 'string' ? state.output : JSON.stringify(state.output),
            metadata: { toolName: tool, toolId: callID },
          },
        ]
      }

      if (state.status === 'error') {
        return [
          {
            type: 'error',
            content: `${tool}: ${state.error}`,
          },
        ]
      }

      return []
    }

    return []
  }

  stop() {
    log.info('OpenCode stop requested')
    this.isRunning = false
    this.streamAbort?.abort()
    this.streamAbort = undefined

    // Abort the running session on the server
    if (this.client && this.sessionId) {
      this.client.session.abort({ path: { id: this.sessionId } }).catch((err: unknown) => {
        log.warn(`Failed to abort OpenCode session: ${(err as Error).message}`)
      })
    }
  }

  dispose() {
    this.isRunning = false
    this.streamAbort?.abort()
    this.streamAbort = undefined
    this.sessionId = undefined
    this.lastTextLength.clear()
    this.lastToolStatus.clear()
    this.client = undefined

    // Shut down the managed server
    if (this.serverClose) {
      this.serverClose()
      this.serverClose = undefined
      log.info('OpenCode server shut down')
    }
  }
}
