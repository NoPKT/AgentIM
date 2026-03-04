import { homedir, tmpdir, platform } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdtempSync,
  rmdirSync,
  existsSync,
} from 'node:fs'
import { nanoid } from 'nanoid'
import { createAdapter, type BaseAgentAdapter } from './adapters/index.js'
import { GatewayWsClient } from './ws-client.js'
import { createLogger } from './lib/logger.js'
import type {
  AgentStatus,
  AgentType,
  PermissionLevel,
  ServerSendToAgent,
  ServerStopAgent,
  ServerRemoveAgent,
  ServerRoomContext,
  ServerPermissionResponse,
  ServerAgentCommand,
  ServerQueryAgentInfo,
  ServerSpawnAgent,
  ServerRequestWorkspace,
  ServerListCredentials,
  ServerAddCredential,
  ServerManageCredential,
  ServerStartOAuth,
  ServerCompleteOAuth,
  ServerRewindAgent,
  RoomContext,
  ParsedChunk,
} from '@agentim/shared'
import {
  resolveCredential,
  listCredentialInfo,
  addCredential,
  removeCredential,
  updateCredential,
  setDefaultCredential,
  credentialToAuthConfig,
  agentConfigToEnv,
} from './agent-config.js'
import { getWorkspaceStatus } from './lib/git-utils.js'
import { getDirectoryListing, getFileContent } from './lib/fs-utils.js'
import type { McpContext, RoomMemberInfo, RoomMessage } from './mcp/mcp-context.js'
import { IpcServer } from './mcp/ipc-server.js'

const log = createLogger('AgentManager')

/** Expand leading `~` or `~user` to actual home directory and resolve to absolute. */
function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return resolve(homedir(), p.slice(2))
  }
  return resolve(p)
}

interface PendingPermission {
  resolve: (decision: { behavior: 'allow' | 'deny' }) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  reminderTimer: ReturnType<typeof setTimeout> | null
}

/** Pending reply for request_reply MCP tool */
interface PendingReply {
  resolve: (result: { reply: string; agentName: string } | { timeout: true }) => void
  timer: ReturnType<typeof setTimeout>
  targetAgentName: string
}

/** Maximum pending replies per agent */
const MAX_PENDING_REPLIES = 10
/** Maximum reply timeout in seconds */
const MAX_REPLY_TIMEOUT_SECONDS = 300

/** Max age for unused room contexts before they are cleaned up. */
const ROOM_CONTEXT_TTL_MS = 60 * 60 * 1000 // 1 hour
const ROOM_CONTEXT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Hard ceiling for the per-agent message queue. This is a safety backstop,
 * NOT the primary throttle — sender-side cooldowns on the server are the
 * main mechanism for preventing bombardment.
 */
const MAX_AGENT_QUEUE_SIZE = 50

export class AgentManager {
  private adapters = new Map<string, BaseAgentAdapter>()
  /** Session IDs reported by adapters for conversation continuity across restarts. */
  private sessionIds = new Map<string, string>()
  private agentCapabilities = new Map<string, string[]>()
  private roomContexts = new Map<string, RoomContext>()
  /** Tracks when each room context was last accessed (set/get). */
  private roomContextLastUsed = new Map<string, number>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private agentCurrentRoom = new Map<string, string>()
  /** Per-agent FIFO queue for messages that arrive while the adapter is busy. */
  private messageQueues = new Map<string, ServerSendToAgent[]>()
  private wsClient: GatewayWsClient
  private permissionLevel: PermissionLevel
  private contextCleanupTimer: ReturnType<typeof setInterval> | null = null

  /** MCP: pending request_reply promises keyed by conversationId */
  private pendingReplies = new Map<string, PendingReply>()
  /** MCP: per-agent McpContext instances */
  private mcpContexts = new Map<string, McpContext>()
  /** MCP: IPC server for stdio-based MCP servers */
  private ipcServer: IpcServer | null = null
  private ipcPort = 0
  private ipcStartPromise: Promise<number> | null = null

  /** Active remote OAuth login processes keyed by requestId */
  private activeOAuthProcesses = new Map<
    string,
    {
      process: ChildProcess
      agentType: string
      credentialName: string
      timer: ReturnType<typeof setTimeout>
    }
  >()

  private onEmpty?: () => void

  constructor(
    wsClient: GatewayWsClient,
    permissionLevel: PermissionLevel = 'interactive',
    onEmpty?: () => void,
  ) {
    this.wsClient = wsClient
    this.permissionLevel = permissionLevel
    this.onEmpty = onEmpty
    // Periodically clean up stale room contexts to prevent unbounded growth
    this.contextCleanupTimer = setInterval(
      () => this.cleanupStaleContexts(),
      ROOM_CONTEXT_CLEANUP_INTERVAL_MS,
    )
    this.contextCleanupTimer.unref()
  }

  private cleanupStaleContexts() {
    const now = Date.now()
    const keysToDelete: string[] = []
    for (const [key, lastUsed] of this.roomContextLastUsed) {
      if (now - lastUsed > ROOM_CONTEXT_TTL_MS) {
        keysToDelete.push(key)
      }
    }
    for (const key of keysToDelete) {
      this.roomContexts.delete(key)
      this.roomContextLastUsed.delete(key)
    }
    if (keysToDelete.length > 0) {
      log.info(`Cleaned up ${keysToDelete.length} stale room context(s)`)
    }
  }

