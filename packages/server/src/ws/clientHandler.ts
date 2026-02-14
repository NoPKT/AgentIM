import type { WSContext } from 'hono/ws'
import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import { clientMessageSchema } from '@agentim/shared'
import type { ServerSendToAgent, ServerStopAgent } from '@agentim/shared'
import { connectionManager } from './connections.js'
import { verifyToken } from '../lib/jwt.js'
import { db } from '../db/index.js'
import { messages, rooms, roomMembers, agents } from '../db/schema.js'
import { sanitizeContent } from '../lib/sanitize.js'

const MAX_MESSAGE_SIZE = 64 * 1024 // 64 KB

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

  switch (msg.type) {
    case 'client:auth':
      return handleAuth(ws, msg.token)
    case 'client:join_room':
      return handleJoinRoom(ws, msg.roomId)
    case 'client:leave_room':
      return handleLeaveRoom(ws, msg.roomId)
    case 'client:send_message':
      return handleSendMessage(ws, msg.roomId, msg.content, msg.mentions, msg.replyToId)
    case 'client:typing':
      return handleTyping(ws, msg.roomId)
    case 'client:stop_generation':
      return handleStopGeneration(ws, msg.roomId, msg.agentId)
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
    connectionManager.addClient(ws, payload.sub, payload.username)
    connectionManager.sendToClient(ws, {
      type: 'server:auth_result',
      ok: true,
      userId: payload.sub,
    })
  } catch {
    connectionManager.sendToClient(ws, {
      type: 'server:auth_result',
      ok: false,
      error: 'Invalid token',
    })
  }
}

function handleJoinRoom(ws: WSContext, roomId: string) {
  const client = connectionManager.getClient(ws)
  if (!client) return
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
) {
  const client = connectionManager.getClient(ws)
  if (!client) return

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
    createdAt: now,
  }

  // Broadcast to all clients in the room
  connectionManager.broadcastToRoom(roomId, {
    type: 'server:new_message',
    message,
  })

  // Route to agents based on mentions and broadcast mode
  await routeToAgents(roomId, message, mentions)
}

async function routeToAgents(
  roomId: string,
  message: { id: string; content: string; senderName: string },
  mentions: string[],
) {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) return

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

  let targetAgents: typeof agentRows = []

  if (mentions.length > 0) {
    // Direct @mention → send to mentioned agents only
    for (const mention of mentions) {
      const agent = agentNameMap.get(mention)
      if (agent && agentMembers.some((m) => m.memberId === agent.id)) {
        targetAgents.push(agent)
      }
    }
  } else if (room.broadcastMode) {
    // Broadcast mode: send to all agents in room
    for (const member of agentMembers) {
      const agent = agentMap.get(member.memberId)
      if (agent) targetAgents.push(agent)
    }
  }
  // No mentions + no broadcast mode = don't send to agents

  for (const agent of targetAgents) {
    const sendMsg: ServerSendToAgent = {
      type: 'server:send_to_agent',
      agentId: agent.id,
      roomId,
      messageId: message.id,
      content: message.content,
      senderName: message.senderName,
    }
    connectionManager.sendToGateway(agent.id, sendMsg)
  }
}

function handleTyping(ws: WSContext, roomId: string) {
  const client = connectionManager.getClient(ws)
  if (!client) return

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
  const stopMsg: ServerStopAgent = {
    type: 'server:stop_agent',
    agentId,
  }
  connectionManager.sendToGateway(agentId, stopMsg)
}

export function handleClientDisconnect(ws: WSContext) {
  connectionManager.removeClient(ws)
}
