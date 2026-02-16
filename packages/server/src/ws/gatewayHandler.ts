import type { WSContext } from 'hono/ws'
import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import { gatewayMessageSchema, parseMentions } from '@agentim/shared'
import type {
  ServerSendToAgent,
  ServerRoomContext,
  RoomContext,
  RoomContextMember,
} from '@agentim/shared'
import { connectionManager } from './connections.js'
import { verifyToken } from '../lib/jwt.js'
import { createLogger } from '../lib/logger.js'
import { db } from '../db/index.js'
import { agents, gateways, messages, tasks, roomMembers, rooms, users } from '../db/schema.js'
import { getRedis } from '../lib/redis.js'
import { config } from '../config.js'
import { buildAgentNameMap } from '../lib/agentUtils.js'

const log = createLogger('GatewayHandler')

const MAX_MESSAGE_SIZE = 256 * 1024 // 256 KB (gateway messages can be larger due to agent output)

async function isAgentRateLimited(agentId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const key = `ws:agent_rate:${agentId}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, config.agentRateLimitWindow)
    return count > config.agentRateLimitMax
  } catch {
    return false
  }
}

async function getAgentRoomIds(agentId: string): Promise<string[]> {
  const rows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(eq(roomMembers.memberId, agentId), eq(roomMembers.memberType, 'agent')))
  return rows.map((r) => r.roomId)
}

async function broadcastAgentStatus(agentId: string) {
  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      type: agents.type,
      status: agents.status,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)
  if (!agent) return

  const roomIds = await getAgentRoomIds(agentId)
  for (const roomId of roomIds) {
    connectionManager.broadcastToRoom(roomId, {
      type: 'server:agent_status',
      agent,
    })
  }
}

export async function handleGatewayMessage(ws: WSContext, raw: string) {
  if (raw.length > MAX_MESSAGE_SIZE) return

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    log.warn('Gateway sent invalid JSON, dropping message')
    return
  }

  const parsed = gatewayMessageSchema.safeParse(data)
  if (!parsed.success) {
    log.warn(`Gateway sent invalid message format: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
    return
  }

  const msg = parsed.data

  switch (msg.type) {
    case 'gateway:auth':
      return handleAuth(ws, msg)
    case 'gateway:register_agent':
      return handleRegisterAgent(ws, msg.agent)
    case 'gateway:unregister_agent':
      return handleUnregisterAgent(ws, msg.agentId)
    case 'gateway:message_chunk':
      return handleMessageChunk(ws, msg)
    case 'gateway:message_complete':
      return handleMessageComplete(ws, msg)
    case 'gateway:agent_status':
      return handleAgentStatus(ws, msg.agentId, msg.status)
    case 'gateway:terminal_data':
      return handleTerminalData(ws, msg)
    case 'gateway:task_update':
      return handleTaskUpdate(msg.taskId, msg.status, msg.result)
    case 'gateway:ping':
      ws.send(JSON.stringify({ type: 'server:pong', ts: msg.ts }))
      return
    default:
      log.warn(`Unknown gateway message type: ${(msg as { type: string }).type}`)
      return
  }
}

async function handleAuth(
  ws: WSContext,
  msg: { token: string; gatewayId: string; deviceInfo: Record<string, string> },
) {
  try {
    const payload = await verifyToken(msg.token)
    if (payload.type !== 'access') {
      ws.send(
        JSON.stringify({
          type: 'server:gateway_auth_result',
          ok: false,
          error: 'Invalid token type',
        }),
      )
      return
    }

    connectionManager.addGateway(ws, payload.sub, msg.gatewayId)

    // Upsert gateway in DB
    const now = new Date().toISOString()
    const [existing] = await db
      .select()
      .from(gateways)
      .where(eq(gateways.id, msg.gatewayId))
      .limit(1)
    if (existing) {
      await db
        .update(gateways)
        .set({
          userId: payload.sub,
          connectedAt: now,
          disconnectedAt: null,
          hostname: msg.deviceInfo.hostname,
          platform: msg.deviceInfo.platform,
          arch: msg.deviceInfo.arch,
          nodeVersion: msg.deviceInfo.nodeVersion,
        })
        .where(eq(gateways.id, msg.gatewayId))
    } else {
      await db.insert(gateways).values({
        id: msg.gatewayId,
        userId: payload.sub,
        name: msg.deviceInfo.hostname,
        hostname: msg.deviceInfo.hostname,
        platform: msg.deviceInfo.platform,
        arch: msg.deviceInfo.arch,
        nodeVersion: msg.deviceInfo.nodeVersion,
        connectedAt: now,
        createdAt: now,
      })
    }

    ws.send(JSON.stringify({ type: 'server:gateway_auth_result', ok: true }))
  } catch {
    ws.send(
      JSON.stringify({ type: 'server:gateway_auth_result', ok: false, error: 'Invalid token' }),
    )
  }
}

