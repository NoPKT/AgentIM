import type { WSContext } from 'hono/ws'
import { createLogger } from '../lib/logger.js'
import { config } from '../config.js'

const log = createLogger('Connections')

interface ClientConnection {
  ws: WSContext
  userId: string
  username: string
  joinedRooms: Set<string>
}

interface GatewayConnection {
  ws: WSContext
  userId: string
  gatewayId: string
  agentIds: Set<string>
}

class ConnectionManager {
  private clients = new Map<WSContext, ClientConnection>()
  private gateways = new Map<WSContext, GatewayConnection>()

  // Agent ID → gateway ws mapping
  private agentToGateway = new Map<string, WSContext>()

  // User ID → count of active connections (a user may have multiple tabs)
  private onlineUsers = new Map<string, number>()

  // Room ID → set of ws connections (reverse index for O(1) room broadcast)
  private roomClients = new Map<string, Set<WSContext>>()

  // User ID → count of gateway connections
  private userGatewayCount = new Map<string, number>()

  // ─── Client connections ───

  addClient(
    ws: WSContext,
    userId: string,
    username: string,
    userMaxConnections?: number | null,
  ): { ok: boolean; error?: string } {
    const existing = this.clients.get(ws)

    // Check limits FIRST before mutating any counters.
    // If we decremented the old user's counter before these checks and then
    // returned early on failure, the existing socket would remain bound to
    // the old user but their online count would be permanently under-reported.
    if (!existing || existing.userId !== userId) {
      const maxPerUser = userMaxConnections ?? config.maxWsConnectionsPerUser
      const currentCount = this.onlineUsers.get(userId) ?? 0
      if (currentCount >= maxPerUser) {
        log.warn(`User ${userId} exceeded max connections (${maxPerUser})`)
        return { ok: false, error: 'Too many connections' }
      }
      // Enforce global connection limit (only for truly new connections)
      if (!existing && this.clients.size >= config.maxTotalWsConnections) {
        log.warn(`Global connection limit reached (${config.maxTotalWsConnections})`)
        return { ok: false, error: 'Server at capacity' }
      }
    }

    // Checks passed — now it is safe to update the old user's counter.
    if (existing) {
      const oldCount = (this.onlineUsers.get(existing.userId) ?? 1) - 1
      if (oldCount <= 0) {
        this.onlineUsers.delete(existing.userId)
      } else {
        this.onlineUsers.set(existing.userId, oldCount)
      }
    }

    this.clients.set(ws, { ws, userId, username, joinedRooms: existing?.joinedRooms ?? new Set() })
    const count = this.onlineUsers.get(userId) ?? 0
    this.onlineUsers.set(userId, count + 1)
    return { ok: true }
  }

  removeClient(ws: WSContext) {
    const client = this.clients.get(ws)
    if (client) {
      const count = Math.max(0, (this.onlineUsers.get(client.userId) ?? 1) - 1)
      if (count <= 0) {
        this.onlineUsers.delete(client.userId)
      } else {
        this.onlineUsers.set(client.userId, count)
      }
      // Clean up room reverse index
      for (const roomId of client.joinedRooms) {
        const set = this.roomClients.get(roomId)
        if (set) {
          set.delete(ws)
          if (set.size === 0) this.roomClients.delete(roomId)
        }
      }
    }
    this.clients.delete(ws)
  }

  isUserOnline(userId: string): boolean {
    return (this.onlineUsers.get(userId) ?? 0) > 0
  }

  getOnlineUserIds(): string[] {
    return [...this.onlineUsers.keys()]
  }

  getClient(ws: WSContext): ClientConnection | undefined {
    return this.clients.get(ws)
  }

  joinRoom(ws: WSContext, roomId: string) {
    const client = this.clients.get(ws)
    if (client) {
      client.joinedRooms.add(roomId)
      let set = this.roomClients.get(roomId)
      if (!set) {
        set = new Set()
        this.roomClients.set(roomId, set)
      }
      set.add(ws)
    }
  }

  leaveRoom(ws: WSContext, roomId: string) {
    const client = this.clients.get(ws)
    if (client) {
      client.joinedRooms.delete(roomId)
      const set = this.roomClients.get(roomId)
      if (set) {
        set.delete(ws)
        if (set.size === 0) this.roomClients.delete(roomId)
      }
    }
  }

  getClientsInRoom(roomId: string): ClientConnection[] {
    const wsSet = this.roomClients.get(roomId)
    if (!wsSet) return []
    const result: ClientConnection[] = []
    for (const ws of wsSet) {
      const client = this.clients.get(ws)
      if (client) result.push(client)
    }
    return result
  }

