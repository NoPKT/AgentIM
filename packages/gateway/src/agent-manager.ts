import { nanoid } from 'nanoid'
import { createAdapter, type BaseAgentAdapter } from './adapters/index.js'
import { GatewayWsClient } from './ws-client.js'
import { createLogger } from './lib/logger.js'
import type {
  GatewayMessage,
  ServerSendToAgent,
  ServerStopAgent,
  ServerRemoveAgent,
  ServerRoomContext,
  ServerGatewayMessage,
  RoomContext,
  ParsedChunk,
} from '@agentim/shared'

const log = createLogger('AgentManager')

export class AgentManager {
  private adapters = new Map<string, BaseAgentAdapter>()
  private agentCapabilities = new Map<string, string[]>()
  private roomContexts = new Map<string, RoomContext>()
  private wsClient: GatewayWsClient

  constructor(wsClient: GatewayWsClient) {
    this.wsClient = wsClient
  }

  addAgent(opts: {
    type: string
    name: string
    workingDirectory?: string
    command?: string
    args?: string[]
    capabilities?: string[]
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
        type: opts.type,
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
          type: adapter.type,
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
    msg: ServerSendToAgent | ServerStopAgent | ServerRemoveAgent | ServerRoomContext,
  ) {
    if (msg.type === 'server:send_to_agent') {
      this.handleSendToAgent(msg)
    } else if (msg.type === 'server:stop_agent') {
      this.handleStopAgent(msg.agentId)
    } else if (msg.type === 'server:remove_agent') {
      this.handleRemoveAgent(msg.agentId)
    } else if (msg.type === 'server:room_context') {
      this.handleRoomContext(msg)
    }
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

    const messageId = msg.messageId
    const allChunks: ParsedChunk[] = []

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
        },
        (error) => {
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
  }
}
