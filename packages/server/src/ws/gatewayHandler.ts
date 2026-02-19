import type { WSContext } from 'hono/ws'
import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import { gatewayMessageSchema, parseMentions, TASK_STATUSES } from '@agentim/shared'
import type {
  ServerSendToAgent,
  ServerRoomContext,
  RoomContext,
  RoomContextMember,
} from '@agentim/shared'
import { connectionManager } from './connections.js'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked } from '../lib/tokenRevocation.js'
import { createLogger } from '../lib/logger.js'
import { captureException } from '../lib/sentry.js'
import { db } from '../db/index.js'
import { agents, gateways, messages, tasks, roomMembers, rooms, users } from '../db/schema.js'
import { getRedis } from '../lib/redis.js'
import { config } from '../config.js'
import { getRouterConfig, type RouterConfig } from '../lib/routerConfig.js'
import { buildAgentNameMap } from '../lib/agentUtils.js'

const log = createLogger('GatewayHandler')

const MAX_MESSAGE_SIZE = config.maxGatewayMessageSize
const MAX_JSON_DEPTH = 15 // gateway messages may have deeper nesting (chunks with metadata)

/** Parse JSON with a nesting depth limit to prevent DoS via deeply nested payloads. */
function safeJsonParse(raw: string, maxDepth: number): unknown {
  const result = JSON.parse(raw)
  checkDepth(result, maxDepth, 0)
  return result
}

function checkDepth(value: unknown, maxDepth: number, current: number): void {
  if (current > maxDepth) {
    throw new Error('JSON nesting depth exceeded')
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      checkDepth(item, maxDepth, current + 1)
    }
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      checkDepth((value as Record<string, unknown>)[key], maxDepth, current + 1)
    }
  }
}