async function handleRegisterAgent(
  ws: WSContext,
  agent: {
    id: string
    name: string
    type: string
    workingDirectory?: string
    capabilities?: string[]
  },
) {
  const gw = connectionManager.getGateway(ws)
  if (!gw) return

  const now = new Date().toISOString()
  const capabilitiesJson = agent.capabilities ? JSON.stringify(agent.capabilities) : null

  // Mark any existing agents with same gateway + name as offline (orphan cleanup)
  await db
    .update(agents)
    .set({ status: 'offline', updatedAt: now })
    .where(
      and(
        eq(agents.gatewayId, gw.gatewayId),
        eq(agents.name, agent.name),
        eq(agents.status, 'online'),
      ),
    )

  // Upsert agent in DB
  const [existing] = await db.select().from(agents).where(eq(agents.id, agent.id)).limit(1)
  if (existing) {
    await db
      .update(agents)
      .set({
        name: agent.name,
        type: agent.type,
        status: 'online',
        workingDirectory: agent.workingDirectory,
        capabilities: capabilitiesJson,
        connectionType: 'cli',
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(agents.id, agent.id))
  } else {
    await db.insert(agents).values({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      status: 'online',
      gatewayId: gw.gatewayId,
      workingDirectory: agent.workingDirectory,
      capabilities: capabilitiesJson,
      connectionType: 'cli',
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
  }

  connectionManager.registerAgent(ws, agent.id)
  await broadcastAgentStatus(agent.id)

  // Send room context for all rooms this agent belongs to
  const roomIds = await getAgentRoomIds(agent.id)
  for (const roomId of roomIds) {
    await sendRoomContextToAgent(agent.id, roomId)
  }
}

async function handleUnregisterAgent(ws: WSContext, agentId: string) {
  const now = new Date().toISOString()
  await db.update(agents).set({ status: 'offline', updatedAt: now }).where(eq(agents.id, agentId))

  connectionManager.unregisterAgent(ws, agentId)
  await broadcastAgentStatus(agentId)
}

async function handleMessageChunk(
  ws: WSContext,
  msg: {
    roomId: string
    agentId: string
    messageId: string
    chunk: { type: string; content: string; metadata?: Record<string, unknown> }
  },
) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, msg.agentId)).limit(1)
  const agentName = agent?.name ?? 'Unknown Agent'

  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:message_chunk',
    roomId: msg.roomId,
    agentId: msg.agentId,
    agentName,
    messageId: msg.messageId,
    chunk: msg.chunk,
  })
}

