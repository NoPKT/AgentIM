import type { WSContext } from 'hono/ws'
import { WS_ERROR_CODES } from '@agentim/shared'
import { createLogger } from '../lib/logger.js'
import { config } from '../config.js'

const log = createLogger('Connections')

// Standard WebSocket close code: 1008 = Policy Violation (session revoked via logout/password change)
const WS_CLOSE_SESSION_REVOKED = 1008

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

  // Agent IDs deleted while their gateway was offline.
  // Prevents resurrection via reRegisterAll() on reconnect.
  private deletedAgentIds = new Set<string>()

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

      // If re-authing as a different user, clear old room subscriptions
      // to prevent the new user from receiving broadcasts for rooms they
      // are not a member of.
      if (existing.userId !== userId) {
        for (const roomId of existing.joinedRooms) {
          const set = this.roomClients.get(roomId)
          if (set) {
            set.delete(ws)
            if (set.size === 0) this.roomClients.delete(roomId)
          }
        }
        existing.joinedRooms.clear()
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
      if (client.userId !== userId) continue

      // Always notify the client, even if they haven't joined this room
      // in the current WS session (they still see it in the sidebar).
      this.sendToClient(client.ws, {
        type: 'server:room_removed',
        roomId,
      })

      // Clean up room subscription if it was active
      if (client.joinedRooms.has(roomId)) {
        client.joinedRooms.delete(roomId)
        const set = this.roomClients.get(roomId)
        if (set) {
          set.delete(client.ws)
          if (set.size === 0) this.roomClients.delete(roomId)
        }
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

      // If re-authing as a different user, clear old agent bindings
      // to prevent the new user from controlling agents registered
      // under the previous account.
      if (existing.userId !== userId) {
        for (const agentId of existing.agentIds) {
          this.agentToGateway.delete(agentId)
        }
        existing.agentIds.clear()
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

  /**
   * Unregister an agent by ID (called from HTTP API when agent is deleted).
   * Optionally verifies that the agent's gateway belongs to the given user
   * to prevent cross-user unregistration.
   */
  unregisterAgentById(agentId: string, userId?: string) {
    const ws = this.agentToGateway.get(agentId)
    if (ws) {
      const gw = this.gateways.get(ws)
      if (gw) {
        if (userId && gw.userId !== userId) {
          log.warn(
            `Refused to unregister agent ${agentId}: gateway belongs to user ${gw.userId}, not ${userId}`,
          )
          return
        }
        gw.agentIds.delete(agentId)
      }
    }
    this.agentToGateway.delete(agentId)
  }

  /**
   * Mark an agent as server-deleted so that a reconnecting gateway
   * cannot resurrect it via reRegisterAll().
   */
  markAgentDeleted(agentId: string) {
    this.deletedAgentIds.add(agentId)
  }

  /** Check if an agent was deleted while its gateway was offline. */
  isAgentDeleted(agentId: string): boolean {
    return this.deletedAgentIds.has(agentId)
  }

  /** Clear the deletion flag once the gateway has been notified. */
  clearAgentDeleted(agentId: string) {
    this.deletedAgentIds.delete(agentId)
  }

  // ─── Broadcast helpers ───

  broadcastToRoom(roomId: string, message: object, excludeWs?: WSContext) {
    const data = JSON.stringify(message)
    const failed: WSContext[] = []
    for (const client of this.getClientsInRoom(roomId)) {
      if (client.ws !== excludeWs) {
        try {
          client.ws.send(data)
        } catch (err) {
          log.warn(`Failed to send to client in room ${roomId}: ${(err as Error).message}`)
          failed.push(client.ws)
        }
      }
    }
    // Clean up faulty connections after iteration to avoid mutating during loop
    for (const ws of failed) {
      this.removeClient(ws)
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

  /**
   * Forcefully disconnect all client and gateway WS connections for a user.
   * Called when tokens are revoked (logout / password change) to ensure
   * immediate session termination.
   */
  disconnectUser(userId: string) {
    // Close client connections
    for (const [ws, client] of this.clients) {
      if (client.userId === userId) {
        try {
          this.sendToClient(ws, {
            type: 'server:error',
            code: WS_ERROR_CODES.SESSION_REVOKED,
            message: 'Session revoked',
          })
        } catch {
          /* best-effort notification */
        }
        try {
          ws.close(WS_CLOSE_SESSION_REVOKED, 'Session revoked')
        } catch {
          /* ignore close errors */
        }
      }
    }
    // Close gateway connections
    for (const [ws, gw] of this.gateways) {
      if (gw.userId === userId) {
        try {
          ws.close(WS_CLOSE_SESSION_REVOKED, 'Session revoked')
        } catch {
          /* ignore close errors */
        }
      }
    }
  }
}

export const connectionManager = new ConnectionManager()
