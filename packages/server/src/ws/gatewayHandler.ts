import type { WSContext } from 'hono/ws'
import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import {
  gatewayMessageSchema,
  parseMentions,
  TASK_STATUSES,
  CURRENT_PROTOCOL_VERSION,
  PERMISSION_TIMEOUT_MS,
  MAX_FULL_CONTENT_SIZE,
  MAX_JSON_DEPTH,
  MAX_STREAM_TOTAL_SIZE,
} from '@agentim/shared'
import type {
  ServerSendToAgent,
  ServerRoomContext,
  RoomContext,
  RoomContextMember,
} from '@agentim/shared'
import { addPendingPermission, clearPendingPermission } from '../lib/permission-store.js'
import { incCounter } from '../lib/metrics.js'
import { connectionManager } from './connections.js'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked } from '../lib/tokenRevocation.js'
import { createLogger } from '../lib/logger.js'
import { captureException } from '../lib/sentry.js'
import { db } from '../db/index.js'
import { agents, gateways, messages, tasks, roomMembers, rooms, users } from '../db/schema.js'
import { getRedis, isRedisEnabled } from '../lib/redis.js'
import { config, getConfigSync } from '../config.js'
import { isAgentRateLimited } from './agentRateLimit.js'
import { getRouterConfig, type RouterConfig } from '../lib/routerConfig.js'
import { buildAgentNameMap } from '../lib/agentUtils.js'
import { isWebPushEnabled, sendPushToUser } from '../lib/webPush.js'

const log = createLogger('GatewayHandler')

const MAX_CHUNK_SIZE = 1024 * 1024 // 1 MB per chunk

/** Track cumulative size of streaming messages. Key = messageId, Value = { bytes, lastSeen } */
const streamSizeTracker = new Map<string, { bytes: number; lastSeen: number }>()
const MAX_STREAM_TRACKER_SIZE = 10_000
/** Entries not updated within this window are eligible for eviction. */
const STREAM_TRACKER_STALE_MS = 5 * 60_000 // 5 minutes

// Clean up stale stream size tracker entries every 60 seconds.
// NOTE: Two-layer cleanup ensures no leak — (1) periodic eviction here for
// stale/overflow entries, and (2) immediate deletion in handleMessageComplete()
// when a stream finishes. Do NOT remove either layer.
let streamTrackerTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now()
  // Prefer evicting stale entries first
  if (streamSizeTracker.size > MAX_STREAM_TRACKER_SIZE * 0.8) {
    const staleThreshold = now - STREAM_TRACKER_STALE_MS
    let removed = 0
    for (const [key, entry] of streamSizeTracker) {
      if (entry.lastSeen < staleThreshold) {
        streamSizeTracker.delete(key)
        removed++
      }
    }
    // If stale eviction wasn't enough, fall back to oldest-first
    if (streamSizeTracker.size > MAX_STREAM_TRACKER_SIZE * 0.8) {
      const entriesToRemove = streamSizeTracker.size - Math.floor(MAX_STREAM_TRACKER_SIZE * 0.5)
      let extraRemoved = 0
      for (const key of streamSizeTracker.keys()) {
        if (extraRemoved >= entriesToRemove) break
        streamSizeTracker.delete(key)
        extraRemoved++
      }
      removed += extraRemoved
    }
    if (removed > 0) log.debug(`Evicted ${removed} stream size tracker entries`)
  }
}, 60_000)
streamTrackerTimer.unref()

/** Stop the periodic stream size tracker cleanup. */
export function stopStreamTrackerCleanup() {
  if (streamTrackerTimer) {
    clearInterval(streamTrackerTimer)
    streamTrackerTimer = null
  }
}

import { safeJsonParse } from '../lib/json.js'

