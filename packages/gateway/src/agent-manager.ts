import { nanoid } from 'nanoid'
import { createAdapter, type BaseAgentAdapter } from './adapters/index.js'
import { GatewayWsClient } from './ws-client.js'
import { createLogger } from './lib/logger.js'
import type {
  AgentType,
  GatewayMessage,
  PermissionLevel,
  PermissionDecision,
  ServerSendToAgent,
  ServerStopAgent,
  ServerRemoveAgent,
  ServerRoomContext,
  ServerPermissionResponse,
  ServerGatewayMessage,
  RoomContext,
  ParsedChunk,
} from '@agentim/shared'
import { PERMISSION_TIMEOUT_MS } from '@agentim/shared'
import { getWorkspaceStatus } from './lib/git-utils.js'

const log = createLogger('AgentManager')

interface PendingPermission {
  resolve: (decision: { behavior: 'allow' | 'deny' }) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class AgentManager {
  private adapters = new Map<string, BaseAgentAdapter>()
  private agentCapabilities = new Map<string, string[]>()
  private roomContexts = new Map<string, RoomContext>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private agentCurrentRoom = new Map<string, string>()
  private wsClient: GatewayWsClient
  private permissionLevel: PermissionLevel

  constructor(wsClient: GatewayWsClient, permissionLevel: PermissionLevel = 'interactive') {
    this.wsClient = wsClient
    this.permissionLevel = permissionLevel
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
    let adapter: BaseAgentAdapter
    try {
      adapter = createAdapter(opts.type, {
        agentId,
        agentName: opts.name,
        workingDirectory: opts.workingDirectory,
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
                  const timer = setTimeout(() => {
                    this.pendingPermissions.delete(requestId)
                    resolve({ behavior: 'deny' })
                  }, timeoutMs)
                  this.pendingPermissions.set(requestId, { resolve, reject, timer })
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
    if (opts.capabilities?.length) {
      this.agentCapabilities.set(agentId, opts.capabilities)
    }

    // Register with server
    this.wsClient.send({
      type: 'gateway:register_agent',
      agent: {
        id: agentId,
        name: opts.name,
        type: opts.type as AgentType,
        workingDirectory: opts.workingDirectory,
        capabilities: opts.capabilities,
      },
    })

    log.info(`Registered agent: ${opts.name} (${opts.type}) -> ${agentId}`)
    return agentId
  }

  removeAgent(agentId: string) {
    const adapter = this.adapters.get(agentId)
    if (adapter) {
      adapter.dispose()
      this.adapters.delete(agentId)
      this.agentCapabilities.delete(agentId)
      // Clean up room contexts for this agent
      for (const key of this.roomContexts.keys()) {
        if (key.startsWith(`${agentId}:`)) {
          this.roomContexts.delete(key)
        }
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
      | ServerPermissionResponse,
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
    }
  }

  private handlePermissionResponse(msg: ServerPermissionResponse) {
    const pending = this.pendingPermissions.get(msg.requestId)
    if (!pending) {
      log.warn(`No pending permission for requestId=${msg.requestId}`)
      return
    }
    clearTimeout(pending.timer)
    this.pendingPermissions.delete(msg.requestId)
    const behavior = msg.decision === 'allow' ? 'allow' : 'deny'
    pending.resolve({ behavior })
    log.info(`Permission ${msg.decision} for requestId=${msg.requestId}`)
  }

  private handleRoomContext(msg: ServerRoomContext) {
    const key = `${msg.agentId}:${msg.context.roomId}`
    this.roomContexts.set(key, msg.context)
    log.info(`Room context updated for agent ${msg.agentId} in room ${msg.context.roomName}`)
  }

  private handleSendToAgent(msg: ServerSendToAgent) {
    const adapter = this.adapters.get(msg.agentId)
    if (!adapter) {
      log.warn(`Agent not found: ${msg.agentId}`)
      return
    }

    // Track which room this agent is responding to
    this.agentCurrentRoom.set(msg.agentId, msg.roomId)

    const messageId = msg.messageId
    const allChunks: ParsedChunk[] = []
    let completed = false

    // Update status to busy
    this.wsClient.send({
      type: 'gateway:agent_status',
      agentId: msg.agentId,
      status: 'busy',
    })

    try {
      adapter.sendMessage(
        msg.content,
        (chunk) => {
          allChunks.push(chunk)
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
            this.wsClient.send({
              type: 'gateway:agent_status',
              agentId: msg.agentId,
              status: 'online',
            })
          }

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
                sendComplete()
              })
              .catch((err) => {
                log.warn(`Workspace status collection failed: ${(err as Error).message}`)
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
          this.wsClient.send({
            type: 'gateway:agent_status',
            agentId: msg.agentId,
            status: 'error',
          })
        },
        {
          roomId: msg.roomId,
          senderName: msg.senderName,
          routingMode: msg.routingMode,
          conversationId: msg.conversationId,
          depth: msg.depth,
          roomContext: this.roomContexts.get(`${msg.agentId}:${msg.roomId}`),
        },
      )
    } catch (err) {
      // Recover from synchronous throw in sendMessage to avoid agent stuck in 'busy'
      log.error(`Agent ${msg.agentId} sendMessage threw: ${(err as Error).message}`)
      this.wsClient.send({
        type: 'gateway:agent_status',
        agentId: msg.agentId,
        status: 'error',
      })
    }
  }

  private handleRemoveAgent(agentId: string) {
    const adapter = this.adapters.get(agentId)
    if (adapter) {
      adapter.dispose()
      this.adapters.delete(agentId)
      this.agentCapabilities.delete(agentId)
      for (const key of this.roomContexts.keys()) {
        if (key.startsWith(`${agentId}:`)) {
          this.roomContexts.delete(key)
        }
      }
      log.info(`Agent ${agentId} removed by server`)
    }
  }

  private handleStopAgent(agentId: string) {
    const adapter = this.adapters.get(agentId)
    if (adapter) {
      adapter.stop()
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

  async disposeAll() {
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
    await Promise.allSettled(disposePromises)
    this.adapters.clear()
    this.agentCapabilities.clear()
    this.roomContexts.clear()
    this.agentCurrentRoom.clear()
    // Reject all pending permissions
    for (const [id, pending] of this.pendingPermissions) {
      clearTimeout(pending.timer)
      pending.resolve({ behavior: 'deny' })
    }
    this.pendingPermissions.clear()
  }
}
