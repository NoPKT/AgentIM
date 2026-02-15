import type { WSContext } from 'hono/ws'
import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import { clientMessageSchema } from '@agentim/shared'
import type { ServerSendToAgent, ServerStopAgent, RoutingMode } from '@agentim/shared'
import { connectionManager } from './connections.js'
import { verifyToken } from '../lib/jwt.js'
import { createLogger } from '../lib/logger.js'
import { db } from '../db/index.js'
import { messages, rooms, roomMembers, agents, messageAttachments } from '../db/schema.js'
import { sanitizeContent } from '../lib/sanitize.js'
import { getRedis } from '../lib/redis.js'

const log = createLogger('ClientHandler')

const MAX_MESSAGE_SIZE = 64 * 1024 // 64 KB
const RATE_LIMIT_WINDOW = 10 // 10 seconds
const RATE_LIMIT_MAX = 30 // max 30 messages per window

async function isRateLimited(userId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const key = `ws:rate:${userId}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW)
    return count > RATE_LIMIT_MAX
  } catch {
    // If Redis is unavailable, allow the request
    return false
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

  // Rate limit all messages except auth and ping
  if (msg.type !== 'client:auth' && msg.type !== 'client:ping') {
    const client = connectionManager.getClient(ws)
    if (client && await isRateLimited(client.userId)) {
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: 'RATE_LIMITED',
        message: 'Too many messages, please slow down',
      })
      return
    }
  }

  switch (msg.type) {
    case 'client:auth':
      return handleAuth(ws, msg.token)
    case 'client:join_room':
      return handleJoinRoom(ws, msg.roomId)
    case 'client:leave_room':
      return handleLeaveRoom(ws, msg.roomId)
    case 'client:send_message':
      return handleSendMessage(ws, msg.roomId, msg.content, msg.mentions, msg.replyToId, msg.attachmentIds)
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
    const wasOnline = connectionManager.isUserOnline(payload.sub)
    connectionManager.addClient(ws, payload.sub, payload.username)
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

  // Persist message
  await db.insert(messages).values({
    id,
    roomId,
    senderId: client.userId,
    senderType: 'user',
    senderName: client.username,
    type: 'text',
    content,
    replyToId,
    mentions: JSON.stringify(mentions),
    createdAt: now,
  })

  // Link attachments to this message
  let attachments: { id: string; messageId: string; filename: string; mimeType: string; size: number; url: string }[] = []
  if (attachmentIds && attachmentIds.length > 0) {
    await db
      .update(messageAttachments)
      .set({ messageId: id })
      .where(
        and(
          inArray(messageAttachments.id, attachmentIds),
          eq(messageAttachments.uploadedBy, client.userId),
        ),
      )

    const rows = await db
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.messageId, id))

    attachments = rows.map((r) => ({
      id: r.id,
      messageId: id,
      filename: r.filename,
      mimeType: r.mimeType,
      size: r.size,
      url: r.url,
    }))
  }

  const message = {
    id,
    roomId,
    senderId: client.userId,
    senderType: 'user' as const,
    senderName: client.username,
    type: 'text' as const,
    content,
    replyToId,
    mentions,
    ...(attachments.length > 0 ? { attachments } : {}),
    createdAt: now,
  }

  // Broadcast to all clients in the room
  connectionManager.broadcastToRoom(roomId, {
    type: 'server:new_message',
    message,
  })

  // Route to agents based on mentions and broadcast mode
  await routeToAgents(room, message, mentions)
}

async function routeToAgents(
  room: { id: string; broadcastMode: boolean },
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

  // Build name→agent map, preferring online agents when duplicates exist
  const agentNameMap = new Map<string, (typeof agentRows)[number]>()
  for (const a of agentRows) {
    const existing = agentNameMap.get(a.name)
    if (!existing || (existing.status !== 'online' && a.status === 'online')) {
      agentNameMap.set(a.name, a)
    }
  }

  // Resolve mentioned agent IDs
  const mentionedAgentIds = new Set<string>()
  for (const mention of mentions) {
    const agent = agentNameMap.get(mention)
    if (agent && agentMembers.some((m) => m.memberId === agent.id)) {
      mentionedAgentIds.add(agent.id)
    }
  }

  // Three-mode routing decision matrix:
  // broadcastMode=true  + no mention  → broadcast: all agents receive & respond
  // broadcastMode=true  + has mention → mention_assign: all agents receive, only mentioned respond
  // broadcastMode=false + has mention → direct: only mentioned agents receive
  // broadcastMode=false + no mention  → no routing
  let routingMode: RoutingMode
  let targetAgents: typeof agentRows = []

  if (room.broadcastMode && mentions.length === 0) {
    // broadcast: all agents (excluding API type) receive and respond
    routingMode = 'broadcast'
    for (const member of agentMembers) {
      const agent = agentMap.get(member.memberId)
      if (agent && agent.connectionType !== 'api') targetAgents.push(agent)
    }
  } else if (room.broadcastMode && mentions.length > 0) {
    // mention_assign: all agents (excluding API type) receive, only mentioned respond
    routingMode = 'mention_assign'
    for (const member of agentMembers) {
      const agent = agentMap.get(member.memberId)
      if (agent && agent.connectionType !== 'api') targetAgents.push(agent)
    }
  } else if (!room.broadcastMode && mentions.length > 0) {
    // direct: only mentioned agents receive
    routingMode = 'direct'
    for (const agentId of mentionedAgentIds) {
      const agent = agentMap.get(agentId)
      if (agent) targetAgents.push(agent)
    }
  } else {
    // No mentions + no broadcast mode = don't send to agents
    return
  }

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
      isMentioned: mentionedAgentIds.has(agent.id),
    }
    connectionManager.sendToGateway(agent.id, sendMsg)
  }
}

function handleTyping(ws: WSContext, roomId: string) {
  const client = connectionManager.getClient(ws)
  if (!client || !client.joinedRooms.has(roomId)) return

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

function handleStopGeneration(ws: WSContext, roomId: string, agentId: string) {
  const client = connectionManager.getClient(ws)
  if (!client || !client.joinedRooms.has(roomId)) return

  const stopMsg: ServerStopAgent = {
    type: 'server:stop_agent',
    agentId,
  }
  connectionManager.sendToGateway(agentId, stopMsg)
}

export function handleClientDisconnect(ws: WSContext) {
  const client = connectionManager.getClient(ws)
  connectionManager.removeClient(ws)
  // Broadcast offline presence if this was the user's last connection
  if (client && !connectionManager.isUserOnline(client.userId)) {
    connectionManager.broadcastToAll({
      type: 'server:presence',
      userId: client.userId,
      username: client.username,
      online: false,
    })
  }
}
