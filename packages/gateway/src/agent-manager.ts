import { nanoid } from 'nanoid'
import { createAdapter, type BaseAgentAdapter } from './adapters/index.js'
import { GatewayWsClient } from './ws-client.js'
import type { GatewayMessage, ServerSendToAgent, ServerStopAgent, ServerGatewayMessage } from '@agentim/shared'

export class AgentManager {
  private adapters = new Map<string, BaseAgentAdapter>()
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
      },
    })

    console.log(`[AgentManager] Registered agent: ${opts.name} (${opts.type}) -> ${agentId}`)
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

  handleServerMessage(msg: ServerSendToAgent | ServerStopAgent) {
    if (msg.type === 'server:send_to_agent') {
      this.handleSendToAgent(msg)
    } else if (msg.type === 'server:stop_agent') {
      this.handleStopAgent(msg.agentId)
    }
  }

  private handleSendToAgent(msg: ServerSendToAgent) {
    const adapter = this.adapters.get(msg.agentId)
    if (!adapter) {
      console.warn(`[AgentManager] Agent not found: ${msg.agentId}`)
      return
    }

    const messageId = nanoid()

    // Update status to busy
    this.wsClient.send({
      type: 'gateway:agent_status',
      agentId: msg.agentId,
      status: 'busy',
    })

    adapter.sendMessage(
      msg.content,
      (chunk) => {
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
        })
        this.wsClient.send({
          type: 'gateway:agent_status',
          agentId: msg.agentId,
          status: 'online',
        })
      },
      (error) => {
        this.wsClient.send({
          type: 'gateway:message_complete',
          roomId: msg.roomId,
          agentId: msg.agentId,
          messageId,
          fullContent: `Error: ${error}`,
        })
        this.wsClient.send({
          type: 'gateway:agent_status',
          agentId: msg.agentId,
          status: 'error',
        })
      },
      { roomId: msg.roomId, senderName: msg.senderName },
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
