import type { WSContext } from 'hono/ws'
import { nanoid } from 'nanoid'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { clientMessageSchema, parseMentions } from '@agentim/shared'
import type { ServerSendToAgent, ServerStopAgent, RoutingMode } from '@agentim/shared'
import { connectionManager } from './connections.js'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked } from '../lib/tokenRevocation.js'
import { createLogger } from '../lib/logger.js'
import { captureException } from '../lib/sentry.js'
import { config } from '../config.js'
import { db } from '../db/index.js'
import { messages, rooms, roomMembers, agents, messageAttachments, users } from '../db/schema.js'
import { sanitizeContent } from '../lib/sanitize.js'
import { getRedis } from '../lib/redis.js'
import { selectAgents } from '../lib/routerLlm.js'
import { getRouterConfig } from '../lib/routerConfig.js'
import { buildAgentNameMap } from '../lib/agentUtils.js'

const log = createLogger('ClientHandler')

const MAX_MESSAGE_SIZE = config.maxWsMessageSize
const RATE_LIMIT_MAX = 30 // max 30 messages per window

async function isRateLimited(userId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const key = `ws:rate:${userId}`
    const count = await redis.incr(key)
    // Only set EXPIRE on first increment to use fixed time buckets
    if (count === 1) {
      await redis.expire(key, config.clientRateLimitWindow)
    }
    return count > RATE_LIMIT_MAX
  } catch {
    log.warn('Redis unavailable for WS rate limiting, rejecting request (fail-closed)')
    return true
  }
}

export async function handleClientMessage(ws: WSContext, raw: string) {
  if (raw.length > MAX_MESSAGE_SIZE) {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: 'MESSAGE_TOO_LARGE',
      message: 'Message exceeds maximum size',
    })
    return
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: 'INVALID_JSON',
      message: 'Invalid JSON',
    })
    return
  }

  const parsed = clientMessageSchema.safeParse(data)
  if (!parsed.success) {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: 'INVALID_MESSAGE',
      message: 'Invalid message format',
    })
    return
  }

  const msg = parsed.data

  // Auth and ping bypass authentication check
  const isPublicMsg = msg.type === 'client:auth' || msg.type === 'client:ping'

  if (!isPublicMsg) {
    const client = connectionManager.getClient(ws)
    if (!client) {
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: 'NOT_AUTHENTICATED',
        message: 'Please authenticate first',
      })
      return
    }

    // Rate limit authenticated messages
    if (await isRateLimited(client.userId)) {
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: 'RATE_LIMITED',
        message: 'Too many messages, please slow down',
      })
      return
    }
  }

  try {
    switch (msg.type) {
      case 'client:auth':
        return await handleAuth(ws, msg.token)
      case 'client:join_room':
        return await handleJoinRoom(ws, msg.roomId)
      case 'client:leave_room':
        return handleLeaveRoom(ws, msg.roomId)
      case 'client:send_message':
        return await handleSendMessage(
          ws,
          msg.roomId,
          msg.content,
          msg.mentions,
          msg.replyToId,
          msg.attachmentIds,
        )
      case 'client:typing':
        return handleTyping(ws, msg.roomId)
      case 'client:stop_generation':
        return handleStopGeneration(ws, msg.roomId, msg.agentId)
      case 'client:ping':
        ws.send(JSON.stringify({ type: 'server:pong', ts: msg.ts }))
        return
      default:
        log.warn(`Unknown client message type: ${(msg as { type: string }).type}`)
        return
    }
  } catch (err) {
    log.error(`Error handling client message ${msg.type}: ${(err as Error).message}${(err as Error).stack ? `\n${(err as Error).stack}` : ''}`)
    captureException(err)
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
    })
  }
}

async function handleAuth(ws: WSContext, token: string) {
  try {
    const payload = await verifyToken(token)
    if (payload.type !== 'access') {
      connectionManager.sendToClient(ws, {
        type: 'server:auth_result',
        ok: false,
        error: 'Invalid token type',
      })
      return
    }
    // Check if the token was revoked (logout / password change)
    if (payload.iat && (await isTokenRevoked(payload.sub, payload.iat * 1000))) {
      connectionManager.sendToClient(ws, {
        type: 'server:auth_result',
        ok: false,
        error: 'Token revoked',
      })
      return
    }
    // Fetch per-user connection limit override
    const [user] = await db
      .select({ maxWsConnections: users.maxWsConnections })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1)

    const wasOnline = connectionManager.isUserOnline(payload.sub)
    const result = connectionManager.addClient(ws, payload.sub, payload.username, user?.maxWsConnections)
    if (!result.ok) {
      connectionManager.sendToClient(ws, {
        type: 'server:auth_result',
        ok: false,
        error: result.error ?? 'Connection limit exceeded',
      })
      return
    }
    connectionManager.sendToClient(ws, {
      type: 'server:auth_result',
      ok: true,
      userId: payload.sub,
    })
    // Broadcast online presence if this is the user's first connection
    if (!wasOnline) {
      connectionManager.broadcastToAll({
        type: 'server:presence',
        userId: payload.sub,
        username: payload.username,
        online: true,
      })
    }
  } catch {
    connectionManager.sendToClient(ws, {
      type: 'server:auth_result',
      ok: false,
      error: 'Invalid token',
    })
  }
}