// Re-export stopAgentRateCleanup for backwards compatibility with index.ts shutdown
export { stopAgentRateCleanup } from './agentRateLimit.js'

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
  // Use the higher full-content limit + overhead for pre-parse size check.
  // Type-specific limits (MAX_CHUNK_SIZE, MAX_FULL_CONTENT_SIZE) are enforced
  // after parsing. The pre-parse guard only prevents OOM from absurdly large frames.
  const PRE_PARSE_LIMIT = MAX_FULL_CONTENT_SIZE + 1024 * 1024 // 10 MB content + 1 MB overhead
  if (raw.length > PRE_PARSE_LIMIT) {
    log.warn(`Gateway sent oversized message (${raw.length} bytes), dropping`)
    try {
      ws.send(
        JSON.stringify({
          type: 'server:error',
          message: `Message too large (${raw.length} bytes exceeds ${PRE_PARSE_LIMIT} byte limit)`,
        }),
      )
    } catch {
      // Ignore send errors — connection may already be closing
    }
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

  incCounter('agentim_ws_messages_total', { direction: 'in' })

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
      log.warn('Unauthenticated gateway attempted to send message, closing connection')
      try {
        ws.close(1008, 'Not authenticated')
      } catch {
        /* already closed */
      }
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
        return await handleAgentStatus(ws, msg.agentId, msg.status, msg.queueDepth)
      case 'gateway:terminal_data':
        return await handleTerminalData(ws, msg)
      case 'gateway:task_update':
        return await handleTaskUpdate(ws, msg.taskId, msg.status, msg.result)
      case 'gateway:permission_request':
        return await handlePermissionRequest(ws, msg)
      case 'gateway:ping':
        ws.send(JSON.stringify({ type: 'server:pong', ts: msg.ts }))
        return
      default:
        log.warn(`Unknown gateway message type: ${(msg as { type: string }).type}`)
        return
    }
  } catch (err) {
    log.error(
      `Error handling gateway message ${msg.type}: ${(err as Error).message}${(err as Error).stack ? `\n${(err as Error).stack}` : ''}`,
    )
    captureException(err)
  }
}

async function handleAuth(
  ws: WSContext,
  msg: {
    token: string
    gatewayId: string
    protocolVersion?: string
    deviceInfo: Record<string, string>
  },
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

    if (msg.protocolVersion && msg.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
      log.warn('Gateway protocol version mismatch', {
        gatewayVersion: msg.protocolVersion,
        serverVersion: CURRENT_PROTOCOL_VERSION,
        gatewayId: msg.gatewayId,
      })
    }
    ws.send(JSON.stringify({ type: 'server:gateway_auth_result', ok: true }))
  } catch (err) {
    // Roll back in-memory gateway registration to avoid phantom authenticated sockets
    connectionManager.removeGateway(ws)
    log.error(`Gateway auth failed: ${(err as Error).message}`)
    ws.send(
      JSON.stringify({
        type: 'server:gateway_auth_result',
        ok: false,
        error: 'Authentication failed',
      }),
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
  const capabilitiesValue = agent.capabilities ?? null

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
      log.warn(
        `Gateway ${gw.gatewayId} attempted to register agent ${agent.id} owned by another user`,
      )
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
      capabilities: capabilitiesValue,
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
        capabilities: capabilitiesValue,
        connectionType: 'cli',
        lastSeenAt: now,
        updatedAt: now,
      },
    })

  const registered = connectionManager.registerAgent(ws, agent.id)
  if (!registered) {
    // Gateway was disconnected between auth and register — revert agent status
    const now2 = new Date().toISOString()
    await db
      .update(agents)
      .set({ status: 'offline', updatedAt: now2 })
      .where(eq(agents.id, agent.id))
    log.warn(`Failed to register agent ${agent.id}: gateway no longer connected`)
    return
  }
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
    .where(
      and(
        eq(roomMembers.roomId, msg.roomId),
        eq(roomMembers.memberId, msg.agentId),
        eq(roomMembers.memberType, 'agent'),
      ),
    )
    .limit(1)
  if (!chunkMembership) {
    log.warn(`Agent ${msg.agentId} is not a member of room ${msg.roomId}, dropping chunk`)
    return
  }

  // Validate chunk size to prevent memory abuse
  if (msg.chunk.content.length > MAX_CHUNK_SIZE) {
    log.warn(
      `Agent ${msg.agentId} sent oversized chunk (${msg.chunk.content.length} bytes), dropping`,
    )
    connectionManager.sendToGateway(msg.agentId, {
      type: 'server:error' as const,
      code: 'CHUNK_TOO_LARGE',
      message: `Chunk exceeds maximum size (${MAX_CHUNK_SIZE} bytes)`,
    })
    return
  }

  // Track cumulative stream size
  const now = Date.now()
  const currentEntry = streamSizeTracker.get(msg.messageId)
  const currentTotal = currentEntry?.bytes ?? 0
  const newTotal = currentTotal + msg.chunk.content.length
  if (newTotal > MAX_STREAM_TOTAL_SIZE) {
    log.warn(
      `Agent ${msg.agentId} exceeded stream total size limit (${newTotal} bytes) for message ${msg.messageId}`,
    )
    streamSizeTracker.delete(msg.messageId)
    connectionManager.sendToGateway(msg.agentId, {
      type: 'server:error' as const,
      code: 'STREAM_TOO_LARGE',
      message: `Stream total size exceeds maximum (${MAX_STREAM_TOTAL_SIZE} bytes)`,
    })
    return
  }
  // Enforce tracker capacity
  if (streamSizeTracker.size >= MAX_STREAM_TRACKER_SIZE && !streamSizeTracker.has(msg.messageId)) {
    const oldestKey = streamSizeTracker.keys().next().value
    if (oldestKey) streamSizeTracker.delete(oldestKey)
  }
  streamSizeTracker.set(msg.messageId, { bytes: newTotal, lastSeen: now })

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
    log.warn(
      `Agent ${msg.agentId} sent oversized message (${msg.fullContent.length} bytes), dropping`,
    )
    connectionManager.sendToGateway(msg.agentId, {
      type: 'server:error' as const,
      code: 'MESSAGE_TOO_LARGE',
      message: `Message exceeds maximum size (${MAX_FULL_CONTENT_SIZE} bytes)`,
    })
    return
  }

  // Verify agent is a member of this room (prevents cross-room injection)
  const [completeMembership] = await db
    .select({ memberId: roomMembers.memberId })
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, msg.roomId),
        eq(roomMembers.memberId, msg.agentId),
        eq(roomMembers.memberType, 'agent'),
      ),
    )
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

  // Clean up stream size tracker
  streamSizeTracker.delete(msg.messageId)

  // Enforce a size cap on chunks to prevent oversized DB writes.
  // Chunks are a structured representation of the response (text, thinking, tool_use, etc.)
  // so their JSON serialization should always be bounded by MAX_FULL_CONTENT_SIZE.
  const MAX_CHUNKS_JSON_SIZE = 20 * 1024 * 1024 // 20 MB (headroom for JSON overhead)
  let chunksValue: unknown[] | null = msg.chunks ?? null
  if (chunksValue) {
    const chunksJsonSize = JSON.stringify(chunksValue).length
    if (chunksJsonSize > MAX_CHUNKS_JSON_SIZE) {
      log.warn(
        `Agent ${msg.agentId} chunks JSON exceeds size limit (${chunksJsonSize} bytes), persisting without chunks`,
      )
      chunksValue = null
    }
  }

  // Persist agent's full message with structured chunks
  await db.insert(messages).values({
    id: msg.messageId,
    roomId: msg.roomId,
    senderId: msg.agentId,
    senderType: 'agent',
    senderName: agentName,
    type: 'agent_response',
    content: msg.fullContent,
    mentions: [],
    chunks: chunksValue,
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

  // Record agent message metric
  incCounter('agentim_messages_total', { type: 'agent' })

  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:message_complete',
    message,
  })

  // Send push notifications to offline room members
  if (isWebPushEnabled()) {
    const userMembers = await db
      .select({ memberId: roomMembers.memberId })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, msg.roomId), eq(roomMembers.memberType, 'user')))

    for (const member of userMembers) {
      if (connectionManager.isUserOnline(member.memberId)) continue
      const body =
        msg.fullContent.length > 200 ? msg.fullContent.slice(0, 200) + '...' : msg.fullContent
      sendPushToUser(member.memberId, {
        title: agentName,
        body,
        data: { roomId: msg.roomId, messageId: msg.messageId },
      }).catch((err) => {
        log.warn(
          `Failed to push notification to user ${member.memberId}: ${(err as Error).message}`,
        )
      })
    }
  }

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