  /** Create an McpContext for an agent, bridging MCP tools to the gateway. */
  private createMcpContext(agentId: string, agentName: string): McpContext {
    const ctx: McpContext = {
      agentId,
      agentName,

      sendMessage: async (targetAgent: string, content: string) => {
        const roomId = this.agentCurrentRoom.get(agentId)
        if (!roomId) throw new Error('Agent is not in a room')

        const messageId = nanoid()
        // Send as a complete message through the gateway
        this.wsClient.send({
          type: 'gateway:message_chunk',
          roomId,
          agentId,
          messageId,
          chunk: { type: 'text', content },
          targetAgentName: targetAgent,
        })
        this.wsClient.send({
          type: 'gateway:message_complete',
          roomId,
          agentId,
          messageId,
          fullContent: content,
          chunks: [{ type: 'text', content }],
          targetAgentName: targetAgent,
        })
        return { success: true, messageId }
      },

      requestReply: async (targetAgent: string, content: string, timeoutSeconds?: number) => {
        const roomId = this.agentCurrentRoom.get(agentId)
        if (!roomId) throw new Error('Agent is not in a room')

        // Limit pending replies per agent
        const agentPendingCount = [...this.pendingReplies.values()].filter(
          (p) => p.targetAgentName === targetAgent,
        ).length
        if (agentPendingCount >= MAX_PENDING_REPLIES) {
          throw new Error(`Too many pending replies to ${targetAgent}`)
        }

        const timeout = Math.min(timeoutSeconds ?? 120, MAX_REPLY_TIMEOUT_SECONDS)
        const conversationId = nanoid()
        const messageId = nanoid()

        // Send the message with the conversationId so the server knows to route the reply back
        this.wsClient.send({
          type: 'gateway:message_chunk',
          roomId,
          agentId,
          messageId,
          chunk: { type: 'text', content },
          targetAgentName: targetAgent,
        })
        this.wsClient.send({
          type: 'gateway:message_complete',
          roomId,
          agentId,
          messageId,
          fullContent: content,
          chunks: [{ type: 'text', content }],
          conversationId,
          targetAgentName: targetAgent,
        })

        // Wait for reply
        return new Promise<{ reply: string; agentName: string } | { timeout: true }>((resolve) => {
          const timer = setTimeout(() => {
            this.pendingReplies.delete(conversationId)
            resolve({ timeout: true })
          }, timeout * 1000)
          timer.unref()

          this.pendingReplies.set(conversationId, {
            resolve,
            timer,
            targetAgentName: targetAgent,
          })
        })
      },

      getRoomMessages: async (limit?: number): Promise<RoomMessage[]> => {
        const roomId = this.agentCurrentRoom.get(agentId)
        if (!roomId) return []

        const roomCtx = this.getRoomContext(agentId, roomId)
        if (!roomCtx?.recentMessages) return []

        const maxLimit = Math.min(limit ?? 20, 50)
        return roomCtx.recentMessages.slice(-maxLimit).map((m) => ({
          sender: m.senderName || 'unknown',
          senderType: m.senderType as 'user' | 'agent',
          content: m.content,
          timestamp: m.createdAt,
        }))
      },

      listRoomMembers: async (): Promise<RoomMemberInfo[]> => {
        const roomId = this.agentCurrentRoom.get(agentId)
        if (!roomId) return []

        const roomCtx = this.getRoomContext(agentId, roomId)
        if (!roomCtx?.members) return []

        return roomCtx.members.map((m) => ({
          name: m.name,
          type: m.type as 'user' | 'agent',
          agentType: m.agentType,
          status: m.status,
        }))
      },
    }

    this.mcpContexts.set(agentId, ctx)
    return ctx
  }

  /** Get or create the IPC server for stdio-based MCP processes. */
  async getIpcPort(): Promise<number> {
    if (this.ipcPort > 0) return this.ipcPort
    if (this.ipcStartPromise) return this.ipcStartPromise
    this.ipcStartPromise = (async () => {
      this.ipcServer = new IpcServer(this.mcpContexts)
      this.ipcPort = await this.ipcServer.start()
      return this.ipcPort
    })()
    return this.ipcStartPromise
  }

  /** Resolve a pending request_reply if a matching conversationId arrives. */
  resolvePendingReply(conversationId: string, reply: string, agentName: string): boolean {
    const pending = this.pendingReplies.get(conversationId)
    if (!pending) return false
    clearTimeout(pending.timer)
    this.pendingReplies.delete(conversationId)
    pending.resolve({ reply, agentName })
    return true
  }

  addAgent(opts: {
    type: string
    name: string
    workingDirectory?: string
    command?: string
    args?: string[]
    promptVia?: 'arg' | 'stdin'
    capabilities?: string[]
    env?: Record<string, string>
    passEnv?: string[]
  }): string {
    const agentId = nanoid()
    const workingDirectory = opts.workingDirectory ? expandPath(opts.workingDirectory) : undefined
    let adapter: BaseAgentAdapter
    try {
      adapter = createAdapter(opts.type, {
        agentId,
        agentName: opts.name,
        workingDirectory,
        command: opts.command,
        args: opts.args,
        promptVia: opts.promptVia,
        env: opts.env,
        passEnv: opts.passEnv,
        permissionLevel: this.permissionLevel,
        onPermissionRequest:
          this.permissionLevel === 'interactive'
            ? async ({ requestId, toolName, toolInput, timeoutMs }) => {
                const roomId = this.agentCurrentRoom.get(agentId)
                if (!roomId) {
                  return { behavior: 'deny' as const }
                }
                return new Promise<{ behavior: 'allow' | 'deny' }>((resolve, reject) => {
                  let settled = false
                  const safeResolve = (decision: { behavior: 'allow' | 'deny' }) => {
                    if (settled) return
                    settled = true
                    resolve(decision)
                  }
                  // Send a reminder at 75% of timeout so users know action is needed
                  const reminderDelay = Math.min(timeoutMs * 0.75, timeoutMs - 10_000)
                  const reminderTimer =
                    reminderDelay > 5000
                      ? setTimeout(() => {
                          if (!settled && roomId) {
                            this.wsClient.send({
                              type: 'gateway:message_chunk',
                              roomId,
                              agentId,
                              messageId: requestId,
                              chunk: {
                                type: 'text',
                                content: `[Permission request pending — awaiting response for ${toolName}]`,
                              },
                            })
                          }
                        }, reminderDelay)
                      : null
                  const timer = setTimeout(() => {
                    if (reminderTimer) clearTimeout(reminderTimer)
                    this.pendingPermissions.delete(requestId)
                    log.warn(
                      `Permission request ${requestId} timed out after ${timeoutMs}ms (tool=${toolName}), auto-denying`,
                    )
                    if (roomId) {
                      this.wsClient.send({
                        type: 'gateway:message_chunk',
                        roomId,
                        agentId,
                        messageId: requestId,
                        chunk: {
                          type: 'text',
                          content:
                            '[Permission request timed out — automatically denied]' +
                            ` (tool=${toolName})`,
                        },
                      })
                    }
                    safeResolve({ behavior: 'deny' })
                  }, timeoutMs)
                  this.pendingPermissions.set(requestId, {
                    resolve: safeResolve,
                    reject,
                    timer,
                    reminderTimer,
                  })
                  this.wsClient.send({
                    type: 'gateway:permission_request',
                    requestId,
                    agentId,
                    roomId,
                    toolName,
                    toolInput,
                    timeoutMs,
                  })
                })
              }
            : undefined,
      })
    } catch (err) {
      log.error(`Failed to create adapter for type "${opts.type}": ${(err as Error).message}`)
      throw err
    }

    this.adapters.set(agentId, adapter)

    // Auto-add rewind capability if adapter supports it
    const capabilities = [...(opts.capabilities ?? [])]
    if (adapter.supportsRewind && !capabilities.includes('rewind')) {
      capabilities.push('rewind')
    }

    if (capabilities.length) {
      this.agentCapabilities.set(agentId, capabilities)
    }

    // Create MCP context for agent-to-agent communication
    const mcpCtx = this.createMcpContext(agentId, opts.name)
    adapter.setMcpContext(mcpCtx)

    // Start IPC server for stdio-based MCP (Codex) and set env
    this.getIpcPort()
      .then((port) => {
        process.env.AGENTIM_IPC_PORT = String(port)
      })
      .catch((err) => {
        log.warn(`Failed to start IPC server: ${(err as Error).message}`)
      })

    // Register with server, including slash commands, MCP servers, and model
    this.wsClient.send({
      type: 'gateway:register_agent',
      agent: {
        id: agentId,
        name: opts.name,
        type: opts.type as AgentType,
        workingDirectory: opts.workingDirectory,
        capabilities,
        slashCommands: adapter.getSlashCommands(),
        mcpServers: adapter.getMcpServers(),
        model: adapter.getModel(),
      },
    })

    log.info(`Registered agent: ${opts.name} (${opts.type}) -> ${agentId}`)
    return agentId
  }

