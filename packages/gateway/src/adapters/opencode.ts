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

  // Cached model info from provider.list()
  private cachedModelOptions: ModelOption[] = []
  private cachedModelValues: string[] = []
  private modelInfoFetched = false

  // MCP server registration state
  private mcpRegistered = false

  // Runtime settings configurable via slash commands
  private modelOverride?: { modelID: string; providerID?: string }

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

    // Register AgentIM MCP server for agent-to-agent communication
    await this.registerMcpServer(client)

    return this.client
  }

  /** Register the AgentIM MCP stdio server with OpenCode. */
  private async registerMcpServer(client: OpencodeClient) {
    if (this.mcpRegistered || !this.mcpContext) return
    this.mcpRegistered = true

    try {
      // Dynamically import the agent-manager to get IPC port
      // The MCP context is set by agent-manager which also manages the IPC server
      const { fileURLToPath } = await import('node:url')
      const { dirname, join } = await import('node:path')

      // Resolve the stdio-server.ts/js path relative to this module
      const thisDir = dirname(fileURLToPath(import.meta.url))
      const mcpDir = join(thisDir, '..', 'mcp')
      // In production (dist/), the file is compiled to .js
      const serverScript = join(mcpDir, 'stdio-server.js')

      // We need the IPC port from the agent-manager. It's stored in env by the manager.
      const ipcPort = process.env.AGENTIM_IPC_PORT
      if (!ipcPort) {
        log.warn('AGENTIM_IPC_PORT not set, skipping MCP registration for OpenCode')
        return
      }

      await client.mcp.add({
        body: {
          name: 'agentim',
          config: {
            type: 'local',
            command: [process.execPath, serverScript],
            environment: {
              AGENTIM_IPC_PORT: ipcPort,
              AGENTIM_AGENT_ID: this.agentId,
              AGENTIM_AGENT_NAME: this.agentName,
            },
            enabled: true,
            timeout: 30000,
          },
        },
      })
      log.info('Registered AgentIM MCP server with OpenCode')
    } catch (err) {
      log.warn(`Failed to register AgentIM MCP server with OpenCode: ${(err as Error).message}`)
    }
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

      // Fetch available models on first use (async, non-blocking)
      if (!this.modelInfoFetched) {
        this.modelInfoFetched = true
        client.provider
          .list()
          .then((res) => {
            const providers = res.data?.all
            if (!providers) return
            const options: ModelOption[] = []
            const values: string[] = []
            for (const provider of providers) {
              if (!provider.models) continue
              for (const [key, model] of Object.entries(provider.models)) {
                const value = `${provider.id}/${key}`
                values.push(value)
                options.push({
                  value,
                  displayName: `${model.name} (${provider.name})`,
                  description: model.id || key,
                })
              }
            }
            this.cachedModelOptions = options
            this.cachedModelValues = values
            log.info(`Cached ${options.length} models from ${providers.length} providers`)
          })
          .catch((err) => {
            log.warn(`Failed to fetch provider models: ${(err as Error).message}`)
          })
      }

      // Create or reuse session
      if (!this.sessionId) {
        const { data: session } = await client.session.create({})
        if (!session) throw new Error('Failed to create OpenCode session')
        this.sessionId = session.id
        log.info(`Created OpenCode session: ${this.sessionId}`)
      }

      const prompt = this.buildPrompt(content, context)
      const sessionId = this.sessionId

      // Determine model and provider from env or override
      const modelID = this.modelOverride?.modelID || this.env.OPENCODE_MODEL_ID
      const providerID = this.modelOverride?.providerID || this.env.OPENCODE_PROVIDER_ID

      // Start SSE event stream before sending the prompt.
      // If the initial subscribe fails (e.g. transient network error), retry up
      // to SSE_MAX_RETRIES times with exponential backoff before giving up.
      const SSE_MAX_RETRIES = 5
      const abortController = new AbortController()
      this.streamAbort = abortController

      let sseResult: Awaited<ReturnType<typeof client.event.subscribe>>
      for (let attempt = 0; ; attempt++) {
        try {
          sseResult = await client.event.subscribe({
            signal: abortController.signal,
          })
          break
        } catch (err: unknown) {
          if (attempt >= SSE_MAX_RETRIES || abortController.signal.aborted) throw err
          const delay = Math.min(500 * Math.pow(2, attempt), 10_000)
          log.warn(
            `SSE subscribe failed (attempt ${attempt + 1}/${SSE_MAX_RETRIES + 1}), retrying in ${delay}ms: ${(err as Error).message}`,
          )
          await new Promise((r) => setTimeout(r, delay))
        }
      }

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
        .then((res) => {
          // Extract cost and token data from the prompt response
          const info = res?.data?.info
          if (info && typeof info === 'object') {
            const msg = info as {
              cost?: number
              tokens?: {
                input?: number
                output?: number
                cache?: { read?: number }
              }
            }
            if (typeof msg.cost === 'number') {
              this.accumulatedCostUSD += msg.cost
            }
            if (msg.tokens) {
              this.accumulatedInputTokens += msg.tokens.input ?? 0
              this.accumulatedOutputTokens += msg.tokens.output ?? 0
              this.accumulatedCacheReadTokens += msg.tokens.cache?.read ?? 0
            }
          }
          return res
        })
        .catch((err: unknown) => {
          if (!completed) throw err
        })

      // Process SSE events for streaming; try/finally ensures abort on all exits
      try {
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
              const errMsg =
                props.error?.data?.message ||
                JSON.stringify(props.error) ||
                'Unknown OpenCode error'
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
              this.handlePermission(client, sessionId, perm).catch((err: unknown) => {
                log.error(`Permission handling failed: ${(err as Error).message}`)
                // Notify user in chat UI about the failure
                onChunk({
                  type: 'text',
                  content: `⚠️ Permission delivery failed: ${(err as Error).message}. The agent may be waiting for approval that was not received.`,
                })
              })
            }
          }
        }
      } finally {
        abortController.abort()
        this.streamAbort = undefined
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
        onComplete(fullContent)
      }
    } catch (err: unknown) {
      this.isRunning = false
      if (this.streamAbort) {
        this.streamAbort.abort()
        this.streamAbort = undefined
      }
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

    // Retry permission response delivery with backoff (network may be flaky)
    const MAX_RETRIES = 5
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await client.postSessionIdPermissionsPermissionId({
          path: { id: sessionId, permissionID: perm.id },
          body: { response },
        })
        return
      } catch (err: unknown) {
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(500 * Math.pow(2, attempt), 10_000)
          log.warn(
            `Permission response delivery failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms`,
          )
          await new Promise((r) => setTimeout(r, delay))
        } else {
          throw err
        }
      }
    }
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

  override getSlashCommands(): Array<{
    name: string
    description: string
    usage: string
    source: 'builtin' | 'skill'
  }> {
    return [
      { name: 'clear', description: 'Reset session', usage: '/clear', source: 'builtin' },
      {
        name: 'model',
        description: 'Switch model/provider',
        usage: '/model [provider/model]',
        source: 'builtin',
      },
      {
        name: 'cost',
        description: 'Show cost and token usage',
        usage: '/cost',
        source: 'builtin',
      },
    ]
  }

  override getAvailableModels(): string[] {
    return this.cachedModelValues
  }

  override getAvailableModelInfo(): ModelOption[] {
    return this.cachedModelOptions
  }

  override getModel(): string | undefined {
    if (this.modelOverride) {
      return this.modelOverride.providerID
        ? `${this.modelOverride.providerID}/${this.modelOverride.modelID}`
        : this.modelOverride.modelID
    }
    const modelID = this.env.OPENCODE_MODEL_ID
    const providerID = this.env.OPENCODE_PROVIDER_ID
    if (modelID) return providerID ? `${providerID}/${modelID}` : modelID
    return undefined
  }

  override async handleSlashCommand(
    command: string,
    args: string,
  ): Promise<{ success: boolean; message?: string }> {
    switch (command) {
      case 'clear': {
        this.sessionId = undefined
        return { success: true, message: 'Session cleared' }
      }
      case 'model': {
        const input = args.trim()
        if (!input) {
          const current = this.getModel() ?? '(default)'
          return {
            success: true,
            message: `Current model: ${current}\nUse /model <provider/model> or /model <model> to switch`,
          }
        }
        // Parse "provider/model" or just "model"
        const slashIdx = input.indexOf('/')
        if (slashIdx > 0) {
          this.modelOverride = {
            providerID: input.slice(0, slashIdx),
            modelID: input.slice(slashIdx + 1),
          }
        } else {
          this.modelOverride = { modelID: input }
        }
        return { success: true, message: `Model set to: ${input}` }
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
      default:
        return { success: false, message: `Unknown command: ${command}` }
    }
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
      try {
        this.serverClose()
        log.info('OpenCode server shut down')
      } catch (err) {
        log.warn(`Failed to shut down OpenCode server: ${(err as Error).message}`)
      }
      this.serverClose = undefined
    }
  }
}
