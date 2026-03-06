import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ModelOption } from '@agentim/shared'
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

const log = createLogger('Codex')

const CODEX_AGENTIM_CONTEXT_PREAMBLE = [
  '[AgentIM Room Communication]',
  'You are connected to an AgentIM room with other agents and users.',
  'If you have MCP tools available (send_message, request_reply, get_room_messages,',
  'list_room_members), use them to communicate with other agents directly.',
  'If not, mention other agents by name using @AgentName format in your messages.',
  'The room system will route your message to the mentioned agent.',
].join('\n')

// ─── JSON-RPC Transport Types ───

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

interface JsonRpcServerRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  label: string
}

// ─── Codex App-Server Item Types ───

type ApprovalPolicy = 'on-request' | 'untrusted' | 'never'
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type WebSearchMode = 'disabled' | 'cached' | 'live'

interface ThreadStartResult {
  thread: { id: string; cwd: string }
  model: string
  modelProvider: string
  cwd: string
}

interface TurnStartResult {
  turn: { id: string; status: string }
}

/** Per-room state for Codex adapter. */
interface CodexRoomState {
  threadId?: string
  modelOverride?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  sandboxMode?: SandboxMode
  webSearchMode?: WebSearchMode
  networkAccess?: boolean
  planMode: boolean
  turnId?: string
}

const DEFAULT_ROOM_KEY = '__global__'

/** Per-room app-server process state for parallel room processing. */
interface CodexRoomProcess {
  child: ChildProcessWithoutNullStreams
  readline: ReadlineInterface
  initialized: boolean
  nextRequestId: number
  pendingRequests: Map<number, PendingRequest>
  // Stream callbacks for the current turn
  onChunk?: ChunkCallback
  onComplete?: CompleteCallback
  onError?: ErrorCallback
  fullContent: string
  // Session-level auto-approve rules
  sessionApprovedTools: Set<string>
}

export class CodexAdapter extends BaseAgentAdapter {
  /** Per-room app-server processes for parallel room processing. */
  private roomProcesses = new Map<string, CodexRoomProcess>()

  // Per-room state (settings, threadId, etc.)
  private roomStates = new Map<string, CodexRoomState>()

  // Model info loaded from Codex CLI cache (~/.codex/models_cache.json)
  private cachedModelInfo: ModelOption[] = []
  private fetchModelsPromise: Promise<void> | null = null

  constructor(opts: AdapterOptions) {
    super(opts)
    // Load persisted thread IDs from previous gateway runs
    this.loadPersistedThreads()
    // Fetch model list from OpenAI API (async, non-blocking)
    this.fetchModelsPromise = this.fetchModels().catch(() => {})
  }

  override get supportsParallelRooms() {
    return true
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

  // ─── Thread Persistence ───

  /** Path to the file storing thread-to-room mappings. */
  private getThreadStorePath(): string | undefined {
    if (!this.workingDirectory) return undefined
    return join(this.workingDirectory, '.codex', '.agentim-threads.json')
  }

  /** Load previously persisted thread IDs into room states. */
  private loadPersistedThreads(): void {
    const path = this.getThreadStorePath()
    if (!path || !existsSync(path)) return
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
      let count = 0
      for (const [roomId, threadId] of Object.entries(data)) {
        if (typeof threadId === 'string' && threadId) {
          const rs = this.getRoomState(roomId)
          if (!rs.threadId) {
            rs.threadId = threadId
            count++
          }
        }
      }
      if (count > 0) {
        log.info(`Loaded ${count} persisted thread(s) from ${path}`)
      }
    } catch {
      // File corrupt or unreadable — start fresh
    }
  }