async function handleAgentStatus(
  ws: WSContext,
  agentId: string,
  status: string,
  queueDepth?: number,
) {
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

  // Track gateway-reported queue depth for sender-side throttling
  if (typeof queueDepth === 'number') {
    connectionManager.setAgentQueueDepth(agentId, queueDepth)
  }

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

  const gwAgentIds = [...gw.agentIds]

  // Use a transaction with SELECT FOR UPDATE to prevent concurrent agents
  // from racing on the same task row.
  const updated = await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).for('update')
    if (!task) {
      log.warn(`Task ${taskId} not found, ignoring update`)
      return null
    }

    // Verify the task belongs to a room where one of the gateway's agents is a member
    const memberCheck = await tx
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
      log.warn(
        `Gateway ${gw.gatewayId} has no agents in room ${task.roomId}, rejecting task update`,
      )
      return null
    }

    const now = new Date().toISOString()
    const updateData: Record<string, unknown> = { status, updatedAt: now }
    if (result) updateData.description = result

    await tx.update(tasks).set(updateData).where(eq(tasks.id, taskId))

    return { ...task, ...updateData }
  })

  if (updated) {
    connectionManager.broadcastToRoom(updated.roomId, {
      type: 'server:task_update',
      task: updated,
    })
  }
}

async function handlePermissionRequest(
  ws: WSContext,
  msg: {
    requestId: string
    agentId: string
    roomId: string
    toolName: string
    toolInput: Record<string, unknown>
    timeoutMs: number
  },
) {
  const gw = connectionManager.getGateway(ws)
  if (!gw || !gw.agentIds.has(msg.agentId)) {
    log.warn(`Gateway attempted permission request for unowned agent ${msg.agentId}`)
    return
  }

  const [agent] = await db
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, msg.agentId))
    .limit(1)
  const agentName = agent?.name ?? 'Unknown Agent'

  const timeoutMs = Math.min(msg.timeoutMs, PERMISSION_TIMEOUT_MS)
  const expiresAt = new Date(Date.now() + timeoutMs).toISOString()

  // Set up timeout — auto-deny and notify both gateway and clients
  const timer = setTimeout(() => {
    clearPendingPermission(msg.requestId)
    // Notify gateway of timeout
    connectionManager.sendToGateway(msg.agentId, {
      type: 'server:permission_response',
      requestId: msg.requestId,
      agentId: msg.agentId,
      decision: 'timeout',
    })
    // Notify clients of expiration
    connectionManager.broadcastToRoom(msg.roomId, {
      type: 'server:permission_request_expired',
      requestId: msg.requestId,
    })
  }, timeoutMs)

  const added = addPendingPermission(msg.requestId, {
    agentId: msg.agentId,
    roomId: msg.roomId,
    timer,
  })

  if (!added) {
    // Queue full — notify gateway of rejection
    connectionManager.sendToGateway(msg.agentId, {
      type: 'server:permission_response',
      requestId: msg.requestId,
      agentId: msg.agentId,
      decision: 'deny',
    })
    return
  }

  // Broadcast to room clients
  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:permission_request',
    requestId: msg.requestId,
    agentId: msg.agentId,
    agentName,
    roomId: msg.roomId,
    toolName: msg.toolName,
    toolInput: msg.toolInput,
    expiresAt,
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