  /** Get room context and update last-used timestamp for TTL tracking. */
  private getRoomContext(agentId: string, roomId: string): RoomContext | undefined {
    const key = `${agentId}:${roomId}`
    const ctx = this.roomContexts.get(key)
    if (ctx) {
      this.roomContextLastUsed.set(key, Date.now())
    }
    return ctx
  }

  /** Refresh room context TTL when actively processing data for a room. */
  private touchRoomContext(agentId: string, roomId: string) {
    const key = `${agentId}:${roomId}`
    if (this.roomContexts.has(key)) {
      this.roomContextLastUsed.set(key, Date.now())
    }
  }

  removeAgent(agentId: string) {
    const adapter = this.adapters.get(agentId)
    if (adapter) {
      adapter.dispose()
      this.adapters.delete(agentId)
      this.agentCapabilities.delete(agentId)
      this.sessionIds.delete(agentId)
      this.messageQueues.delete(agentId)
      // Clean up room contexts for this agent (collect keys first to avoid mutating during iteration)
      const keysToDelete = [...this.roomContexts.keys()].filter((k) => k.startsWith(`${agentId}:`))
      for (const key of keysToDelete) {
        this.roomContexts.delete(key)
        this.roomContextLastUsed.delete(key)
      }
      this.wsClient.send({
        type: 'gateway:unregister_agent',
        agentId,
      })
    }
  }

  /**
   * Re-register all existing agents with the server (after reconnect).
   * Does NOT create new IDs — preserves room membership bindings.
   */
  reRegisterAll() {
    for (const [agentId, adapter] of this.adapters) {
      this.wsClient.send({
        type: 'gateway:register_agent',
        agent: {
          id: agentId,
          name: adapter.agentName,
          type: adapter.type as AgentType,
          workingDirectory: adapter.workingDirectory,
          capabilities: this.agentCapabilities.get(agentId),
          slashCommands: adapter.getSlashCommands(),
          mcpServers: adapter.getMcpServers(),
          model: adapter.getModel(),
        },
      })
    }
    if (this.adapters.size > 0) {
      log.info(`Re-registered ${this.adapters.size} existing agent(s)`)
    }
  }

  handleServerMessage(
    msg:
      | ServerSendToAgent
      | ServerStopAgent
      | ServerRemoveAgent
      | ServerRoomContext
      | ServerPermissionResponse
      | ServerAgentCommand
      | ServerQueryAgentInfo
      | ServerSpawnAgent
      | ServerRequestWorkspace
      | ServerListCredentials
      | ServerAddCredential
      | ServerManageCredential
      | ServerStartOAuth
      | ServerCompleteOAuth
      | ServerRewindAgent,
  ) {
    if (msg.type === 'server:send_to_agent') {
      this.handleSendToAgent(msg)
    } else if (msg.type === 'server:stop_agent') {
      this.handleStopAgent(msg.agentId)
    } else if (msg.type === 'server:remove_agent') {
      this.handleRemoveAgent(msg.agentId)
    } else if (msg.type === 'server:room_context') {
      this.handleRoomContext(msg)
    } else if (msg.type === 'server:permission_response') {
      this.handlePermissionResponse(msg)
    } else if (msg.type === 'server:agent_command') {
      this.handleAgentCommand(msg)
    } else if (msg.type === 'server:query_agent_info') {
      this.handleQueryAgentInfo(msg)
    } else if (msg.type === 'server:spawn_agent') {
      this.handleSpawnAgent(msg)
    } else if (msg.type === 'server:request_workspace') {
      this.handleRequestWorkspace(msg)
    } else if (msg.type === 'server:list_credentials') {
      this.handleListCredentials(msg)
    } else if (msg.type === 'server:add_credential') {
      this.handleAddCredential(msg)
    } else if (msg.type === 'server:manage_credential') {
      this.handleManageCredential(msg)
    } else if (msg.type === 'server:start_oauth') {
      this.handleStartOAuth(msg)
    } else if (msg.type === 'server:complete_oauth') {
      this.handleCompleteOAuth(msg)
    } else if (msg.type === 'server:rewind_agent') {
      this.handleRewindAgent(msg)
    }
  }

  private handlePermissionResponse(msg: ServerPermissionResponse) {
    const pending = this.pendingPermissions.get(msg.requestId)
    if (!pending) {
      log.warn(`No pending permission for requestId=${msg.requestId}`)
      return
    }
    clearTimeout(pending.timer)
    if (pending.reminderTimer) clearTimeout(pending.reminderTimer)
    this.pendingPermissions.delete(msg.requestId)
    const behavior = msg.decision === 'allow' ? 'allow' : 'deny'
    pending.resolve({ behavior })
    log.info(`Permission ${msg.decision} for requestId=${msg.requestId}`)
  }

  private handleRoomContext(msg: ServerRoomContext) {
    const key = `${msg.agentId}:${msg.context.roomId}`
    this.roomContexts.set(key, msg.context)
    this.roomContextLastUsed.set(key, Date.now())
    log.info(`Room context updated for agent ${msg.agentId} in room ${msg.context.roomName}`)
  }

  private handleSendToAgent(msg: ServerSendToAgent) {
    // Check if this message resolves a pending request_reply
    if (
      msg.conversationId &&
      this.resolvePendingReply(msg.conversationId, msg.content, msg.senderName)
    ) {
      log.info(
        `Resolved pending reply for conversation ${msg.conversationId} from ${msg.senderName}`,
      )
      return
    }

    const adapter = this.adapters.get(msg.agentId)
    if (!adapter) {
      log.warn(`Agent not found: ${msg.agentId}`)
      return
    }

    // If the adapter is currently processing, queue the message for later
    if (adapter.running) {
      const queue = this.messageQueues.get(msg.agentId) ?? []
      if (queue.length >= MAX_AGENT_QUEUE_SIZE) {
        log.warn(
          `Message queue full for agent ${msg.agentId} (${MAX_AGENT_QUEUE_SIZE}), rejecting ${msg.messageId}`,
        )
        this.wsClient.send({
          type: 'gateway:message_complete',
          roomId: msg.roomId,
          agentId: msg.agentId,
          messageId: msg.messageId,
          fullContent: 'Error: Agent message queue is full. Please try again later.',
          chunks: [
            { type: 'error', content: 'Agent message queue is full. Please try again later.' },
          ],
          conversationId: msg.conversationId,
          depth: msg.depth,
        })
        return
      }
      queue.push(msg)
      this.messageQueues.set(msg.agentId, queue)
      log.info(
        `Queued message ${msg.messageId} for busy agent ${adapter.agentName} (queue: ${queue.length})`,
      )
      // Report updated queue depth to server so it can throttle senders
      this.sendAgentStatus(msg.agentId, 'busy', queue.length)
      return
    }

    this.processMessage(adapter, msg)
  }