async function handleJoinRoom(ws: WSContext, roomId: string) {
  const client = connectionManager.getClient(ws)
  if (!client) return

  // Verify user is a member of this room (or the room creator)
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: 'ROOM_NOT_FOUND',
      message: 'Room not found',
    })
    return
  }

  if (room.createdById !== client.userId) {
    const [membership] = await db
      .select()
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, client.userId)))
      .limit(1)

    if (!membership) {
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: 'NOT_A_MEMBER',
        message: 'You are not a member of this room',
      })
      return
    }
  }

  connectionManager.joinRoom(ws, roomId)
}

function handleLeaveRoom(ws: WSContext, roomId: string) {
  connectionManager.leaveRoom(ws, roomId)
}

async function handleSendMessage(
  ws: WSContext,
  roomId: string,
  rawContent: string,
  mentions: string[],
  replyToId?: string,
  attachmentIds?: string[],
) {
  const client = connectionManager.getClient(ws)
  if (!client) return

  // Verify user is a member of this room
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: 'ROOM_NOT_FOUND',
      message: 'Room not found',
    })
    return
  }

  if (room.createdById !== client.userId) {
    const [membership] = await db
      .select()
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, client.userId)))
      .limit(1)
    if (!membership) {
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: 'NOT_A_MEMBER',
        message: 'You are not a member of this room',
      })
      return
    }
  }

  const content = sanitizeContent(rawContent)
  const id = nanoid()
  const now = new Date().toISOString()

  // Use server-parsed mentions instead of trusting client input
  const serverParsedMentions = parseMentions(content)

  // Atomic: persist message + link attachments in a single transaction
  const attachments = await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id,
      roomId,
      senderId: client.userId,
      senderType: 'user',
      senderName: client.username,
      type: 'text',
      content,
      replyToId,
      mentions: JSON.stringify(serverParsedMentions),
      createdAt: now,
    })

    if (attachmentIds && attachmentIds.length > 20) {
      throw new Error('Too many attachments (max 20)')
    }

    if (attachmentIds && attachmentIds.length > 0) {
      await tx
        .update(messageAttachments)
        .set({ messageId: id })
        .where(
          and(
            inArray(messageAttachments.id, attachmentIds),
            eq(messageAttachments.uploadedBy, client.userId),
            isNull(messageAttachments.messageId),
          ),
        )

      const rows = await tx
        .select()
        .from(messageAttachments)
        .where(eq(messageAttachments.messageId, id))

      return rows.map((r) => ({
        id: r.id,
        messageId: id,
        filename: r.filename,
        mimeType: r.mimeType,
        size: r.size,
        url: r.url,
      }))
    }

    return [] as {
      id: string
      messageId: string
      filename: string
      mimeType: string
      size: number
      url: string
    }[]
  })

  const message = {
    id,
    roomId,
    senderId: client.userId,
    senderType: 'user' as const,
    senderName: client.username,
    type: 'text' as const,
    content,
    replyToId,
    mentions: serverParsedMentions,
    ...(attachments.length > 0 ? { attachments } : {}),
    createdAt: now,
  }

  // Broadcast to all clients in the room
  connectionManager.broadcastToRoom(roomId, {
    type: 'server:new_message',
    message,
  })

  // Route to agents based on server-parsed mentions and broadcast mode
  await routeToAgents(room, message, serverParsedMentions)
}