async function handleMessageComplete(
  ws: WSContext,
  msg: {
    roomId: string
    agentId: string
    messageId: string
    fullContent: string
    chunks?: Array<{ type: string; content: string; metadata?: Record<string, unknown> }>
    conversationId?: string
    depth?: number
  },
) {
  // Agent rate limiting — save the message but skip routing if limited
  const rateLimited = await isAgentRateLimited(msg.agentId)
  if (rateLimited) {
    log.warn(`Agent ${msg.agentId} rate limited, message saved but not routed`)
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, msg.agentId)).limit(1)
  const agentName = agent?.name ?? 'Unknown Agent'
  const now = new Date().toISOString()

  // Persist agent's full message with structured chunks
  await db.insert(messages).values({
    id: msg.messageId,
    roomId: msg.roomId,
    senderId: msg.agentId,
    senderType: 'agent',
    senderName: agentName,
    type: 'agent_response',
    content: msg.fullContent,
    mentions: '[]',
    chunks: msg.chunks ? JSON.stringify(msg.chunks) : null,
    createdAt: now,
  })

  const message = {
    id: msg.messageId,
    roomId: msg.roomId,
    senderId: msg.agentId,
    senderType: 'agent' as const,
    senderName: agentName,
    type: 'agent_response' as const,
    content: msg.fullContent,
    mentions: [] as string[],
    chunks: msg.chunks,
    createdAt: now,
  }

  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:message_complete',
    message,
  })

  // Update agent status back to online
  await db
    .update(agents)
    .set({ status: 'online', lastSeenAt: now, updatedAt: now })
    .where(eq(agents.id, msg.agentId))

  await broadcastAgentStatus(msg.agentId)

  // Skip agent-to-agent routing if rate limited
  if (rateLimited) return

  // Agent-to-Agent routing: check if agent's message mentions other agents
  const mentionedNames = parseMentions(msg.fullContent)
  if (mentionedNames.length > 0) {
    const conversationId = msg.conversationId || nanoid()
    const depth = msg.depth ?? 0

    await routeAgentToAgent(
      msg.roomId,
      msg.agentId,
      agentName,
      msg.messageId,
      msg.fullContent,
      mentionedNames,
      conversationId,
      depth,
    )
  }
}

async function handleAgentStatus(ws: WSContext, agentId: string, status: string) {
  const now = new Date().toISOString()
  await db
    .update(agents)
    .set({ status, lastSeenAt: now, updatedAt: now })
    .where(eq(agents.id, agentId))

  await broadcastAgentStatus(agentId)
}

async function handleTerminalData(ws: WSContext, msg: { agentId: string; data: string }) {
  const [agent] = await db
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, msg.agentId))
    .limit(1)
  const agentName = agent?.name ?? 'Unknown Agent'

  const roomIds = await getAgentRoomIds(msg.agentId)
  for (const roomId of roomIds) {
    connectionManager.broadcastToRoom(roomId, {
      type: 'server:terminal_data',
      agentId: msg.agentId,
      agentName,
      roomId,
      data: msg.data,
    })
  }
}

async function handleTaskUpdate(taskId: string, status: string, result?: string) {
  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { status, updatedAt: now }
  if (result) updateData.description = result

  await db.update(tasks).set(updateData).where(eq(tasks.id, taskId))

  // Broadcast task update to room clients
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (task) {
    connectionManager.broadcastToRoom(task.roomId, {
      type: 'server:task_update',
      task,
    })
  }
}

export async function handleGatewayDisconnect(ws: WSContext) {
  const gw = connectionManager.getGateway(ws)
  if (gw) {
    const now = new Date().toISOString()

    // Mark all agents as offline and broadcast
    for (const agentId of gw.agentIds) {
      await db
        .update(agents)
        .set({ status: 'offline', updatedAt: now })
        .where(eq(agents.id, agentId))
      await broadcastAgentStatus(agentId)
    }

    // Mark gateway as disconnected
    await db.update(gateways).set({ disconnectedAt: now }).where(eq(gateways.id, gw.gatewayId))

    connectionManager.removeGateway(ws)
  }
}

// ─── Agent-to-Agent Routing ───