  /** Persist a thread ID for a room so it survives gateway restarts. */
  private persistThread(roomId: string, threadId: string): void {
    const path = this.getThreadStorePath()
    if (!path) return
    try {
      let data: Record<string, string> = {}
      try {
        data = JSON.parse(readFileSync(path, 'utf-8'))
      } catch {
        // File doesn't exist yet
      }
      data[roomId] = threadId
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(data, null, 2))
    } catch (err) {
      log.warn(`Failed to persist thread: ${(err as Error).message}`)
    }
  }

  /** Remove a persisted thread for a room. */
  private removePersistedThread(roomId: string): void {
    const path = this.getThreadStorePath()
    if (!path || !existsSync(path)) return
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
      delete data[roomId]
      writeFileSync(path, JSON.stringify(data, null, 2))
    } catch {
      // Non-critical
    }
  }

  // ─── App-Server Process Management (Per-Room) ───

  private findCodexBinary(): string {
    // Try to find the codex binary in common locations
    try {
      // Look in node_modules first (most reliable in a pnpm/npm project)
      const pkgDir = require.resolve('@openai/codex/package.json')
      const binPath = join(pkgDir, '..', 'bin', 'codex.js')
      if (existsSync(binPath)) return binPath
    } catch {
      // Not installed as dependency — try PATH
    }

    // Try system-wide codex
    for (const candidate of ['/usr/local/bin/codex', '/usr/bin/codex']) {
      if (existsSync(candidate)) return candidate
    }

    // Fallback: assume it's on PATH
    return 'codex'
  }

  /** Build the child process environment. */
  private buildChildEnv(): Record<string, string> {
    const childEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) childEnv[key] = value
    }
    Object.assign(childEnv, this.env)
    return childEnv
  }

  /** Ensure an app-server process exists for the given room. */
  private async ensureRoomProcess(roomId: string): Promise<CodexRoomProcess> {
    const existing = this.roomProcesses.get(roomId)
    if (existing?.initialized) return existing
    if (existing) return existing // Still initializing

    const codexBin = this.findCodexBinary()
    const isJsFile = codexBin.endsWith('.js')
    const childEnv = this.buildChildEnv()

    const args = isJsFile ? [codexBin, 'app-server'] : ['app-server']
    const command = isJsFile ? process.execPath : codexBin

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    })

    const readline = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    })

    const proc: CodexRoomProcess = {
      child,
      readline,
      initialized: false,
      nextRequestId: 1,
      pendingRequests: new Map(),
      fullContent: '',
      sessionApprovedTools: new Set(),
    }
    this.roomProcesses.set(roomId, proc)

    // Route incoming messages for this room's process
    readline.on('line', (line) => this.handleLine(roomId, line))

    child.stderr.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg && !msg.includes('rmcp')) {
        log.warn(`[${roomId} stderr] ${msg.substring(0, 500)}`)
      }
    })

    child.on('exit', (code) => {
      log.info(`Codex app-server for room ${roomId} exited with code ${code}`)
      // Reject all pending requests
      for (const [id, pending] of proc.pendingRequests) {
        pending.reject(new Error(`Codex app-server exited (code=${code})`))
        proc.pendingRequests.delete(id)
      }
      this.roomProcesses.delete(roomId)
      this.setRoomBusy(roomId, false)
    })

    // Initialize
    await this.sendRequest(roomId, 'initialize', {
      clientInfo: { name: 'agentim', version: '0.1.0' },
    })
    proc.initialized = true
    log.info(`Codex app-server initialized for room ${roomId}`)
    return proc
  }

  // ─── JSON-RPC Transport (Per-Room) ───

  private sendToProcess(roomId: string, obj: unknown): void {
    const proc = this.roomProcesses.get(roomId)
    if (!proc?.child?.stdin?.writable) {
      log.warn(`Cannot send to room ${roomId} — app-server stdin not writable`)
      return
    }
    proc.child.stdin.write(JSON.stringify(obj) + '\n')
  }

  private sendRequest(roomId: string, method: string, params: unknown): Promise<unknown> {
    const proc = this.roomProcesses.get(roomId)
    if (!proc) return Promise.reject(new Error(`No process for room ${roomId}`))
    const id = proc.nextRequestId++
    return new Promise((resolve, reject) => {
      proc.pendingRequests.set(id, { resolve, reject, label: method })
      this.sendToProcess(roomId, { jsonrpc: '2.0', id, method, params })
    })
  }

  private sendResponse(roomId: string, id: number, result: unknown): void {
    this.sendToProcess(roomId, { jsonrpc: '2.0', id, result })
  }

  private handleLine(roomId: string, line: string): void {
    if (!line.trim()) return
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    const proc = this.roomProcesses.get(roomId)
    if (!proc) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any

    // Response to our request
    if (m.id !== undefined && m.id !== null && proc.pendingRequests.has(m.id as number)) {
      const pending = proc.pendingRequests.get(m.id as number)!
      proc.pendingRequests.delete(m.id as number)
      if (m.error) {
        pending.reject(new Error(m.error.message))
      } else {
        pending.resolve(m.result)
      }
      return
    }

    // Server request (has both id and method) — needs response
    if (m.method && m.id !== undefined && m.id !== null) {
      this.handleServerRequest(roomId, msg as JsonRpcServerRequest)
      return
    }

    // Notification (has method, no id)
    if (m.method) {
      this.handleNotification(roomId, msg as JsonRpcNotification)
      return
    }
  }

  // ─── Server Request Handling (Approvals) ───

  private async handleServerRequest(roomId: string, req: JsonRpcServerRequest): Promise<void> {
    const params = req.params ?? {}

    if (req.method === 'item/commandExecution/requestApproval') {
      await this.handleCommandApproval(roomId, req.id, params)
      return
    }

    if (req.method === 'item/fileChange/requestApproval') {
      await this.handleFileChangeApproval(roomId, req.id, params)
      return
    }

    if (req.method === 'item/tool/requestUserInput') {
      // Tool requesting user input — deny by default in headless mode
      this.sendResponse(roomId, req.id, { answers: [] })
      return
    }

    // Unknown server request — send empty result
    log.warn(`Unknown server request: ${req.method}`)
    this.sendResponse(roomId, req.id, {})
  }

  private async handleCommandApproval(
    roomId: string,
    requestId: number,
    params: Record<string, unknown>,
  ): Promise<void> {
    const proc = this.roomProcesses.get(roomId)
    const command = (params.command as string) ?? ''
    const toolName = 'command'

    // Check session-level auto-approve
    if (proc?.sessionApprovedTools.has(toolName)) {
      this.sendResponse(roomId, requestId, { decision: 'accept' })
      return
    }

    if (!this.onPermissionRequest) {
      // No permission handler — auto-approve
      this.sendResponse(roomId, requestId, { decision: 'accept' })
      return
    }

    try {
      const { nanoid } = await import('nanoid')
      const permRequestId = nanoid()
      const result = await this.onPermissionRequest({
        requestId: permRequestId,
        toolName: 'Bash',
        toolInput: {
          command,
          cwd: params.cwd as string,
          commandActions: params.commandActions,
        },
        timeoutMs: PERMISSION_TIMEOUT_MS,
      })

      if (result.behavior === 'allow') {
        this.sendResponse(roomId, requestId, { decision: 'accept' })
      } else if (result.behavior === 'allowAlways') {
        proc?.sessionApprovedTools.add(toolName)
        this.sendResponse(roomId, requestId, { decision: 'acceptForSession' })
      } else {
        this.sendResponse(roomId, requestId, { decision: 'cancel' })
      }
    } catch (err) {
      log.error(`Permission request failed: ${(err as Error).message}`)
      this.sendResponse(roomId, requestId, { decision: 'cancel' })
    }
  }

  private async handleFileChangeApproval(
    roomId: string,
    requestId: number,
    params: Record<string, unknown>,
  ): Promise<void> {
    const proc = this.roomProcesses.get(roomId)
    const toolName = 'fileChange'

    if (proc?.sessionApprovedTools.has(toolName)) {
      this.sendResponse(roomId, requestId, { decision: 'accept' })
      return
    }

    if (!this.onPermissionRequest) {
      this.sendResponse(roomId, requestId, { decision: 'accept' })
      return
    }

    try {
      const { nanoid } = await import('nanoid')
      const permRequestId = nanoid()
      const result = await this.onPermissionRequest({
        requestId: permRequestId,
        toolName: 'Write',
        toolInput: {
          path: params.path,
          changes: params.changes,
        },
        timeoutMs: PERMISSION_TIMEOUT_MS,
      })

      if (result.behavior === 'allow') {
        this.sendResponse(roomId, requestId, { decision: 'accept' })
      } else if (result.behavior === 'allowAlways') {
        proc?.sessionApprovedTools.add(toolName)
        this.sendResponse(roomId, requestId, { decision: 'acceptForSession' })
      } else {
        this.sendResponse(roomId, requestId, { decision: 'cancel' })
      }
    } catch (err) {
      log.error(`Permission request failed: ${(err as Error).message}`)
      this.sendResponse(roomId, requestId, { decision: 'cancel' })
    }
  }

  // ─── Notification Handling (Streaming Events) ───

  private handleNotification(roomId: string, notif: JsonRpcNotification): void {
    const proc = this.roomProcesses.get(roomId)
    if (!proc) return
    const params = (notif.params ?? {}) as Record<string, unknown>

    switch (notif.method) {
      case 'item/agentMessage/delta':
        if (proc.onChunk) {
          const delta = params.delta as string
          if (delta) {
            log.info(
              `[delta] keys=${Object.keys(params).join(',')} ` +
                `itemId=${params.itemId ?? params.id ?? 'N/A'} "${delta.substring(0, 80)}"`,
            )
            proc.fullContent += delta
            proc.onChunk({ type: 'text', content: delta })
          }
        }
        break

      case 'item/started': {
        const item = params.item as Record<string, unknown>
        if (!item) break
        this.handleItemStarted(proc, item)
        break
      }

      case 'item/completed': {
        const item = params.item as Record<string, unknown>
        if (!item) break
        this.handleItemCompleted(proc, item)
        break
      }

      case 'turn/completed':
        // Turn finished — signal completion
        if (proc.onComplete) {
          const complete = proc.onComplete
          const content = proc.fullContent
          this.clearRoomCallbacks(roomId)
          complete(content)
        }
        break

      case 'codex/event/token_count': {
        const msg = params.msg as Record<string, unknown> | undefined
        const info = msg?.info as Record<string, unknown> | undefined
        const total = info?.total_token_usage as Record<string, number> | undefined
        if (total) {
          this.accumulatedInputTokens = total.input_tokens ?? 0
          this.accumulatedOutputTokens = total.output_tokens ?? 0
          this.accumulatedCacheReadTokens = total.cached_input_tokens ?? 0
        }
        break
      }

      case 'codex/event/task_complete':
        // Task complete — if turn/completed hasn't fired yet, complete now
        if (proc.onComplete) {
          const complete = proc.onComplete
          const content = proc.fullContent
          this.clearRoomCallbacks(roomId)
          complete(content)
        }
        break

      case 'thread/status/changed':
        // Could track waitingOnApproval status here
        break

      default:
        // Ignore other notifications silently
        break
    }
  }

  private handleItemStarted(proc: CodexRoomProcess, item: Record<string, unknown>): void {
    if (!proc.onChunk) return
    const type = item.type as string

    if (type === 'commandExecution') {
      const command = item.command as string
      proc.onChunk({
        type: 'tool_use',
        content: `$ ${command}`,
        metadata: { toolName: 'command', toolId: item.id as string },
      })
    } else if (type === 'reasoning') {
      // Reasoning started — will get content in completed
    }
  }

  private handleItemCompleted(proc: CodexRoomProcess, item: Record<string, unknown>): void {
    if (!proc.onChunk) return
    const type = item.type as string

    if (type === 'commandExecution') {
      const output = item.aggregatedOutput as string
      if (output) {
        proc.onChunk({
          type: 'tool_result',
          content: output,
          metadata: { toolId: item.id as string },
        })
      }
    } else if (type === 'fileChange') {
      const changes = item.changes as Array<{ kind: string; path: string }> | undefined
      if (changes?.length) {
        proc.onChunk({
          type: 'tool_result',
          content: changes.map((c) => `${c.kind}: ${c.path}`).join('\n'),
          metadata: { toolId: item.id as string },
        })
      }
    } else if (type === 'agentMessage') {
      // Final agent message — text already streamed via delta notifications
      // but if we missed the deltas, emit the full text
      const text = item.text as string
      const phase = item.phase as string
      if (text && !proc.fullContent.includes(text.substring(0, 50))) {
        proc.fullContent += text
        proc.onChunk({ type: 'text', content: text })
      }
      // Log phase for debugging
      if (phase) log.debug(`Agent message phase: ${phase}`)
    } else if (type === 'mcpToolCall') {
      const server = item.server as string
      const tool = item.tool as string
      const args = item.arguments as unknown
      proc.onChunk({
        type: 'tool_use',
        content: JSON.stringify({ server, tool, arguments: args }, null, 2),
        metadata: { toolName: `${server}:${tool}`, toolId: item.id as string },
      })
    } else if (type === 'webSearch') {
      const query = item.query as string
      proc.onChunk({
        type: 'tool_use',
        content: `Web search: ${query}`,
        metadata: { toolName: 'web_search', toolId: item.id as string },
      })
    } else if (type === 'error') {
      const message = item.message as string
      proc.onChunk({ type: 'error', content: message ?? 'Unknown error' })
    }
  }

  private clearRoomCallbacks(roomId: string): void {
    const proc = this.roomProcesses.get(roomId)
    if (proc) {
      proc.onChunk = undefined
      proc.onComplete = undefined
      proc.onError = undefined
      proc.fullContent = ''
    }
    this.setRoomBusy(roomId, false)
  }

  // ─── Thread Management ───

  private async ensureThread(roomId: string): Promise<string> {
    await this.ensureRoomProcess(roomId)
    const rs = this.getRoomState(roomId)

    if (rs.threadId) return rs.threadId

    // Determine approval policy based on permission level
    let approvalPolicy: ApprovalPolicy = 'on-request'
    if (this.permissionLevel === 'bypass') {
      approvalPolicy = 'never'
    } else if (this.onPermissionRequest) {
      approvalPolicy = 'on-request'
    }

    const threadOpts: Record<string, unknown> = {
      cwd: this.workingDirectory,
      approvalPolicy,
    }

    if (rs.modelOverride || this.env.CODEX_MODEL) {
      threadOpts.model = rs.modelOverride || this.env.CODEX_MODEL
    }
    if (rs.reasoningEffort) {
      threadOpts.reasoningEffort = rs.reasoningEffort
    }
    if (rs.sandboxMode) {
      threadOpts.sandbox = rs.sandboxMode
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

    const result = (await this.sendRequest(roomId, 'thread/start', threadOpts)) as ThreadStartResult
    rs.threadId = result.thread.id
    this.persistThread(roomId, rs.threadId)
    log.info(
      `Codex thread started: ${rs.threadId} for room ${roomId} (approvalPolicy=${approvalPolicy})`,
    )
    return rs.threadId
  }

  // ─── Public API ───

  protected override buildPrompt(content: string, context?: MessageContext): string {
    const base = super.buildPrompt(content, context)
    const parts: string[] = []
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
    const roomId = context?.roomId ?? DEFAULT_ROOM_KEY

    if (this.isRoomBusy(roomId)) {
      onError('Agent is already processing a message for this room')
      return
    }

    this.setRoomBusy(roomId, true)

    try {
      const threadId = await this.ensureThread(roomId)
      const proc = this.roomProcesses.get(roomId)!
      proc.onChunk = onChunk
      proc.onComplete = onComplete
      proc.onError = onError
      proc.fullContent = ''

      const prompt = this.buildPrompt(content, context)

      const result = (await this.sendRequest(roomId, 'turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
      })) as TurnStartResult

      const rs = this.getRoomState(roomId)
      rs.turnId = result.turn.id
      log.info(`Turn started: ${rs.turnId} for room ${roomId}`)

      // Turn events are now handled by the notification handler.
      // The turn/start response just confirms the turn was created.
      // Completion is signaled by turn/completed notification.
    } catch (err: unknown) {
      const content = this.roomProcesses.get(roomId)?.fullContent
      this.clearRoomCallbacks(roomId)
      if ((err as Error).name === 'AbortError') {
        onComplete(content || 'Interrupted')
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`Codex app-server error: ${msg}`)
        onError(msg)
      }
    }
  }

  // ─── Model Management ───

  /** Whether the current credentials are OAuth (subscription) rather than an API key. */
  private get isOAuthMode(): boolean {
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
      try {
        writeFileSync(CodexAdapter.MODEL_CACHE_PATH, JSON.stringify({ models }, null, 2))
      } catch {
        // Non-critical
      }
      log.info(`Fetched ${models.length} Codex models from /v1/chat/models`)
      return CodexAdapter.chatModelsToOptions(models)
    } catch (err) {
      log.warn(`/v1/chat/models fetch error: ${(err as Error).message}`)
      return []
    }
  }

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

  private tryRefreshCacheViaCli(): ModelOption[] {
    try {
      const bin = existsSync('/usr/local/bin/codex')
        ? '/usr/local/bin/codex'
        : existsSync('/usr/bin/codex')
          ? '/usr/bin/codex'
          : 'codex'
      execFileSync(bin, ['--version'], { timeout: 5_000, stdio: 'ignore' })
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

  private async fetchModels(): Promise<void> {
    const token = this.env.CODEX_API_KEY || this.env.OPENAI_API_KEY

    if (this.isOAuthMode) {
      const cached = this.readModelCache()
      if (cached.length > 0) {
        this.cachedModelInfo = cached
        return
      }
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
      const apiModels = await this.fetchApiModels(token)
      if (apiModels.length > 0) {
        this.cachedModelInfo = apiModels
        return
      }
      const cached = this.readModelCache()
      if (cached.length > 0) {
        this.cachedModelInfo = cached
        return
      }
    } else {
      log.warn('No API key or OAuth credentials — skipping API model fetch')
    }

    const cliModels = this.tryRefreshCacheViaCli()
    if (cliModels.length > 0) {
      this.cachedModelInfo = cliModels
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
        rs.threadId = undefined
        rs.turnId = undefined
        this.removePersistedThread(roomId ?? DEFAULT_ROOM_KEY)
        // Kill the room's app-server process so next message starts fresh
        this.killRoomProcess(roomId ?? DEFAULT_ROOM_KEY)
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
        rs.threadId = undefined
        this.removePersistedThread(roomId ?? DEFAULT_ROOM_KEY)
        this.killRoomProcess(roomId ?? DEFAULT_ROOM_KEY)
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
        rs.threadId = undefined
        this.removePersistedThread(roomId ?? DEFAULT_ROOM_KEY)
        this.killRoomProcess(roomId ?? DEFAULT_ROOM_KEY)
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
        rs.threadId = undefined
        this.removePersistedThread(roomId ?? DEFAULT_ROOM_KEY)
        this.killRoomProcess(roomId ?? DEFAULT_ROOM_KEY)
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
        rs.threadId = undefined
        this.removePersistedThread(roomId ?? DEFAULT_ROOM_KEY)
        this.killRoomProcess(roomId ?? DEFAULT_ROOM_KEY)
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
        rs.threadId = undefined
        this.removePersistedThread(roomId ?? DEFAULT_ROOM_KEY)
        this.killRoomProcess(roomId ?? DEFAULT_ROOM_KEY)
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

  // ─── Lifecycle ───

  /** Kill and clean up a single room's app-server process. */
  private killRoomProcess(roomId: string): void {
    const proc = this.roomProcesses.get(roomId)
    if (!proc) return
    try {
      proc.child.kill()
    } catch {
      // Ignore
    }
    try {
      proc.readline.close()
    } catch {
      // Ignore
    }
    this.roomProcesses.delete(roomId)
  }

  stop() {
    log.info('Codex stop requested')

    // Interrupt all active turns and complete with current content
    for (const [roomId, proc] of this.roomProcesses) {
      const rs = this.getRoomState(roomId)
      if (rs.turnId && rs.threadId) {
        this.sendRequest(roomId, 'turn/interrupt', {
          threadId: rs.threadId,
        }).catch((err) => {
          log.warn(`turn/interrupt failed for room ${roomId}: ${(err as Error).message}`)
        })
      }

      if (proc.onComplete) {
        const complete = proc.onComplete
        const content = proc.fullContent
        this.clearRoomCallbacks(roomId)
        complete(content || 'Interrupted')
      }
    }
    this.clearAllBusy()
  }

  dispose() {
    // Kill all room processes
    for (const [roomId] of this.roomProcesses) {
      this.killRoomProcess(roomId)
    }
    this.roomProcesses.clear()
    this.clearAllBusy()
    this.roomStates.clear()
  }
}