  /**
   * Process the next queued message for the given agent, or set agent status
   * back to online if the queue is empty.
   */
  private processNextQueued(agentId: string) {
    const queue = this.messageQueues.get(agentId)
    if (queue && queue.length > 0) {
      const next = queue.shift()!
      if (queue.length === 0) this.messageQueues.delete(agentId)
      const adapter = this.adapters.get(agentId)
      if (adapter) {
        log.info(
          `Processing queued message ${next.messageId} for agent ${adapter.agentName} (remaining: ${queue?.length ?? 0})`,
        )
        this.processMessage(adapter, next)
        return
      }
    }
    // Queue is empty or adapter gone — set status to online
    this.sendAgentStatus(agentId, 'online', 0)
  }

  /**
   * Dispatch a single message to the adapter. When the adapter completes
   * (success or error), the next queued message is automatically processed.
   */
  private processMessage(adapter: BaseAgentAdapter, msg: ServerSendToAgent) {
    // Track which room this agent is responding to
    this.agentCurrentRoom.set(msg.agentId, msg.roomId)
    this.touchRoomContext(msg.agentId, msg.roomId)

    // Generate a unique response ID for this agent's reply.
    // In broadcast mode, multiple agents receive the same msg.messageId (the user's
    // original message ID). If they all reuse it as their response ID, the DB's
    // onConflictDoUpdate causes the last completer to overwrite all others (including
    // the user's own message).  A fresh nanoid per response avoids the collision.
    const messageId = nanoid()
    const allChunks: ParsedChunk[] = []
    let completed = false

    // Update status to busy with current queue depth
    const queueDepth = this.messageQueues.get(msg.agentId)?.length ?? 0
    this.sendAgentStatus(msg.agentId, 'busy', queueDepth)

    try {
      adapter.sendMessage(
        msg.content,
        (chunk) => {
          allChunks.push(chunk)
          this.touchRoomContext(msg.agentId, msg.roomId)
          this.wsClient.send({
            type: 'gateway:message_chunk',
            roomId: msg.roomId,
            agentId: msg.agentId,
            messageId,
            chunk,
          })
        },
        (fullContent) => {
          if (completed) return
          completed = true

          // Collect workspace status asynchronously before completing
          const workingDir = adapter.workingDirectory
          const sendComplete = () => {
            this.wsClient.send({
              type: 'gateway:message_complete',
              roomId: msg.roomId,
              agentId: msg.agentId,
              messageId,
              fullContent,
              chunks: allChunks,
              conversationId: msg.conversationId,
              depth: msg.depth,
            })
            // Process next queued message or go online
            this.processNextQueued(msg.agentId)
          }

          if (workingDir) {
            const WORKSPACE_STATUS_TIMEOUT = 15_000
            let timeoutTimer: ReturnType<typeof setTimeout> | undefined
            Promise.race([
              getWorkspaceStatus(workingDir).finally(() => {
                if (timeoutTimer) clearTimeout(timeoutTimer)
              }),
              new Promise<null>((_, reject) => {
                timeoutTimer = setTimeout(
                  () => reject(new Error('Workspace status timed out')),
                  WORKSPACE_STATUS_TIMEOUT,
                )
                timeoutTimer.unref()
              }),
            ])
              .then((status) => {
                if (status) {
                  const wsChunk: ParsedChunk = {
                    type: 'workspace_status',
                    content: JSON.stringify(status),
                    metadata: { workingDirectory: workingDir },
                  }
                  allChunks.push(wsChunk)
                  this.wsClient.send({
                    type: 'gateway:message_chunk',
                    roomId: msg.roomId,
                    agentId: msg.agentId,
                    messageId,
                    chunk: wsChunk,
                  })
                }
                sendComplete()
              })
              .catch((err) => {
                log.warn(`Workspace status collection failed: ${(err as Error).message}`)
                // Notify the client that workspace status was unavailable
                this.wsClient.send({
                  type: 'gateway:message_chunk',
                  roomId: msg.roomId,
                  agentId: msg.agentId,
                  messageId,
                  chunk: {
                    type: 'text',
                    content: `[Workspace status unavailable: ${(err as Error).message}]`,
                  },
                })
                sendComplete()
              })
          } else {
            sendComplete()
          }
        },
        (error) => {
          if (completed) return
          completed = true
          allChunks.push({ type: 'error', content: error })

          const workingDir = adapter.workingDirectory
          const sendErrorComplete = () => {
            this.wsClient.send({
              type: 'gateway:message_complete',
              roomId: msg.roomId,
              agentId: msg.agentId,
              messageId,
              fullContent: `Error: ${error}`,
              chunks: allChunks,
              conversationId: msg.conversationId,
              depth: msg.depth,
            })
            // Process next queued message or set error status
            this.processNextQueued(msg.agentId)
          }

          // Collect workspace status even on error — the agent may have
          // made file changes before failing, and stale data causes UI bugs.
          if (workingDir) {
            getWorkspaceStatus(workingDir)
              .then((status) => {
                if (status) {
                  const wsChunk: ParsedChunk = {
                    type: 'workspace_status',
                    content: JSON.stringify(status),
                    metadata: { workingDirectory: workingDir },
                  }
                  allChunks.push(wsChunk)
                  this.wsClient.send({
                    type: 'gateway:message_chunk',
                    roomId: msg.roomId,
                    agentId: msg.agentId,
                    messageId,
                    chunk: wsChunk,
                  })
                }
                sendErrorComplete()
              })
              .catch(() => {
                sendErrorComplete()
              })
          } else {
            sendErrorComplete()
          }
        },
        {
          roomId: msg.roomId,
          senderName: msg.senderName,
          routingMode: msg.routingMode,
          conversationId: msg.conversationId,
          depth: msg.depth,
          roomContext: this.getRoomContext(msg.agentId, msg.roomId),
        },
      )
    } catch (err) {
      // Recover from synchronous throw in sendMessage to avoid agent stuck in 'busy'
      log.error(`Agent ${msg.agentId} sendMessage threw: ${(err as Error).message}`)
      this.processNextQueued(msg.agentId)
    }
  }

  /** Send agent status update to the server, including current queue depth. */
  private sendAgentStatus(agentId: string, status: AgentStatus, queueDepth: number) {
    this.wsClient.send({
      type: 'gateway:agent_status',
      agentId,
      status,
      queueDepth,
    })
  }