async function routeAgentToAgent(
  roomId: string,
  senderAgentId: string,
  senderName: string,
  messageId: string,
  fullContent: string,
  mentionedNames: string[],
  conversationId: string,
  depth: number,
) {
  // 1. Depth check
  if (depth >= config.maxAgentChainDepth) {
    log.warn(
      `Chain depth ${depth} exceeds max ${config.maxAgentChainDepth} for conversation ${conversationId}, stopping`,
    )
    return
  }

  // Get agent members in this room
  const agentMembers = await db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberType, 'agent')))

  if (agentMembers.length === 0) return

  const agentIds = agentMembers.map((m) => m.memberId)
  const agentRows = await db.select().from(agents).where(inArray(agents.id, agentIds))

  const agentNameMap = buildAgentNameMap(agentRows)

  // 2. Redis visited set for loop detection
  const redis = getRedis()
  const visitedKey = `conv:${conversationId}:visited`

  // Add sender to visited set
  try {
    await redis.sadd(visitedKey, senderAgentId)
    await redis.expire(visitedKey, 300) // 5 minute TTL
  } catch {
    // If Redis fails, continue without visited tracking
  }

  // Resolve mentioned agents, excluding the sender
  for (const name of mentionedNames) {
    const agent = agentNameMap.get(name)
    // 3. Self-reference check
    if (!agent || agent.id === senderAgentId) continue
    if (!agentMembers.some((m) => m.memberId === agent.id)) continue

    // Check visited set — prevent A→B→A loops
    try {
      const visited = await redis.sismember(visitedKey, agent.id)
      if (visited) {
        log.warn(`Agent ${agent.id} already visited in conversation ${conversationId}, skipping`)
        continue
      }
    } catch {
      // If Redis fails, allow the message through (depth check still applies)
    }

    const sendMsg: ServerSendToAgent = {
      type: 'server:send_to_agent',
      agentId: agent.id,
      roomId,
      messageId,
      content: fullContent,
      senderName,
      senderType: 'agent',
      routingMode: 'direct',
      conversationId,
      depth: depth + 1,
    }
    connectionManager.sendToGateway(agent.id, sendMsg)
  }
}

// ─── Room Context ───

export async function sendRoomContextToAgent(agentId: string, roomId: string) {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) return

  const memberRows = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId))
  if (memberRows.length === 0) return

  // Batch-fetch agents and users to avoid N+1 queries
  const agentMemberIds = memberRows.filter((m) => m.memberType === 'agent').map((m) => m.memberId)
  const userMemberIds = memberRows.filter((m) => m.memberType === 'user').map((m) => m.memberId)

  const agentMap = new Map<string, (typeof agentRows)[number]>()
  const agentRows =
    agentMemberIds.length > 0
      ? await db.select().from(agents).where(inArray(agents.id, agentMemberIds))
      : []
  for (const a of agentRows) agentMap.set(a.id, a)

  const userMap = new Map<string, (typeof userRows)[number]>()
  const userRows =
    userMemberIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, userMemberIds))
      : []
  for (const u of userRows) userMap.set(u.id, u)

  const memberList: RoomContextMember[] = []
  for (const member of memberRows) {
    if (member.memberType === 'agent') {
      const agent = agentMap.get(member.memberId)
      if (agent) {
        let capabilities: string[] | undefined
        if (agent.capabilities) {
          try {
            capabilities = JSON.parse(agent.capabilities)
          } catch {
            /* ignore */
          }
        }
        memberList.push({
          id: agent.id,
          name: agent.name,
          type: 'agent',
          agentType: agent.type as RoomContextMember['agentType'],
          capabilities,
          roleDescription: member.roleDescription ?? undefined,
          status: agent.status as RoomContextMember['status'],
        })
      }
    } else {
      const user = userMap.get(member.memberId)
      if (user) {
        memberList.push({
          id: user.id,
          name: user.displayName,
          type: 'user',
          roleDescription: member.roleDescription ?? undefined,
        })
      }
    }
  }

  const context: RoomContext = {
    roomId,
    roomName: room.name,
    systemPrompt: room.systemPrompt ?? undefined,
    members: memberList,
  }

  const msg: ServerRoomContext = {
    type: 'server:room_context',
    agentId,
    context,
  }

  connectionManager.sendToGateway(agentId, msg)
}

export async function sendRoomContextToAllAgents(roomId: string) {
  const agentMembers = await db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberType, 'agent')))

  for (const member of agentMembers) {
    await sendRoomContextToAgent(member.memberId, roomId)
  }
}