function evictExpiredFallbackEntries(): number {
  const now = Date.now()
  let evicted = 0
  for (const [key, entry] of visitedFallback) {
    if (now > entry.expiresAt) {
      visitedFallback.delete(key)
      evicted++
    }
  }
  return evicted
}

function fallbackSadd(key: string, value: string, ttlSeconds: number) {
  // Enforce size limit — batch-evict expired entries first, then oldest if still over
  if (visitedFallback.size >= MAX_FALLBACK_ENTRIES && !visitedFallback.has(key)) {
    const evicted = evictExpiredFallbackEntries()
    // If still over capacity after cleaning expired entries, evict oldest
    if (visitedFallback.size >= MAX_FALLBACK_ENTRIES) {
      const oldestKey = visitedFallback.keys().next().value
      if (oldestKey) visitedFallback.delete(oldestKey)
    }
    if (evicted > 0) {
      log.debug(`Evicted ${evicted} expired visited-set entries during capacity pressure`)
    } else {
      log.warn(`Visited set fallback at capacity (${MAX_FALLBACK_ENTRIES}), evicting oldest entry`)
    }
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
let visitedFallbackTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const evicted = evictExpiredFallbackEntries()
  if (evicted > 0) {
    log.debug(`Evicted ${evicted} expired visited-set entries (remaining: ${visitedFallback.size})`)
  }
}, 60_000)
visitedFallbackTimer.unref()

/** Stop the periodic visited-set fallback cleanup. */
export function stopVisitedFallbackCleanup() {
  if (visitedFallbackTimer) {
    clearInterval(visitedFallbackTimer)
    visitedFallbackTimer = null
  }
}

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
  const maxDepth =
    routerCfg?.maxChainDepth ??
    (getConfigSync<number>('router.maxChainDepth') || config.maxAgentChainDepth)

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
  let useRedis = isRedisEnabled()

  // Add sender to visited set
  if (useRedis) {
    try {
      const redis = getRedis()
      await redis.sadd(visitedKey, senderAgentId)
      await redis.expire(visitedKey, VISITED_TTL)
    } catch {
      useRedis = false
      fallbackSadd(visitedKey, senderAgentId, VISITED_TTL)
    }
  } else {
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
  try {
    return await _sendRoomContextToAgent(agentId, roomId)
  } catch (err) {
    log.error(
      `Failed to send room context to agent ${agentId} for room ${roomId}: ${(err as Error).message}`,
    )
  }
}

async function _sendRoomContextToAgent(agentId: string, roomId: string) {
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
        memberList.push({
          id: agent.id,
          name: agent.name,
          type: 'agent',
          agentType: agent.type as RoomContextMember['agentType'],
          capabilities: agent.capabilities ?? undefined,
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
