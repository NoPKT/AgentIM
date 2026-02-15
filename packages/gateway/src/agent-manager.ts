import { nanoid } from 'nanoid'
import { createAdapter, type BaseAgentAdapter } from './adapters/index.js'
import { GatewayWsClient } from './ws-client.js'
import { createLogger } from './lib/logger.js'
import type { GatewayMessage, ServerSendToAgent, ServerStopAgent, ServerRoomContext, ServerGatewayMessage, RoomContext, ParsedChunk } from '@agentim/shared'

const log = createLogger('AgentManager')

export class AgentManager {
  private adapters = new Map<string, BaseAgentAdapter>()
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
    const adapter = createAdapter(opts.type, {
      agentId,
      agentName: opts.name,
      workingDirectory: opts.workingDirectory,
      command: opts.command,
      args: opts.args,
    })

    this.adapters.set(agentId, adapter)

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
      this.wsClient.send({
        type: 'gateway:unregister_agent',
        agentId,
      })
    }
  }

  handleServerMessage(msg: ServerSendToAgent | ServerStopAgent | ServerRoomContext) {
    if (msg.type === 'server:send_to_agent') {
      this.handleSendToAgent(msg)
    } else if (msg.type === 'server:stop_agent') {
      this.handleStopAgent(msg.agentId)
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

    // mention_assign mode: if agent is NOT mentioned, skip silently
    if (msg.routingMode === 'mention_assign' && !msg.isMentioned) {
      log.debug(`Agent ${msg.agentId} received mention_assign but not mentioned, skipping`)
      return
    }

    const messageId = nanoid()
    const allChunks: ParsedChunk[] = []

    // Update status to busy
    this.wsClient.send({
      type: 'gateway:agent_status',
      agentId: msg.agentId,
      status: 'busy',
    })

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
        isMentioned: msg.isMentioned,
        roomContext: this.roomContexts.get(`${msg.agentId}:${msg.roomId}`),
      },
    )
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

  disposeAll() {
    for (const [id, adapter] of this.adapters) {
      adapter.dispose()
      this.wsClient.send({
        type: 'gateway:unregister_agent',
        agentId: id,
      })
    }
    this.adapters.clear()
  }
}
