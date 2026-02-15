import type { WSContext } from 'hono/ws'

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

  // ─── Client connections ───

  addClient(ws: WSContext, userId: string, username: string) {
    this.clients.set(ws, { ws, userId, username, joinedRooms: new Set() })
    const count = this.onlineUsers.get(userId) ?? 0
    this.onlineUsers.set(userId, count + 1)
  }

  removeClient(ws: WSContext) {
    const client = this.clients.get(ws)
    if (client) {
      const count = (this.onlineUsers.get(client.userId) ?? 1) - 1
      if (count <= 0) {
        this.onlineUsers.delete(client.userId)
      } else {
        this.onlineUsers.set(client.userId, count)
      }
    }
    this.clients.delete(ws)
  }

  isUserOnline(userId: string): boolean {
    return (this.onlineUsers.get(userId) ?? 0) > 0
  }

  wasUserOnline(userId: string): boolean {
    // Check if user was online BEFORE the most recent removeClient call
    // This is called after removeClient, so if count was 1, now 0 → was sole connection
    return !this.isUserOnline(userId)
  }

  getOnlineUserIds(): string[] {
    return [...this.onlineUsers.keys()]
  }

  getClient(ws: WSContext): ClientConnection | undefined {
    return this.clients.get(ws)
  }

  joinRoom(ws: WSContext, roomId: string) {
    const client = this.clients.get(ws)
    if (client) client.joinedRooms.add(roomId)
  }

  leaveRoom(ws: WSContext, roomId: string) {
    const client = this.clients.get(ws)
    if (client) client.joinedRooms.delete(roomId)
  }

  getClientsInRoom(roomId: string): ClientConnection[] {
    return [...this.clients.values()].filter((c) => c.joinedRooms.has(roomId))
  }

  // ─── Gateway connections ───

  addGateway(ws: WSContext, userId: string, gatewayId: string) {
    this.gateways.set(ws, { ws, userId, gatewayId, agentIds: new Set() })
  }

  removeGateway(ws: WSContext) {
    const gw = this.gateways.get(ws)
    if (gw) {
      for (const agentId of gw.agentIds) {
        this.agentToGateway.delete(agentId)
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
        client.ws.send(data)
      }
    }
  }

  sendToGateway(agentId: string, message: object): boolean {
    const gw = this.getGatewayForAgent(agentId)
    if (gw) {
      gw.ws.send(JSON.stringify(message))
      return true
    }
    return false
  }

  sendToClient(ws: WSContext, message: object) {
    ws.send(JSON.stringify(message))
  }

  broadcastToAll(message: object) {
    const data = JSON.stringify(message)
    for (const client of this.clients.values()) {
      client.ws.send(data)
    }
  }
}

export const connectionManager = new ConnectionManager()