  private handleSpawnAgent(msg: ServerSpawnAgent) {
    try {
      // Resolve credential from local store
      const credential = resolveCredential(msg.agentType, msg.credentialId)
      if (!credential) {
        const credInfos = listCredentialInfo(msg.agentType)
        if (credInfos.length === 0) {
          // No credentials configured
          this.wsClient.send({
            type: 'gateway:spawn_result',
            requestId: msg.requestId,
            success: false,
            error: `No credentials configured for ${msg.agentType}. Run \`aim ${msg.agentType === 'claude-code' ? 'claude' : msg.agentType} login\` on the gateway machine.`,
          })
          return
        }
        // Multiple credentials, no default, no selection — tell server to ask user
        this.wsClient.send({
          type: 'gateway:spawn_result',
          requestId: msg.requestId,
          success: false,
          error: 'CREDENTIAL_SELECTION_REQUIRED',
          credentials: credInfos.map((c) => ({
            id: c.id,
            name: c.name,
            mode: c.mode,
            isDefault: c.isDefault,
          })),
        })
        return
      }

      const config = credentialToAuthConfig(credential)
      const env = agentConfigToEnv(msg.agentType, config)
      const agentId = this.addAgent({
        type: msg.agentType,
        name: msg.name,
        workingDirectory: msg.workingDirectory,
        env,
      })
      this.wsClient.send({
        type: 'gateway:spawn_result',
        requestId: msg.requestId,
        success: true,
        agentId,
      })
      log.info(`Spawned agent "${msg.name}" (${msg.agentType}) -> ${agentId}`)
    } catch (err) {
      this.wsClient.send({
        type: 'gateway:spawn_result',
        requestId: msg.requestId,
        success: false,
        error: (err as Error).message,
      })
      log.error(`Failed to spawn agent "${msg.name}": ${(err as Error).message}`)
    }
  }

  private handleRemoveAgent(agentId: string) {
    const adapter = this.adapters.get(agentId)
    if (adapter) {
      adapter.dispose()
      this.adapters.delete(agentId)
      this.agentCapabilities.delete(agentId)
      this.sessionIds.delete(agentId)
      this.messageQueues.delete(agentId)
      const keysToRemove = [...this.roomContexts.keys()].filter((k) => k.startsWith(`${agentId}:`))
      for (const key of keysToRemove) {
        this.roomContexts.delete(key)
        this.roomContextLastUsed.delete(key)
      }
      log.info(`Agent ${agentId} removed by server`)

      if (this.adapters.size === 0 && this.onEmpty) {
        this.onEmpty()
      }
    }
  }

  private handleStopAgent(agentId: string) {
    const adapter = this.adapters.get(agentId)
    if (adapter) {
      // Clear queued messages — the user explicitly wants to stop this agent
      this.messageQueues.delete(agentId)
      adapter.stop()
    }
  }

  /** Record a session ID for an agent (called by adapters after establishing a session). */
  setSessionId(agentId: string, sessionId: string) {
    this.sessionIds.set(agentId, sessionId)
  }

  /** Get stored session ID for an agent. */
  getSessionId(agentId: string): string | undefined {
    return this.sessionIds.get(agentId)
  }

  /** Export session data for persistence across restarts. */
  exportSessionData(): Record<string, string> {
    return Object.fromEntries(this.sessionIds)
  }

  /** Import previously saved session data. */
  importSessionData(data: Record<string, string>) {
    for (const [agentId, sessionId] of Object.entries(data)) {
      this.sessionIds.set(agentId, sessionId)
    }
  }

  listAgents() {
    return [...this.adapters.entries()].map(([id, adapter]) => ({
      id,
      name: adapter.agentName,
      type: adapter.type,
      running: adapter.running,
    }))
  }

  /** Expose adapters map for status reporting (e.g. StatusWriter). */
  getAdapters(): ReadonlyMap<string, BaseAgentAdapter> {
    return this.adapters
  }

  private async handleAgentCommand(msg: ServerAgentCommand) {
    const adapter = this.adapters.get(msg.agentId)
    if (!adapter) {
      log.warn(`Agent not found for command: ${msg.agentId}`)
      this.wsClient.send({
        type: 'gateway:agent_command_result',
        agentId: msg.agentId,
        roomId: msg.roomId,
        command: msg.command,
        success: false,
        message: 'Agent not found',
      })
      return
    }

    try {
      const result = await adapter.handleSlashCommand(msg.command, msg.args)
      this.wsClient.send({
        type: 'gateway:agent_command_result',
        agentId: msg.agentId,
        roomId: msg.roomId,
        command: msg.command,
        success: result.success,
        message: result.message,
      })
    } catch (err) {
      log.error(`Slash command error for agent ${msg.agentId}: ${(err as Error).message}`)
      this.wsClient.send({
        type: 'gateway:agent_command_result',
        agentId: msg.agentId,
        roomId: msg.roomId,
        command: msg.command,
        success: false,
        message: `Command error: ${(err as Error).message}`,
      })
    }
  }

  private async handleQueryAgentInfo(msg: ServerQueryAgentInfo) {
    const adapter = this.adapters.get(msg.agentId)
    if (!adapter) {
      log.warn(`Agent not found for info query: ${msg.agentId}`)
      return
    }

    // Wait for model list to be ready (async adapters like Codex fetch from API)
    await adapter.waitForModels(3000)

    const costSummary = adapter.getCostSummary()
    const availableModels = adapter.getAvailableModels()
    const availableModelInfo = adapter.getAvailableModelInfo()
    const availableEffortLevels = adapter.getAvailableEffortLevels()
    const availableThinkingModes = adapter.getAvailableThinkingModes()
    this.wsClient.send({
      type: 'gateway:agent_info',
      agentId: msg.agentId,
      slashCommands: adapter.getSlashCommands(),
      mcpServers: adapter.getMcpServers(),
      model: adapter.getModel(),
      thinkingMode: adapter.getThinkingMode(),
      effortLevel: adapter.getEffortLevel(),
      sessionCostUSD: costSummary.costUSD > 0 ? costSummary.costUSD : undefined,
      availableModels: availableModels.length > 0 ? availableModels : undefined,
      availableModelInfo: availableModelInfo.length > 0 ? availableModelInfo : undefined,
      availableEffortLevels: availableEffortLevels.length > 0 ? availableEffortLevels : undefined,
      availableThinkingModes:
        availableThinkingModes.length > 0 ? availableThinkingModes : undefined,
      planMode: adapter.getPlanMode() || undefined,
    })
  }