async function routeToAgents(
  room: { id: string; broadcastMode: boolean; systemPrompt: string | null },
  message: { id: string; content: string; senderName: string },
  mentions: string[],
) {
  const roomId = room.id

  // Get agent members in this room
  const agentMembers = await db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberType, 'agent')))

  if (agentMembers.length === 0) return

  // Get the actual agent records for these members
  const agentIds = agentMembers.map((m) => m.memberId)
  const agentRows = await db.select().from(agents).where(inArray(agents.id, agentIds))
  const agentMap = new Map(agentRows.map((a) => [a.id, a]))

  const agentNameMap = buildAgentNameMap(agentRows)

  // Server-side mention parsing — don't trust client-provided mentions for routing
  const serverMentions = parseMentions(message.content)

  // Resolve mentioned agent IDs from server-parsed mentions
  const mentionedAgentIds = new Set<string>()
  for (const mention of serverMentions) {
    const agent = agentNameMap.get(mention)
    if (agent && agentMembers.some((m) => m.memberId === agent.id)) {
      mentionedAgentIds.add(agent.id)
    }
  }

  // Two-mode routing decision matrix:
  // has @mention (any room)            → direct: only mentioned agents receive
  // broadcast + no mention + AI Router → broadcast: AI Router selects agents
  // broadcast + no mention + no Router → no routing (message shown in chat only)
  // non-broadcast + no mention         → no routing
  let routingMode: RoutingMode
  let targetAgents: typeof agentRows = []

  if (mentionedAgentIds.size > 0) {
    // Direct: only mentioned agents receive
    routingMode = 'direct'
    for (const agentId of mentionedAgentIds) {
      const agent = agentMap.get(agentId)
      if (agent) targetAgents.push(agent)
    }
  } else if (room.broadcastMode) {
    // Broadcast room, no mentions — try AI Router via room's router config
    const cliAgents = agentRows.filter((a) => a.connectionType !== 'api')
    if (cliAgents.length === 0) return

    const routerCfg = await getRouterConfig(roomId)
    if (!routerCfg) return // No router configured → don't route

    const routerResult = await selectAgents(
      message.content,
      cliAgents.map((a) => {
        let capabilities: string[] | undefined
        if (a.capabilities) {
          try {
            capabilities = JSON.parse(a.capabilities)
          } catch {
            /* ignore */
          }
        }
        return { id: a.id, name: a.name, type: a.type, capabilities }
      }),
      routerCfg,
      room.systemPrompt ?? undefined,
    )

    if (routerResult === null || routerResult.length === 0) {
      // No agents selected — don't route
      return
    }

    routingMode = 'broadcast'
    for (const id of routerResult) {
      const agent = agentMap.get(id)
      if (agent) targetAgents.push(agent)
    }
  } else {
    // Non-broadcast + no mentions = don't route
    return
  }

  // Generate a new conversation chain
  const conversationId = nanoid()

  for (const agent of targetAgents) {
    const sendMsg: ServerSendToAgent = {
      type: 'server:send_to_agent',
      agentId: agent.id,
      roomId,
      messageId: message.id,
      content: message.content,
      senderName: message.senderName,
      senderType: 'user',
      routingMode,
      conversationId,
      depth: 0,
    }
    connectionManager.sendToGateway(agent.id, sendMsg)
  }
}

async function handleTyping(ws: WSContext, roomId: string) {
  const client = connectionManager.getClient(ws)
  if (!client || !client.joinedRooms.has(roomId)) return

  // Debounce typing events: max 1 per second per user per room
  try {
    const redis = getRedis()
    const key = `ws:typing:${client.userId}:${roomId}`
    const allowed = await redis.set(key, '1', 'EX', 1, 'NX')
    if (!allowed) return // Already sent recently, silently drop
  } catch {
    // Redis unavailable, allow through
  }

  connectionManager.broadcastToRoom(
    roomId,
    {
      type: 'server:typing',
      roomId,
      userId: client.userId,
      username: client.username,
    },
    ws,
  )
}

async function handleStopGeneration(ws: WSContext, roomId: string, agentId: string) {
  const client = connectionManager.getClient(ws)
  if (!client || !client.joinedRooms.has(roomId)) return

  // Verify the agent is a member of this room (prevent cross-room interference)
  const [membership] = await db
    .select({ memberId: roomMembers.memberId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, agentId)))
    .limit(1)
  if (!membership) return

  const stopMsg: ServerStopAgent = {
    type: 'server:stop_agent',
    agentId,
  }
  connectionManager.sendToGateway(agentId, stopMsg)
}

export function handleClientDisconnect(ws: WSContext) {
  const client = connectionManager.getClient(ws)
  connectionManager.removeClient(ws)
  if (!client) return

  // Broadcast typing_stop for each room the disconnected user had joined
  for (const roomId of client.joinedRooms) {
    connectionManager.broadcastToRoom(roomId, {
      type: 'server:typing',
      roomId,
      userId: client.userId,
      username: client.username,
    })
  }

  // Broadcast offline presence if this was the user's last connection
  if (!connectionManager.isUserOnline(client.userId)) {
    connectionManager.broadcastToAll({
      type: 'server:presence',
      userId: client.userId,
      username: client.username,
      online: false,
    })
  }
}