async function isAgentRateLimited(
  agentId: string,
  rateLimitWindow?: number,
  rateLimitMax?: number,
): Promise<boolean> {
  try {
    const redis = getRedis()
    const key = `ws:agent_rate:${agentId}`
    const count = await redis.incr(key)
    // Only set EXPIRE on first increment to use fixed time buckets
    if (count === 1) {
      await redis.expire(key, rateLimitWindow ?? config.agentRateLimitWindow)
    }
    return count > (rateLimitMax ?? config.agentRateLimitMax)
  } catch {
    log.warn('Redis unavailable for agent rate limiting, rejecting request (fail-closed)')
    return true
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
  if (raw.length > MAX_MESSAGE_SIZE) {
    log.warn(`Gateway sent oversized message (${raw.length} bytes), dropping`)
    return
  }

  let data: unknown
  try {
    data = safeJsonParse(raw, MAX_JSON_DEPTH)
  } catch (err) {
    const isDepth = (err as Error).message?.includes('depth')
    log.warn(`Gateway sent ${isDepth ? 'too deeply nested' : 'invalid'} JSON, dropping message`)
    return
  }

  const parsed = gatewayMessageSchema.safeParse(data)
  if (!parsed.success) {
    log.warn(`Gateway sent invalid message format: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
    return
  }

  const msg = parsed.data

  // All messages except auth and ping require authentication
  if (msg.type !== 'gateway:auth' && msg.type !== 'gateway:ping') {
    const gw = connectionManager.getGateway(ws)
    if (!gw) {
      log.warn('Unauthenticated gateway attempted to send message')
      return
    }
  }

  try {
    switch (msg.type) {
      case 'gateway:auth':
        return await handleAuth(ws, msg)
      case 'gateway:register_agent':
        return await handleRegisterAgent(ws, msg.agent)
      case 'gateway:unregister_agent':
        return await handleUnregisterAgent(ws, msg.agentId)
      case 'gateway:message_chunk':
        return await handleMessageChunk(ws, msg)
      case 'gateway:message_complete':
        return await handleMessageComplete(ws, msg)
      case 'gateway:agent_status':
        return await handleAgentStatus(ws, msg.agentId, msg.status)
      case 'gateway:terminal_data':
        return await handleTerminalData(ws, msg)
      case 'gateway:task_update':
        return await handleTaskUpdate(ws, msg.taskId, msg.status, msg.result)
      case 'gateway:ping':
        ws.send(JSON.stringify({ type: 'server:pong', ts: msg.ts }))
        return
      default:
        log.warn(`Unknown gateway message type: ${(msg as { type: string }).type}`)
        return
    }
  } catch (err) {
    log.error(`Error handling gateway message ${msg.type}: ${(err as Error).message}${(err as Error).stack ? `\n${(err as Error).stack}` : ''}`)
    captureException(err)
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
    // Check if the token was revoked (logout / password change)
    if (payload.iat && (await isTokenRevoked(payload.sub, payload.iat * 1000))) {
      ws.send(
        JSON.stringify({
          type: 'server:gateway_auth_result',
          ok: false,
          error: 'Token revoked',
        }),
      )
      return
    }

    // Fetch per-user gateway limit override
    const [gwUser] = await db
      .select({ maxGateways: users.maxGateways })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1)

    const result = connectionManager.addGateway(ws, payload.sub, msg.gatewayId, gwUser?.maxGateways)
    if (!result.ok) {
      ws.send(
        JSON.stringify({
          type: 'server:gateway_auth_result',
          ok: false,
          error: result.error ?? 'Gateway connection limit exceeded',
        }),
      )
      return
    }

    // Atomic upsert gateway — eliminates TOCTOU race
    // Only allow the same user to reclaim their own gateway (prevents ID hijacking)
    const now = new Date().toISOString()
    const [upserted] = await db
      .insert(gateways)
      .values({
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
      .onConflictDoUpdate({
        target: gateways.id,
        set: {
          connectedAt: now,
          disconnectedAt: null,
          hostname: msg.deviceInfo.hostname,
          platform: msg.deviceInfo.platform,
          arch: msg.deviceInfo.arch,
          nodeVersion: msg.deviceInfo.nodeVersion,
        },
        // Only update if the gateway belongs to this user
        where: eq(gateways.userId, payload.sub),
      })
      .returning({ id: gateways.id })

    if (!upserted) {
      // Gateway ID exists but belongs to a different user
      connectionManager.removeGateway(ws)
      ws.send(
        JSON.stringify({
          type: 'server:gateway_auth_result',
          ok: false,
          error: 'Gateway ID belongs to another user',
        }),
      )
      return
    }

    ws.send(JSON.stringify({ type: 'server:gateway_auth_result', ok: true }))
  } catch (err) {
    // Roll back in-memory gateway registration to avoid phantom authenticated sockets
    connectionManager.removeGateway(ws)
    log.error(`Gateway auth failed: ${(err as Error).message}`)
    ws.send(
      JSON.stringify({ type: 'server:gateway_auth_result', ok: false, error: 'Authentication failed' }),
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

  // Reject re-registration of agents deleted while this gateway was offline
  if (connectionManager.isAgentDeleted(agent.id)) {
    connectionManager.clearAgentDeleted(agent.id)
    log.info(`Rejecting re-registration of deleted agent ${agent.id}, notifying gateway`)
    ws.send(JSON.stringify({ type: 'server:remove_agent', agentId: agent.id }))
    return
  }

  const now = new Date().toISOString()
  const capabilitiesJson = agent.capabilities ? JSON.stringify(agent.capabilities) : null

  // Reject if agent ID already exists and belongs to a different user's gateway
  const [existingAgent] = await db
    .select({ gatewayId: agents.gatewayId })
    .from(agents)
    .where(eq(agents.id, agent.id))
    .limit(1)
  if (existingAgent && existingAgent.gatewayId) {
    const [existingGw] = await db
      .select({ userId: gateways.userId })
      .from(gateways)
      .where(eq(gateways.id, existingAgent.gatewayId))
      .limit(1)
    if (existingGw && existingGw.userId !== gw.userId) {
      log.warn(`Gateway ${gw.gatewayId} attempted to register agent ${agent.id} owned by another user`)
      return
    }
  }

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

  // Atomic upsert — eliminates TOCTOU race between SELECT and INSERT
  await db
    .insert(agents)
    .values({
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
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: agent.name,
        type: agent.type,
        status: 'online',
        workingDirectory: agent.workingDirectory,
        capabilities: capabilitiesJson,
        connectionType: 'cli',
        lastSeenAt: now,
        updatedAt: now,
      },
    })

  connectionManager.registerAgent(ws, agent.id)
  await broadcastAgentStatus(agent.id)

  // Send room context for all rooms this agent belongs to
  const roomIds = await getAgentRoomIds(agent.id)
  for (const roomId of roomIds) {
    await sendRoomContextToAgent(agent.id, roomId)
  }
}

async function handleUnregisterAgent(ws: WSContext, agentId: string) {
  const gw = connectionManager.getGateway(ws)
  if (!gw || !gw.agentIds.has(agentId)) {
    log.warn(`Gateway attempted to unregister agent ${agentId} it does not own`)
    return
  }

  const now = new Date().toISOString()
  await db.update(agents).set({ status: 'offline', updatedAt: now }).where(eq(agents.id, agentId))

  connectionManager.unregisterAgent(ws, agentId)
  await broadcastAgentStatus(agentId)
}

const MAX_CHUNK_SIZE = 1024 * 1024 // 1 MB per chunk
const MAX_FULL_CONTENT_SIZE = 10 * 1024 * 1024 // 10 MB per complete message

async function handleMessageChunk(
  ws: WSContext,
  msg: {
    roomId: string
    agentId: string
    messageId: string
    chunk: { type: string; content: string; metadata?: Record<string, unknown> }
  },
) {
  // Verify the agent belongs to this gateway
  const gw = connectionManager.getGateway(ws)
  if (!gw || !gw.agentIds.has(msg.agentId)) {
    log.warn(`Gateway attempted to send chunk for unowned agent ${msg.agentId}`)
    return
  }

  // Verify agent is a member of this room (prevents cross-room injection)
  const [chunkMembership] = await db
    .select({ memberId: roomMembers.memberId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, msg.roomId), eq(roomMembers.memberId, msg.agentId), eq(roomMembers.memberType, 'agent')))
    .limit(1)
  if (!chunkMembership) {
    log.warn(`Agent ${msg.agentId} is not a member of room ${msg.roomId}, dropping chunk`)
    return
  }

  // Validate chunk size to prevent memory abuse
  if (msg.chunk.content.length > MAX_CHUNK_SIZE) {
    log.warn(`Agent ${msg.agentId} sent oversized chunk (${msg.chunk.content.length} bytes), dropping`)
    return
  }

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
  // Verify the agent belongs to this gateway
  const gw = connectionManager.getGateway(ws)
  if (!gw || !gw.agentIds.has(msg.agentId)) {
    log.warn(`Gateway attempted to complete message for unowned agent ${msg.agentId}`)
    return
  }

  // Reject oversized messages to prevent OOM
  if (msg.fullContent.length > MAX_FULL_CONTENT_SIZE) {
    log.warn(`Agent ${msg.agentId} sent oversized message (${msg.fullContent.length} bytes), dropping`)
    return
  }

  // Verify agent is a member of this room (prevents cross-room injection)
  const [completeMembership] = await db
    .select({ memberId: roomMembers.memberId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, msg.roomId), eq(roomMembers.memberId, msg.agentId), eq(roomMembers.memberType, 'agent')))
    .limit(1)
  if (!completeMembership) {
    log.warn(`Agent ${msg.agentId} is not a member of room ${msg.roomId}, dropping message`)
    return
  }

  // Agent rate limiting — save the message but skip routing if limited
  const msgRouterCfg = await getRouterConfig(msg.roomId)
  const rateLimited = await isAgentRateLimited(
    msg.agentId,
    msgRouterCfg?.rateLimitWindow,
    msgRouterCfg?.rateLimitMax,
  )
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
      msgRouterCfg,
    )
  }
}

async function handleAgentStatus(ws: WSContext, agentId: string, status: string) {
  // Verify the agent belongs to this gateway
  const gw = connectionManager.getGateway(ws)
  if (!gw || !gw.agentIds.has(agentId)) {
    log.warn(`Gateway attempted to update status for unregistered agent ${agentId}`)
    return
  }

  const now = new Date().toISOString()
  await db
    .update(agents)
    .set({ status, lastSeenAt: now, updatedAt: now })
    .where(eq(agents.id, agentId))

  await broadcastAgentStatus(agentId)
}

async function handleTerminalData(ws: WSContext, msg: { agentId: string; data: string }) {
  // Verify the agent belongs to this gateway
  const gw = connectionManager.getGateway(ws)
  if (!gw || !gw.agentIds.has(msg.agentId)) {
    log.warn(`Gateway attempted to send terminal data for unowned agent ${msg.agentId}`)
    return
  }

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

async function handleTaskUpdate(ws: WSContext, taskId: string, status: string, result?: string) {
  const gw = connectionManager.getGateway(ws)
  if (!gw || gw.agentIds.size === 0) {
    log.warn('Gateway with no registered agents attempted to update task')
    return
  }

  // Validate status is a known value before writing to DB
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    log.warn(`Invalid task status "${status}" for task ${taskId}, ignoring`)
    return
  }

  // Verify the task belongs to a room where one of the gateway's agents is a member
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) {
    log.warn(`Task ${taskId} not found, ignoring update`)
    return
  }

  const gwAgentIds = [...gw.agentIds]
  const memberCheck = await db
    .select({ memberId: roomMembers.memberId })
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, task.roomId),
        eq(roomMembers.memberType, 'agent'),
        inArray(roomMembers.memberId, gwAgentIds),
      ),
    )
    .limit(1)
  if (memberCheck.length === 0) {
    log.warn(`Gateway ${gw.gatewayId} has no agents in room ${task.roomId}, rejecting task update`)
    return
  }

  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { status, updatedAt: now }
  if (result) updateData.description = result

  await db.update(tasks).set(updateData).where(eq(tasks.id, taskId))

  connectionManager.broadcastToRoom(task.roomId, {
    type: 'server:task_update',
    task: { ...task, ...updateData },
  })
}

export async function handleGatewayDisconnect(ws: WSContext) {
  const gw = connectionManager.getGateway(ws)
  if (gw) {
    const now = new Date().toISOString()

    // Mark all agents as offline and broadcast
    for (const agentId of gw.agentIds) {
      try {
        await db
          .update(agents)
          .set({ status: 'offline', updatedAt: now })
          .where(eq(agents.id, agentId))
        await broadcastAgentStatus(agentId)
      } catch (err) {
        log.error(`Failed to mark agent ${agentId} offline: ${(err as Error).message}`)
      }
    }

    // Mark gateway as disconnected
    try {
      await db.update(gateways).set({ disconnectedAt: now }).where(eq(gateways.id, gw.gatewayId))
    } catch (err) {
      log.error(`Failed to mark gateway ${gw.gatewayId} disconnected: ${(err as Error).message}`)
    }

    connectionManager.removeGateway(ws)
  }
}

// ─── Agent-to-Agent Routing ───

// In-memory fallback for loop detection when Redis is unavailable.
// Key = visitedKey, Value = { agents: Set<string>, expiresAt: number }
const visitedFallback = new Map<string, { agents: Set<string>; expiresAt: number }>()
const MAX_FALLBACK_ENTRIES = 10_000 // prevent unbounded memory growth

function fallbackSadd(key: string, value: string, ttlSeconds: number) {
  // Enforce size limit — evict oldest entries when full
  if (visitedFallback.size >= MAX_FALLBACK_ENTRIES && !visitedFallback.has(key)) {
    const oldestKey = visitedFallback.keys().next().value
    if (oldestKey) visitedFallback.delete(oldestKey)
    log.warn(`Visited set fallback reached ${MAX_FALLBACK_ENTRIES} entries, evicting oldest`)
  }

  let entry = visitedFallback.get(key)
  if (!entry || Date.now() > entry.expiresAt) {
    entry = { agents: new Set(), expiresAt: Date.now() + ttlSeconds * 1000 }
    visitedFallback.set(key, entry)
  } else {
    // Refresh TTL on each insert, matching Redis EXPIRE behavior
    entry.expiresAt = Date.now() + ttlSeconds * 1000
  }
  entry.agents.add(value)
}

function fallbackSismember(key: string, value: string): boolean {
  const entry = visitedFallback.get(key)
  if (!entry || Date.now() > entry.expiresAt) {
    visitedFallback.delete(key)
    return false
  }
  return entry.agents.has(value)
}

// Periodically evict expired entries to prevent unbounded growth
setInterval(() => {
  const now = Date.now()
  let evicted = 0
  for (const [key, entry] of visitedFallback) {
    if (now > entry.expiresAt) {
      visitedFallback.delete(key)
      evicted++
    }
  }
  if (evicted > 0) {
    log.debug(`Evicted ${evicted} expired visited-set entries (remaining: ${visitedFallback.size})`)
  }
}, 60_000).unref()

async function routeAgentToAgent(
  roomId: string,
  senderAgentId: string,
  senderName: string,
  messageId: string,
  fullContent: string,
  mentionedNames: string[],
  conversationId: string,
  depth: number,
  routerCfg?: RouterConfig | null,
) {
  // 1. Depth check — use room router config with env var fallback
  const maxDepth = routerCfg?.maxChainDepth ?? config.maxAgentChainDepth

  if (depth >= maxDepth) {
    log.warn(
      `Chain depth ${depth} exceeds max ${maxDepth} for conversation ${conversationId}, stopping`,
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

  // 2. Redis visited set for loop detection (with in-memory fallback)
  const visitedKey = `conv:${conversationId}:visited`
  const VISITED_TTL = 300 // 5 minutes
  let useRedis = true

  // Add sender to visited set
  try {
    const redis = getRedis()
    await redis.sadd(visitedKey, senderAgentId)
    await redis.expire(visitedKey, VISITED_TTL)
  } catch {
    useRedis = false
    fallbackSadd(visitedKey, senderAgentId, VISITED_TTL)
  }

  // Resolve mentioned agents, excluding the sender
  for (const name of mentionedNames) {
    const agent = agentNameMap.get(name)
    // 3. Self-reference check
    if (!agent || agent.id === senderAgentId) continue
    if (!agentMembers.some((m) => m.memberId === agent.id)) continue

    // Check visited set — prevent A→B→A loops
    try {
      let visited: boolean
      if (useRedis) {
        const redis = getRedis()
        visited = !!(await redis.sismember(visitedKey, agent.id))
      } else {
        visited = fallbackSismember(visitedKey, agent.id)
      }
      if (visited) {
        log.warn(`Agent ${agent.id} already visited in conversation ${conversationId}, skipping`)
        continue
      }
    } catch (err) {
      // If both Redis and fallback fail, block the message (fail-closed) to prevent
      // infinite loops. The depth check alone may not catch A→B→A within limits.
      log.error(
        `Loop detection failed for agent ${agent.id} in conversation ${conversationId}: ${(err as Error).message}. Blocking to prevent potential loop.`,
      )
      continue
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

export async function broadcastRoomUpdate(roomId: string) {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) return
  const memberRows = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId))
  connectionManager.broadcastToRoom(roomId, {
    type: 'server:room_update',
    room,
    members: memberRows,
  })
}

export async function sendRoomContextToAllAgents(roomId: string) {
  const agentMembers = await db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberType, 'agent')))

  await Promise.allSettled(
    agentMembers.map((member) => sendRoomContextToAgent(member.memberId, roomId)),
  )
}