  private async handleRequestWorkspace(msg: ServerRequestWorkspace) {
    const adapter = this.adapters.get(msg.agentId)
    if (!adapter) {
      log.warn(`Agent not found for workspace request: ${msg.agentId}`)
      this.wsClient.send({
        type: 'gateway:workspace_response',
        agentId: msg.agentId,
        requestId: msg.requestId,
        response: { kind: 'error', message: 'Agent not found' },
      })
      return
    }

    const workingDir = adapter.workingDirectory
    if (!workingDir) {
      this.wsClient.send({
        type: 'gateway:workspace_response',
        agentId: msg.agentId,
        requestId: msg.requestId,
        response: { kind: 'error', message: 'Agent has no working directory' },
      })
      return
    }

    const WORKSPACE_REQUEST_TIMEOUT = 15_000
    try {
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        this.executeWorkspaceRequest(workingDir, msg.request),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(
            () => reject(new Error('Workspace request timed out')),
            WORKSPACE_REQUEST_TIMEOUT,
          )
          timeoutTimer.unref()
        }),
      ]).finally(() => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
      })

      this.wsClient.send({
        type: 'gateway:workspace_response',
        agentId: msg.agentId,
        requestId: msg.requestId,
        response: result,
      })
    } catch (err) {
      log.warn(`Workspace request failed for agent ${msg.agentId}: ${(err as Error).message}`)
      this.wsClient.send({
        type: 'gateway:workspace_response',
        agentId: msg.agentId,
        requestId: msg.requestId,
        response: { kind: 'error', message: (err as Error).message },
      })
    }
  }

  private async executeWorkspaceRequest(
    workingDir: string,
    request: ServerRequestWorkspace['request'],
  ) {
    switch (request.kind) {
      case 'status': {
        const status = await getWorkspaceStatus(workingDir)
        if (!status) {
          return {
            kind: 'status' as const,
            data: {
              branch: 'unknown',
              changedFiles: [],
              summary: { filesChanged: 0, additions: 0, deletions: 0 },
            },
          }
        }
        return { kind: 'status' as const, data: status }
      }
      case 'tree': {
        const entries = await getDirectoryListing(workingDir, request.path)
        return { kind: 'tree' as const, path: request.path ?? '.', entries }
      }
      case 'file': {
        const result = await getFileContent(workingDir, request.path)
        return { kind: 'file' as const, path: request.path, ...result }
      }
    }
  }

  private handleListCredentials(msg: ServerListCredentials) {
    try {
      const credentials = listCredentialInfo(msg.agentType)
      this.wsClient.send({
        type: 'gateway:credential_list',
        requestId: msg.requestId,
        agentType: msg.agentType,
        credentials,
      })
    } catch (err) {
      log.error(`Failed to list credentials for ${msg.agentType}: ${(err as Error).message}`)
    }
  }

  private handleAddCredential(msg: ServerAddCredential) {
    try {
      const entry = addCredential(msg.agentType, {
        name: msg.name,
        mode: msg.mode,
        ...(msg.apiKey ? { apiKey: msg.apiKey } : {}),
        baseUrl: msg.baseUrl,
        model: msg.model,
      })
      this.wsClient.send({
        type: 'gateway:credential_result',
        requestId: msg.requestId,
        success: true,
        credential: { id: entry.id, name: entry.name },
      })
      log.info(`Added credential "${msg.name}" for ${msg.agentType}`)
    } catch (err) {
      this.wsClient.send({
        type: 'gateway:credential_result',
        requestId: msg.requestId,
        success: false,
        error: (err as Error).message,
      })
    }
  }

  private handleManageCredential(msg: ServerManageCredential) {
    try {
      let success = false
      if (msg.action === 'rename' && msg.name) {
        success = updateCredential(msg.agentType, msg.credentialId, { name: msg.name })
      } else if (msg.action === 'delete') {
        success = removeCredential(msg.agentType, msg.credentialId)
      } else if (msg.action === 'set_default') {
        success = setDefaultCredential(msg.agentType, msg.credentialId)
      }

      this.wsClient.send({
        type: 'gateway:credential_result',
        requestId: msg.requestId,
        success,
        error: success ? undefined : 'Credential not found',
      })
      if (success) {
        log.info(`${msg.action} credential ${msg.credentialId} for ${msg.agentType}`)
      }
    } catch (err) {
      this.wsClient.send({
        type: 'gateway:credential_result',
        requestId: msg.requestId,
        success: false,
        error: (err as Error).message,
      })
    }
  }

  // ─── Remote OAuth ───

  private static readonly OAUTH_LOGIN_COMMANDS: Record<
    string,
    {
      cmd: string
      args: string[]
      /** Whether the CLI needs a PTY (e.g. Ink-based TUIs like Claude Code) */
      needsPty?: boolean
      /** Regex pattern in stdout that indicates CLI is already authenticated.
       *  When matched, the process is killed and the credential is auto-created. */
      successPattern?: string
    }
  > = {
    'claude-code': { cmd: 'claude', args: ['setup-token'], needsPty: true },
    codex: { cmd: 'codex', args: ['login'] },
    // Gemini CLI has no dedicated auth command. Headless mode triggers OAuth
    // if not yet authenticated; "Loaded cached credentials" means already authed.
    gemini: {
      cmd: 'gemini',
      args: ['-p', 'respond with OK'],
      successPattern: 'Loaded cached credentials',
    },
  }

  private static readonly OAUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  private handleStartOAuth(msg: ServerStartOAuth) {
    const loginInfo = AgentManager.OAUTH_LOGIN_COMMANDS[msg.agentType]
    if (!loginInfo) {
      this.wsClient.send({
        type: 'gateway:oauth_result',
        requestId: msg.requestId,
        success: false,
        error: `No login command configured for agent type: ${msg.agentType}`,
      })
      return
    }

    // Prevent duplicate OAuth processes for the same request
    if (this.activeOAuthProcesses.has(msg.requestId)) return

    log.info(`Starting remote OAuth for ${msg.agentType} (request=${msg.requestId})`)

    // Create a secure temp directory (mkdtemp uses mode 0700) to avoid
    // symlink attacks flagged by CodeQL for direct file creation in tmpdir.
    const oauthTmpDir = mkdtempSync(join(tmpdir(), 'agentim-oauth-'))
    const urlFile = join(oauthTmpDir, 'url')

    // Create a BROWSER helper script that captures the URL to a file.
    // Used by CLIs that respect the BROWSER environment variable.
    const browserHelper = join(oauthTmpDir, 'browser.sh')

    // Create an 'open' command wrapper that intercepts URL arguments.
    // Many CLIs (e.g. Claude Code) call the system `open` command directly
    // instead of using the BROWSER env var. By prepending our wrapper dir
    // to PATH, we intercept these calls and capture the URL.
    const openWrapper = join(oauthTmpDir, 'open')

    // On Linux, also create xdg-open wrapper
    const xdgOpenWrapper = join(oauthTmpDir, 'xdg-open')

    try {
      writeFileSync(browserHelper, `#!/bin/sh\nprintf '%s' "$1" > "${urlFile}"\n`, { mode: 0o755 })
      // The open wrapper captures URL arguments and exits; non-URL args
      // are forwarded to the real /usr/bin/open.
      writeFileSync(
        openWrapper,
        [
          '#!/bin/sh',
          'for arg in "$@"; do',
          '  case "$arg" in',
          '    http://*|https://*)',
          `      printf '%s' "$arg" > "${urlFile}"`,
          '      exit 0',
          '      ;;',
          '  esac',
          'done',
          '/usr/bin/open "$@"',
        ].join('\n') + '\n',
        { mode: 0o755 },
      )
      if (platform() === 'linux') {
        writeFileSync(xdgOpenWrapper, `#!/bin/sh\nprintf '%s' "$1" > "${urlFile}"\n`, {
          mode: 0o755,
        })
      }
    } catch (err) {
      log.error(`Failed to create OAuth helper scripts: ${(err as Error).message}`)
      this.wsClient.send({
        type: 'gateway:oauth_result',
        requestId: msg.requestId,
        success: false,
        error: `Failed to create OAuth helper scripts: ${(err as Error).message}`,
      })
      return
    }

    const env: Record<string, string> = {
      ...process.env,
      BROWSER: browserHelper,
      // Prepend wrapper dir to PATH so our 'open' wrapper intercepts URL launches
      PATH: oauthTmpDir + ':' + (process.env.PATH || ''),
    } as Record<string, string>
    // Prevent "cannot be launched inside another Claude Code session" error
    delete env.CLAUDECODE

    // Some CLIs (e.g. Claude Code's setup-token) use Ink TUI that requires
    // TTY raw mode. Use python3 pty for those; others run directly.
    let spawnCmd: string
    let spawnArgs: string[]
    if (loginInfo.needsPty) {
      spawnCmd = 'python3'
      spawnArgs = ['-c', 'import pty,sys;pty.spawn(sys.argv[1:])', loginInfo.cmd, ...loginInfo.args]
    } else {
      spawnCmd = loginInfo.cmd
      spawnArgs = [...loginInfo.args]
    }

    log.info(`OAuth spawning: ${spawnCmd} ${spawnArgs.join(' ')} (PATH prefix: ${oauthTmpDir})`)

    const child = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    log.info(`OAuth child PID: ${child.pid ?? 'undefined'}`)

    let urlSent = false

    const sendUrlIfFound = (url: string) => {
      if (urlSent) return
      urlSent = true
      log.info(`Captured OAuth URL for ${msg.agentType}`)
      this.wsClient.send({
        type: 'gateway:oauth_url',
        requestId: msg.requestId,
        authUrl: url,
      })
    }

    // Poll the URL file written by the browser/open helper script
    let pollCount = 0
    const urlPoll = setInterval(() => {
      if (urlSent) {
        clearInterval(urlPoll)
        return
      }
      pollCount++
      try {
        if (existsSync(urlFile)) {
          const url = readFileSync(urlFile, 'utf-8').trim()
          if (url) {
            log.info(`OAuth URL found in file (poll #${pollCount}): ${url.slice(0, 80)}...`)
            sendUrlIfFound(url)
          }
        } else if (pollCount <= 3 || pollCount % 20 === 0) {
          // Log occasionally to show polling is active
          log.info(`OAuth URL file not yet created (poll #${pollCount})`)
        }
      } catch {
        // File not yet created — keep polling
      }
    }, 300)

    const cleanupFiles = () => {
      clearInterval(urlPoll)
      for (const f of [browserHelper, openWrapper, xdgOpenWrapper, urlFile]) {
        try {
          unlinkSync(f)
        } catch {
          /* ignore */
        }
      }
      try {
        rmdirSync(oauthTmpDir)
      } catch {
        /* ignore */
      }
    }

    const timer = setTimeout(() => {
      const entry = this.activeOAuthProcesses.get(msg.requestId)
      if (entry) {
        log.warn(
          `OAuth process timed out (request=${msg.requestId}) urlSent=${urlSent} chunks=${stdoutChunks} urlFileExists=${existsSync(urlFile)}`,
        )
        entry.process.kill()
        this.activeOAuthProcesses.delete(msg.requestId)
        cleanupFiles()
        this.wsClient.send({
          type: 'gateway:oauth_result',
          requestId: msg.requestId,
          success: false,
          error: 'OAuth process timed out',
        })
      }
    }, AgentManager.OAUTH_TIMEOUT_MS)

    this.activeOAuthProcesses.set(msg.requestId, {
      process: child,
      agentType: msg.agentType,
      credentialName: msg.credentialName,
      timer,
    })

    // Strip ANSI escape sequences from PTY output so URL regex is not corrupted.
    // Control characters are intentional targets here.
    const ESC = String.fromCharCode(0x1b)
    const BEL = String.fromCharCode(0x07)
    const ansiCsi = new RegExp(ESC + '\\[[0-9;]*[a-zA-Z]', 'g')
    const ansiOsc = new RegExp(ESC + '\\][^' + BEL + ']*' + BEL, 'g')
    const stripAnsi = (s: string) => s.replace(ansiCsi, '').replace(ansiOsc, '')

    // Early success: if the CLI output matches a known "already authenticated"
    // pattern, kill the process and create the credential immediately.
    let earlySuccess = false
    const handleEarlySuccess = () => {
      if (earlySuccess || urlSent) return
      earlySuccess = true
      log.info(`OAuth early success: CLI already authenticated for ${msg.agentType}`)
      child.kill()
      clearTimeout(timer)
      clearInterval(urlPoll)
      this.activeOAuthProcesses.delete(msg.requestId)
      cleanupFiles()
      const credential = addCredential(msg.agentType, {
        name: msg.credentialName,
        mode: 'subscription',
      })
      this.wsClient.send({
        type: 'gateway:oauth_result',
        requestId: msg.requestId,
        success: true,
        credential: { id: credential.id, name: credential.name },
      })
    }

    // Also monitor stdout/stderr directly (works if the CLI prints the URL
    // to its own output, regardless of how BROWSER is handled)
    let stdoutChunks = 0
    const handleOutput = (source: string) => (data: Buffer) => {
      const raw = data.toString()
      stdoutChunks++
      // Log first few chunks for diagnostics
      if (stdoutChunks <= 5) {
        const preview = raw.length > 200 ? raw.slice(0, 200) + '...' : raw
        log.info(`OAuth ${source} chunk #${stdoutChunks}: ${JSON.stringify(preview)}`)
      }
      const clean = stripAnsi(raw)

      // Check for early success pattern (CLI already authenticated)
      if (loginInfo.successPattern && clean.includes(loginInfo.successPattern)) {
        handleEarlySuccess()
        return
      }

      if (!urlSent) {
        // Match URL, excluding control characters
        const urlRe = new RegExp(
          'https?://[^\\s"\'<>' + String.fromCharCode(0) + '-' + String.fromCharCode(0x1f) + ']+',
        )
        const urlMatch = clean.match(urlRe)
        if (urlMatch) {
          log.info(`OAuth URL found in ${source}: ${urlMatch[0].slice(0, 80)}...`)
          sendUrlIfFound(urlMatch[0])
        }
      }
    }

    child.stdout?.on('data', handleOutput('stdout'))
    child.stderr?.on('data', handleOutput('stderr'))

    child.on('error', (err) => {
      log.error(`OAuth process spawn error: ${err.message}`)
      clearTimeout(timer)
      cleanupFiles()
      this.activeOAuthProcesses.delete(msg.requestId)
      this.wsClient.send({
        type: 'gateway:oauth_result',
        requestId: msg.requestId,
        success: false,
        error: `Failed to start login command: ${err.message}`,
      })
    })

    // If the process exits before complete_oauth arrives, it may have succeeded
    // (e.g. claude setup-token exits immediately after user pastes token)
    child.on('exit', (code, signal) => {
      log.info(
        `OAuth process exited: code=${code} signal=${signal} urlSent=${urlSent} chunks=${stdoutChunks}`,
      )
      const entry = this.activeOAuthProcesses.get(msg.requestId)
      if (!entry) return // already handled by completeOAuth

      clearTimeout(timer)
      cleanupFiles()
      this.activeOAuthProcesses.delete(msg.requestId)

      if (code === 0 && urlSent) {
        // Process exited successfully — save credential
        const credential = addCredential(msg.agentType, {
          name: msg.credentialName,
          mode: 'subscription',
        })
        this.wsClient.send({
          type: 'gateway:oauth_result',
          requestId: msg.requestId,
          success: true,
          credential: { id: credential.id, name: credential.name },
        })
        log.info(`OAuth completed successfully for ${msg.agentType}`)
      } else if (code === 0 && !urlSent) {
        // Process exited successfully without printing a URL — still save
        const credential = addCredential(msg.agentType, {
          name: msg.credentialName,
          mode: 'subscription',
        })
        this.wsClient.send({
          type: 'gateway:oauth_result',
          requestId: msg.requestId,
          success: true,
          credential: { id: credential.id, name: credential.name },
        })
      } else {
        this.wsClient.send({
          type: 'gateway:oauth_result',
          requestId: msg.requestId,
          success: false,
          error: `Login process exited with code ${code}`,
        })
      }
    })
  }

  private async handleCompleteOAuth(msg: ServerCompleteOAuth) {
    const entry = this.activeOAuthProcesses.get(msg.requestId)
    if (!entry) {
      this.wsClient.send({
        type: 'gateway:oauth_result',
        requestId: msg.requestId,
        success: false,
        error: 'No active OAuth process for this request',
      })
      return
    }

    log.info(`Relaying OAuth callback for ${entry.agentType} (request=${msg.requestId})`)

    try {
      // Make HTTP request to the CLI tool's local server with the callback URL
      // The callback URL looks like http://localhost:PORT/callback?code=xxx&state=yyy
      const response = await fetch(msg.callbackUrl)
      if (!response.ok) {
        log.warn(`OAuth callback returned ${response.status}`)
      }

      // Wait for the process to exit (up to 30s)
      await new Promise<void>((resolve, reject) => {
        const exitTimeout = setTimeout(() => {
          reject(new Error('Login process did not exit after receiving callback'))
        }, 30_000)

        entry.process.on('exit', (code) => {
          clearTimeout(exitTimeout)
          if (code === 0) resolve()
          else reject(new Error(`Login process exited with code ${code}`))
        })
      })

      // Process exited successfully — save credential
      clearTimeout(entry.timer)
      this.activeOAuthProcesses.delete(msg.requestId)

      const credential = addCredential(entry.agentType, {
        name: entry.credentialName,
        mode: 'subscription',
      })
      this.wsClient.send({
        type: 'gateway:oauth_result',
        requestId: msg.requestId,
        success: true,
        credential: { id: credential.id, name: credential.name },
      })
      log.info(`OAuth completed successfully for ${entry.agentType}`)
    } catch (err) {
      clearTimeout(entry.timer)
      this.activeOAuthProcesses.delete(msg.requestId)
      entry.process.kill()

      this.wsClient.send({
        type: 'gateway:oauth_result',
        requestId: msg.requestId,
        success: false,
        error: (err as Error).message,
      })
    }
  }

  private handleRewindAgent(msg: ServerRewindAgent) {
    const adapter = this.adapters.get(msg.agentId)
    if (!adapter) {
      log.warn(`Rewind: agent ${msg.agentId} not found`)
      this.wsClient.send({
        type: 'gateway:rewind_result',
        agentId: msg.agentId,
        roomId: msg.roomId,
        success: false,
        error: 'Agent not found',
      })
      return
    }
    // Stop current query if running
    if (adapter.running) {
      adapter.stop()
    }
    // Clear message queue for this agent
    this.messageQueues.delete(msg.agentId)
    // Call adapter rewind
    adapter
      .rewind(msg.messageId)
      .then((result) => {
        this.wsClient.send({
          type: 'gateway:rewind_result',
          agentId: msg.agentId,
          roomId: msg.roomId,
          success: result.success,
          error: result.error,
        })
      })
      .catch((err) => {
        this.wsClient.send({
          type: 'gateway:rewind_result',
          agentId: msg.agentId,
          roomId: msg.roomId,
          success: false,
          error: (err as Error).message,
        })
      })
  }

  async disposeAll() {
    const DISPOSE_TIMEOUT_MS = 10_000
    const disposePromises: Promise<void>[] = []
    for (const [id, adapter] of this.adapters) {
      disposePromises.push(
        Promise.resolve(adapter.dispose()).catch((err) =>
          log.error(`Failed to dispose agent ${id}: ${(err as Error).message}`),
        ),
      )
      this.wsClient.send({
        type: 'gateway:unregister_agent',
        agentId: id,
      })
    }
    // Race disposal against a timeout to prevent hanging on slow agents
    await Promise.race([
      Promise.allSettled(disposePromises),
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          log.warn(`Agent disposal timed out after ${DISPOSE_TIMEOUT_MS}ms, forcing cleanup`)
          resolve()
        }, DISPOSE_TIMEOUT_MS)
        timer.unref()
      }),
    ])
    this.adapters.clear()
    this.agentCapabilities.clear()
    this.sessionIds.clear()
    this.messageQueues.clear()
    this.roomContexts.clear()
    this.roomContextLastUsed.clear()
    this.agentCurrentRoom.clear()
    if (this.contextCleanupTimer) {
      clearInterval(this.contextCleanupTimer)
      this.contextCleanupTimer = null
    }
    // Reject all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      clearTimeout(pending.timer)
      if (pending.reminderTimer) clearTimeout(pending.reminderTimer)
      pending.resolve({ behavior: 'deny' })
    }
    this.pendingPermissions.clear()
    // Resolve all pending MCP replies with timeout
    for (const [id, pending] of this.pendingReplies) {
      clearTimeout(pending.timer)
      pending.resolve({ timeout: true })
      this.pendingReplies.delete(id)
    }
    // Shut down IPC server (await pending start to prevent leak)
    if (this.ipcStartPromise) {
      await this.ipcStartPromise.catch(() => {})
      this.ipcStartPromise = null
    }
    if (this.ipcServer) {
      this.ipcServer.stop()
      this.ipcServer = null
      this.ipcPort = 0
    }
    this.mcpContexts.clear()
    // Kill active OAuth processes
    for (const [id, entry] of this.activeOAuthProcesses) {
      clearTimeout(entry.timer)
      entry.process.kill()
      this.activeOAuthProcesses.delete(id)
    }
  }
}