  /**
   * Remove a user from a room across all their WS connections.
   * Called when a member is removed via the HTTP API to keep WS state in sync.
   */
  evictUserFromRoom(userId: string, roomId: string) {
    for (const client of this.clients.values()) {
      if (client.userId === userId && client.joinedRooms.has(roomId)) {
        client.joinedRooms.delete(roomId)
        const set = this.roomClients.get(roomId)
        if (set) {
          set.delete(client.ws)
          if (set.size === 0) this.roomClients.delete(roomId)
        }
        // Notify the client they've been removed
        this.sendToClient(client.ws, {
          type: 'server:room_removed',
          roomId,
        })
      }
    }
  }

  // ─── Gateway connections ───

  addGateway(
    ws: WSContext,
    userId: string,
    gatewayId: string,
    userMaxGateways?: number | null,
  ): { ok: boolean; error?: string } {
    const existing = this.gateways.get(ws)

    // Check limits FIRST before mutating any counters (same ordering discipline
    // as addClient — decrementing the old count before validation would leave
    // the counter underreported when the check fails).
    if (!existing || existing.userId !== userId) {
      const maxGateways = userMaxGateways ?? config.maxGatewaysPerUser
      const currentCount = this.userGatewayCount.get(userId) ?? 0
      if (currentCount >= maxGateways) {
        log.warn(`User ${userId} exceeded max gateways (${maxGateways})`)
        return { ok: false, error: 'Too many gateway connections' }
      }
    }

    // Checks passed — now it is safe to update the old user's counter.
    if (existing) {
      const oldCount = (this.userGatewayCount.get(existing.userId) ?? 1) - 1
      if (oldCount <= 0) {
        this.userGatewayCount.delete(existing.userId)
      } else {
        this.userGatewayCount.set(existing.userId, oldCount)
      }
    }

    this.gateways.set(ws, { ws, userId, gatewayId, agentIds: existing?.agentIds ?? new Set() })
    const count = this.userGatewayCount.get(userId) ?? 0
    this.userGatewayCount.set(userId, count + 1)
    return { ok: true }
  }

  removeGateway(ws: WSContext) {
    const gw = this.gateways.get(ws)
    if (gw) {
      for (const agentId of gw.agentIds) {
        this.agentToGateway.delete(agentId)
      }
      const count = Math.max(0, (this.userGatewayCount.get(gw.userId) ?? 1) - 1)
      if (count <= 0) {
        this.userGatewayCount.delete(gw.userId)
      } else {
        this.userGatewayCount.set(gw.userId, count)
      }
    }
    this.gateways.delete(ws)
  }

  getGateway(ws: WSContext): GatewayConnection | undefined {
    return this.gateways.get(ws)
  }

  registerAgent(ws: WSContext, agentId: string) {
    const gw = this.gateways.get(ws)
    if (gw) {
      gw.agentIds.add(agentId)
      this.agentToGateway.set(agentId, ws)
    }
  }

  unregisterAgent(ws: WSContext, agentId: string) {
    const gw = this.gateways.get(ws)
    if (gw) {
      gw.agentIds.delete(agentId)
      this.agentToGateway.delete(agentId)
    }
  }

  getGatewayForAgent(agentId: string): GatewayConnection | undefined {
    const ws = this.agentToGateway.get(agentId)
    if (ws) return this.gateways.get(ws)
    return undefined
  }

  // ─── Broadcast helpers ───

  broadcastToRoom(roomId: string, message: object, excludeWs?: WSContext) {
    const data = JSON.stringify(message)
    for (const client of this.getClientsInRoom(roomId)) {
      if (client.ws !== excludeWs) {
        try {
          client.ws.send(data)
        } catch (err) {
          log.warn(`Failed to send to client in room ${roomId}: ${(err as Error).message}`)
        }
      }
    }
  }

  sendToGateway(agentId: string, message: object): boolean {
    const gw = this.getGatewayForAgent(agentId)
    if (gw) {
      try {
        gw.ws.send(JSON.stringify(message))
        return true
      } catch (err) {
        log.warn(`Failed to send to gateway for agent ${agentId}: ${(err as Error).message}`)
        return false
      }
    }
    return false
  }

  sendToClient(ws: WSContext, message: object) {
    try {
      ws.send(JSON.stringify(message))
    } catch (err) {
      log.warn(`Failed to send to client: ${(err as Error).message}`)
    }
  }

  broadcastToAll(message: object) {
    const data = JSON.stringify(message)
    for (const client of this.clients.values()) {
      try {
        client.ws.send(data)
      } catch (err) {
        log.warn(`Failed to broadcast to client: ${(err as Error).message}`)
      }
    }
  }
}

export const connectionManager = new ConnectionManager()
