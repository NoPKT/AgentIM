import type { WSContext } from 'hono/ws'
import { nanoid } from 'nanoid'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import {
  clientMessageSchema,
  parseMentions,
  WS_ERROR_CODES,
  CURRENT_PROTOCOL_VERSION,
  MAX_JSON_DEPTH,
} from '@agentim/shared'
import type { ServerSendToAgent, ServerStopAgent, RoutingMode } from '@agentim/shared'
import { getPendingPermission, clearPendingPermission } from '../lib/permission-store.js'
import { connectionManager } from './connections.js'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked } from '../lib/tokenRevocation.js'
import { createLogger } from '../lib/logger.js'
import { captureException } from '../lib/sentry.js'
import { config, getConfigSync } from '../config.js'
import { db } from '../db/index.js'
import {
  messages,
  rooms,
  roomMembers,
  agents,
  messageAttachments,
  users,
  serviceAgents,
} from '../db/schema.js'
import { sanitizeContent } from '../lib/sanitize.js'
import { getRedis, isRedisEnabled } from '../lib/redis.js'
import { isWsRateLimited, stopWsRateCleanup } from './wsRateLimit.js'
import { selectAgents } from '../lib/routerLlm.js'
import { getRouterConfig } from '../lib/routerConfig.js'
import { buildAgentNameMap } from '../lib/agentUtils.js'
import { isWebPushEnabled, sendPushToUser } from '../lib/webPush.js'
import { getRoomMemberRole } from '../lib/roomAccess.js'
import { incCounter } from '../lib/metrics.js'
import { handleServiceAgentMention } from '../lib/serviceAgentHandler.js'
import { safeJsonParse } from '../lib/json.js'

const log = createLogger('ClientHandler')

// Debounce offline presence broadcasts to avoid rapid offline→online flicker
// when a user disconnects and immediately reconnects (e.g. page refresh).
const OFFLINE_DEBOUNCE_MS = 2_000
const offlineTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Per-socket auth attempt counter with exponential backoff. Limits brute-force
// token guessing over a single WebSocket connection (complements the WS upgrade
// rate limit per IP). WeakMap ensures entries are automatically GC'd when the
// WSContext object is collected after disconnect — no manual cleanup needed.
const WS_MAX_AUTH_ATTEMPTS = 5
const WS_AUTH_BACKOFF_BASE_MS = 200
const wsAuthAttempts = new WeakMap<object, { count: number; nextAllowedAt: number }>()

// MAX_JSON_DEPTH imported from @agentim/shared (unified across client/gateway handlers)

// ─── Room Membership Cache ───
// Short-lived cache keyed by `rm:<userId>:<roomId>` with TTL 60s.
// Reduces DB lookups for repeated handleJoinRoom calls (e.g. page refreshes).
// Cache is invalidated (key deleted) whenever the HTTP API adds or removes members.
const ROOM_MEMBER_CACHE_TTL = 60 // seconds

// In-memory membership cache fallback when Redis is not available
const MAX_MEMBERSHIP_CACHE_SIZE = 10_000
const membershipMemoryCache = new Map<string, { value: string; expiresAt: number }>()

// Periodically clean up expired membership cache entries
let membershipCacheTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of membershipMemoryCache) {
    if (now > entry.expiresAt) membershipMemoryCache.delete(key)
  }
}, 60_000)
membershipCacheTimer.unref()

async function getCachedMembership(
  userId: string,
  roomId: string,
): Promise<'member' | 'creator' | 'none' | null> {
  const key = `rm:${userId}:${roomId}`

  if (!isRedisEnabled()) {
    const entry = membershipMemoryCache.get(key)
    if (!entry || Date.now() > entry.expiresAt) {
      membershipMemoryCache.delete(key)
      return null
    }
    const val = entry.value
    if (val === 'member' || val === 'creator' || val === 'none') return val
    return null
  }

  try {
    const redis = getRedis()
    const val = await redis.get(key)
    if (val === 'member' || val === 'creator' || val === 'none') return val
    return null
  } catch {
    return null // Cache miss on Redis failure — fall through to DB
  }
}

async function setCachedMembership(
  userId: string,
  roomId: string,
  status: 'member' | 'creator' | 'none',
): Promise<void> {
  const key = `rm:${userId}:${roomId}`

  if (!isRedisEnabled()) {
    // Enforce capacity limit — evict expired entries first, then oldest
    if (
      membershipMemoryCache.size >= MAX_MEMBERSHIP_CACHE_SIZE &&
      !membershipMemoryCache.has(key)
    ) {
      const now = Date.now()
      for (const [k, entry] of membershipMemoryCache) {
        if (now > entry.expiresAt) membershipMemoryCache.delete(k)
      }
      if (membershipMemoryCache.size >= MAX_MEMBERSHIP_CACHE_SIZE) {
        const oldestKey = membershipMemoryCache.keys().next().value
        if (oldestKey) membershipMemoryCache.delete(oldestKey)
      }
    }
    membershipMemoryCache.set(key, {
      value: status,
      expiresAt: Date.now() + ROOM_MEMBER_CACHE_TTL * 1000,
    })
    return
  }

  try {
    const redis = getRedis()
    await redis.set(key, status, 'EX', ROOM_MEMBER_CACHE_TTL)
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Invalidate the room membership cache for a specific user+room pair.
 * Call this from HTTP route handlers whenever members are added or removed.
 */
export async function invalidateMembershipCache(userId: string, roomId: string): Promise<void> {
  const key = `rm:${userId}:${roomId}`

  // Always clear memory cache
  membershipMemoryCache.delete(key)

  if (!isRedisEnabled()) return

  try {
    const redis = getRedis()
    await redis.del(key)
  } catch {
    // Non-fatal — cache will expire on its own within ROOM_MEMBER_CACHE_TTL
  }
}
// Maximum number of elements in a single array / keys in a single object.
// A 10,000-element flat array has depth 1 and bypasses depth checks, so we
// impose an independent collection-size limit to cap memory allocation.

async function isRateLimited(userId: string, roomId?: string): Promise<boolean> {
  const window = getConfigSync<number>('rateLimit.client.window') ?? config.clientRateLimitWindow
  const max = getConfigSync<number>('rateLimit.client.max') ?? config.clientRateLimitMax
  const keySuffix = roomId ? `${userId}:${roomId}` : userId
  return isWsRateLimited(keySuffix, window, max)
}

export async function handleClientMessage(ws: WSContext, raw: string) {
  const maxMessageSize = getConfigSync<number>('ws.maxMessageSize') ?? config.maxWsMessageSize
  if (raw.length > maxMessageSize) {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: WS_ERROR_CODES.MESSAGE_TOO_LARGE,
      message: 'Message exceeds maximum size',
    })
    return
  }

  let data: unknown
  try {
    data = safeJsonParse(raw, MAX_JSON_DEPTH)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    const isDepth = msg.includes('depth')
    const isSize = msg.includes('collection size')
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: isDepth || isSize ? WS_ERROR_CODES.JSON_TOO_DEEP : WS_ERROR_CODES.INVALID_JSON,
      message: isDepth
        ? 'JSON nesting depth exceeded'
        : isSize
          ? 'JSON collection size exceeded'
          : 'Invalid JSON',
    })
    return
  }

  incCounter('agentim_ws_messages_total', { direction: 'in' })

  const parsed = clientMessageSchema.safeParse(data)
  if (!parsed.success) {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: WS_ERROR_CODES.INVALID_MESSAGE,
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
        code: WS_ERROR_CODES.NOT_AUTHENTICATED,
        message: 'Please authenticate first',
      })
      return
    }

    // Rate limit authenticated messages
    if (await isRateLimited(client.userId)) {
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: WS_ERROR_CODES.RATE_LIMITED,
        message: 'Too many messages, please slow down',
      })
      return
    }
  }

  try {
    switch (msg.type) {
      case 'client:auth':
        return await handleAuth(ws, msg.token, msg.protocolVersion)
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
      case 'client:permission_response':
        return handlePermissionResponse(ws, msg.requestId, msg.decision)
      case 'client:ping':
        connectionManager.sendToClient(ws, { type: 'server:pong', ts: msg.ts })
        return
      default:
        log.warn(`Unknown client message type: ${(msg as { type: string }).type}`)
        return
    }
  } catch (err) {
    log.error(
      `Error handling client message ${msg.type}: ${(err as Error).message}${(err as Error).stack ? `\n${(err as Error).stack}` : ''}`,
    )
    captureException(err)
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: WS_ERROR_CODES.INTERNAL_ERROR,
      message: 'An internal error occurred',
    })
  }
}

async function handleAuth(ws: WSContext, token: string, protocolVersion?: string) {
  // Enforce per-socket auth attempt limit with exponential backoff to prevent
  // brute-force token guessing. Each failed attempt doubles the required wait
  // time (200ms, 400ms, 800ms, 1600ms) before the next attempt is accepted.
  const state = wsAuthAttempts.get(ws) ?? { count: 0, nextAllowedAt: 0 }
  state.count++
  const now = Date.now()
  if (state.count > WS_MAX_AUTH_ATTEMPTS) {
    connectionManager.sendToClient(ws, {
      type: 'server:auth_result',
      ok: false,
      error: 'Too many authentication attempts',
    })
    ws.close(1008, 'Too many authentication attempts')
    return
  }
  if (now < state.nextAllowedAt) {
    connectionManager.sendToClient(ws, {
      type: 'server:auth_result',
      ok: false,
      error: 'Too many authentication attempts, please wait',
    })
    return
  }
  // Set backoff for next attempt (exponential: 200ms, 400ms, 800ms, ...)
  state.nextAllowedAt = now + WS_AUTH_BACKOFF_BASE_MS * Math.pow(2, state.count - 1)
  wsAuthAttempts.set(ws, state)

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
    // Reject incompatible protocol versions before registering the client
    if (protocolVersion && protocolVersion !== CURRENT_PROTOCOL_VERSION) {
      log.warn('Client protocol version mismatch', {
        clientVersion: protocolVersion,
        serverVersion: CURRENT_PROTOCOL_VERSION,
        userId: payload.sub,
      })
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: WS_ERROR_CODES.PROTOCOL_VERSION_MISMATCH,
        message: `Protocol version mismatch: client=${protocolVersion}, server=${CURRENT_PROTOCOL_VERSION}. Please update your client.`,
      })
      ws.close(1008, 'Protocol version mismatch')
      return
    }
    // Fetch per-user connection limit override
    const [user] = await db
      .select({ maxWsConnections: users.maxWsConnections })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1)

    const wasOnline = connectionManager.isUserOnline(payload.sub)
    const result = connectionManager.addClient(
      ws,
      payload.sub,
      payload.username,
      user?.maxWsConnections,
    )
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
      // Cancel any pending offline broadcast from a recent disconnect
      const pendingTimer = offlineTimers.get(payload.sub)
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        offlineTimers.delete(payload.sub)
      } else {
        connectionManager.broadcastToAll({
          type: 'server:presence',
          userId: payload.sub,
          username: payload.username,
          online: true,
        })
      }
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

  // Check cache first before hitting the DB
  const cached = await getCachedMembership(client.userId, roomId)

  if (cached === 'none') {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: WS_ERROR_CODES.NOT_A_MEMBER,
      message: 'You are not a member of this room',
    })
    return
  }

  if (cached === 'member' || cached === 'creator') {
    connectionManager.joinRoom(ws, roomId)
    return
  }

  // Cache miss — query DB
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) {
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: WS_ERROR_CODES.ROOM_NOT_FOUND,
      message: 'Room not found',
    })
    return
  }

  if (room.createdById === client.userId) {
    await setCachedMembership(client.userId, roomId, 'creator')
    connectionManager.joinRoom(ws, roomId)
    return
  }

  const [membership] = await db
    .select()
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.memberId, client.userId),
        eq(roomMembers.memberType, 'user'),
      ),
    )
    .limit(1)

  if (!membership) {
    await setCachedMembership(client.userId, roomId, 'none')
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: WS_ERROR_CODES.NOT_A_MEMBER,
      message: 'You are not a member of this room',
    })
    return
  }

  await setCachedMembership(client.userId, roomId, 'member')
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

  const content = sanitizeContent(rawContent)
  const id = nanoid()
  const now = new Date().toISOString()

  // Use server-parsed mentions instead of trusting client input
  const serverParsedMentions = parseMentions(content)

  // Atomic: verify membership + persist message + link attachments in a single
  // transaction to eliminate the TOCTOU race between the membership check and
  // the INSERT (member could be removed between the two steps otherwise).
  type AttachmentInfo = {
    id: string
    messageId: string
    filename: string
    mimeType: string
    size: number
    url: string
  }

  let txResult: {
    room: typeof rooms.$inferSelect
    attachments: AttachmentInfo[]
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [foundRoom] = await tx.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
      if (!foundRoom) return { error: WS_ERROR_CODES.ROOM_NOT_FOUND }

      if (foundRoom.createdById !== client.userId) {
        const [membership] = await tx
          .select()
          .from(roomMembers)
          .where(
            and(
              eq(roomMembers.roomId, roomId),
              eq(roomMembers.memberId, client.userId),
              eq(roomMembers.memberType, 'user'),
            ),
          )
          .limit(1)
        if (!membership) return { error: WS_ERROR_CODES.NOT_A_MEMBER }
      }

      await tx.insert(messages).values({
        id,
        roomId,
        senderId: client.userId,
        senderType: 'user',
        senderName: client.username,
        type: 'text',
        content,
        replyToId,
        mentions: serverParsedMentions,
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

        return {
          room: foundRoom,
          attachments: rows.map((r) => ({
            id: r.id,
            messageId: id,
            filename: r.filename,
            mimeType: r.mimeType,
            size: r.size,
            url: r.url,
          })),
        }
      }

      return { room: foundRoom, attachments: [] as AttachmentInfo[] }
    })

    if ('error' in result) {
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: result.error,
        message:
          result.error === WS_ERROR_CODES.ROOM_NOT_FOUND
            ? 'Room not found'
            : 'You are not a member of this room',
      })
      return
    }

    txResult = result
  } catch (err) {
    log.error(`Transaction error in handleSendMessage: ${(err as Error).message}`)
    connectionManager.sendToClient(ws, {
      type: 'server:error',
      code: WS_ERROR_CODES.INTERNAL_ERROR,
      message: 'Failed to send message',
    })
    return
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
    mentions: serverParsedMentions,
    ...(txResult.attachments.length > 0 ? { attachments: txResult.attachments } : {}),
    createdAt: now,
  }

  // Record user message metric
  incCounter('agentim_messages_total', { type: 'user' })

  // Broadcast to all clients in the room
  connectionManager.broadcastToRoom(roomId, {
    type: 'server:new_message',
    message,
  })

  // Send push notifications to offline room members
  if (isWebPushEnabled()) {
    const userMembers = await db
      .select({ memberId: roomMembers.memberId })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberType, 'user')))

    for (const member of userMembers) {
      if (member.memberId === client.userId) continue
      if (connectionManager.isUserOnline(member.memberId)) continue
      sendPushToUser(member.memberId, {
        title: client.username,
        body: content.length > 200 ? content.slice(0, 200) + '...' : content,
        data: { roomId, messageId: id },
      }).catch((err) => {
        log.warn(
          `Failed to push notification to user ${member.memberId}: ${(err as Error).message}`,
        )
      })
    }
  }

  // Route to agents based on server-parsed mentions and broadcast mode
  await routeToAgents(ws, txResult.room, message, serverParsedMentions, client.userId)
}

async function routeToAgents(
  ws: WSContext,
  room: {
    id: string
    broadcastMode: boolean
    systemPrompt: string | null
    agentCommandRole: string
  },
  message: { id: string; content: string; senderName: string },
  mentions: string[],
  senderId: string,
) {
  const roomId = room.id

  // Check agent command permission — only when agentCommandRole is restricted
  if (room.agentCommandRole !== 'member') {
    const ROLE_HIERARCHY: Record<string, number> = { owner: 2, admin: 1, member: 0 }
    const requiredLevel = ROLE_HIERARCHY[room.agentCommandRole] ?? 0
    const senderRole = await getRoomMemberRole(senderId, roomId)
    const senderLevel = senderRole ? (ROLE_HIERARCHY[senderRole] ?? 0) : 0
    if (senderLevel < requiredLevel) {
      connectionManager.sendToClient(ws, {
        type: 'server:error',
        code: WS_ERROR_CODES.PERMISSION_DENIED,
        message: 'Insufficient permissions to command agents in this room',
      })
      return
    }
  }

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

  // Check for service agent mentions
  const allServiceAgents = await db.select().from(serviceAgents)
  for (const mention of serverMentions) {
    const sa = allServiceAgents.find(
      (s) => s.name.toLowerCase() === mention.toLowerCase() && s.status === 'active',
    )
    if (sa) {
      // Handle asynchronously — don't block the message flow
      handleServiceAgentMention(sa.id, roomId, message.content, message.senderName).catch((err) =>
        log.error(`Service agent handler error: ${(err as Error).message}`),
      )
    }
  }

  // Two-mode routing decision matrix:
  // has @mention (any room)            → direct: only mentioned agents receive
  // broadcast + no mention + AI Router → broadcast: AI Router selects agents
  // broadcast + no mention + no Router → no routing (message shown in chat only)
  // non-broadcast + no mention         → no routing
  let routingMode: RoutingMode
  const targetAgents: typeof agentRows = []

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
      cliAgents.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        capabilities: a.capabilities ?? undefined,
      })),
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
    // Sender-side cooldown: if this agent has a queue backlog, enforce a
    // progressive wait period per sender to prevent bombardment.
    const cooldownMs = getAgentCooldownMs(agent.id)
    if (cooldownMs > 0) {
      const cooldownKey = `sender:${senderId}:agent:${agent.id}`
      const lastSent = agentSendCooldowns.get(cooldownKey)
      const now = Date.now()
      if (lastSent && now - lastSent < cooldownMs) {
        const waitSec = Math.ceil((cooldownMs - (now - lastSent)) / 1000)
        const queueDepth = connectionManager.getAgentQueueDepth(agent.id)
        connectionManager.sendToClient(ws, {
          type: 'server:new_message',
          message: {
            id: nanoid(),
            roomId,
            senderId: 'system',
            senderType: 'system' as const,
            senderName: 'System',
            type: 'system' as const,
            content:
              `Agent @${agent.name} is busy (${queueDepth} message${queueDepth === 1 ? '' : 's'} pending). ` +
              `Please wait ${waitSec}s before sending another message.`,
            mentions: [],
            createdAt: new Date().toISOString(),
          },
        })
        continue
      }
    }

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
    const sent = connectionManager.sendToGateway(agent.id, sendMsg)
    if (!sent) {
      // Notify room that agent is offline
      connectionManager.broadcastToRoom(roomId, {
        type: 'server:new_message',
        message: {
          id: nanoid(),
          roomId,
          senderId: 'system',
          senderType: 'system' as const,
          senderName: 'System',
          type: 'system' as const,
          content: `Agent @${agent.name} is currently offline and cannot receive messages.`,
          mentions: [],
          createdAt: new Date().toISOString(),
        },
      })
    } else if (cooldownMs > 0) {
      // Record this send time for future cooldown checks
      const cooldownKey = `sender:${senderId}:agent:${agent.id}`
      if (agentSendCooldowns.size >= MAX_COOLDOWN_ENTRIES) {
        // Evict oldest entry to prevent unbounded growth
        const firstKey = agentSendCooldowns.keys().next().value
        if (firstKey) agentSendCooldowns.delete(firstKey)
      }
      agentSendCooldowns.set(cooldownKey, Date.now())
    }
  }
}

// ─── Sender-side Agent Cooldown ───
// When an agent is busy with a queue, senders must wait before sending another
// message to the same agent. Prevents "bombardment" while allowing natural
// conversation pacing. Cooldown scales with queue depth.
const AGENT_COOLDOWN_BASE_MS = 15_000 // 15 seconds base cooldown
const AGENT_COOLDOWN_MAX_MS = 120_000 // 2 minutes max cooldown
const MAX_COOLDOWN_ENTRIES = 10_000
// Key: `sender:${senderId}:agent:${agentId}`, Value: timestamp of last send
const agentSendCooldowns = new Map<string, number>()

// Periodic cleanup of stale cooldown entries (every 60s)
const cooldownCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, ts] of agentSendCooldowns) {
    if (now - ts > AGENT_COOLDOWN_MAX_MS) agentSendCooldowns.delete(key)
  }
}, 60_000)
cooldownCleanupTimer.unref()

/**
 * Compute the sender-side cooldown for a specific agent based on its queue depth.
 * Returns 0 if no cooldown is needed (agent is idle or has no queue).
 */
function getAgentCooldownMs(agentId: string): number {
  const queueDepth = connectionManager.getAgentQueueDepth(agentId)
  if (queueDepth <= 0) return 0
  // Progressive: 15s × queueDepth, capped at 2 minutes
  return Math.min(AGENT_COOLDOWN_BASE_MS * queueDepth, AGENT_COOLDOWN_MAX_MS)
}

// In-memory typing debounce when Redis is not available
const MAX_TYPING_DEBOUNCE_ENTRIES = 10_000
const typingDebounceMemory = new Map<string, number>()

// Periodically clean up stale typing debounce entries (>5s old)
let typingDebounceTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now()
  for (const [key, ts] of typingDebounceMemory) {
    if (now - ts > 5_000) typingDebounceMemory.delete(key)
  }
}, 30_000)
typingDebounceTimer.unref()

async function handleTyping(ws: WSContext, roomId: string) {
  const client = connectionManager.getClient(ws)
  if (!client || !client.joinedRooms.has(roomId)) return

  // Debounce typing events: max 1 per second per user per room
  if (!isRedisEnabled()) {
    const debounceKey = `${client.userId}:${roomId}`
    const lastSent = typingDebounceMemory.get(debounceKey) ?? 0
    if (Date.now() - lastSent < 1000) return
    // Enforce capacity limit before inserting
    if (
      typingDebounceMemory.size >= MAX_TYPING_DEBOUNCE_ENTRIES &&
      !typingDebounceMemory.has(debounceKey)
    ) {
      const oldestKey = typingDebounceMemory.keys().next().value
      if (oldestKey) typingDebounceMemory.delete(oldestKey)
    }
    typingDebounceMemory.set(debounceKey, Date.now())
  } else {
    try {
      const redis = getRedis()
      const key = `ws:typing:${client.userId}:${roomId}`
      const allowed = await redis.set(key, '1', 'EX', 1, 'NX')
      if (!allowed) return // Already sent recently, silently drop
    } catch {
      // Redis unavailable, allow through
    }
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

function handlePermissionResponse(ws: WSContext, requestId: string, decision: 'allow' | 'deny') {
  const client = connectionManager.getClient(ws)
  if (!client) return

  const pending = getPendingPermission(requestId)
  if (!pending) {
    log.warn(`Permission response for unknown requestId=${requestId}`)
    return
  }

  // Verify user is in the room
  if (!client.joinedRooms.has(pending.roomId)) {
    log.warn(`User ${client.userId} not in room ${pending.roomId} for permission response`)
    return
  }

  clearPendingPermission(requestId)

  // Forward decision to gateway
  connectionManager.sendToGateway(pending.agentId, {
    type: 'server:permission_response',
    requestId,
    agentId: pending.agentId,
    decision,
  })
}

export function handleClientDisconnect(ws: WSContext) {
  const client = connectionManager.getClient(ws)
  connectionManager.removeClient(ws)
  if (!client) return

  // Broadcast server:typing so the frontend clears this user's typing indicator via timeout
  for (const roomId of client.joinedRooms) {
    connectionManager.broadcastToRoom(roomId, {
      type: 'server:typing',
      roomId,
      userId: client.userId,
      username: client.username,
    })
  }

  // Debounce offline presence to handle rapid disconnect→reconnect (e.g. page refresh)
  if (!connectionManager.isUserOnline(client.userId)) {
    // Clear any existing timer for this user (should not happen, but be safe)
    const existing = offlineTimers.get(client.userId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      offlineTimers.delete(client.userId)
      // Re-check: user may have reconnected during the debounce window
      if (!connectionManager.isUserOnline(client.userId)) {
        connectionManager.broadcastToAll({
          type: 'server:presence',
          userId: client.userId,
          username: client.username,
          online: false,
        })
      }
    }, OFFLINE_DEBOUNCE_MS)
    offlineTimers.set(client.userId, timer)
  }
}

/** Stop all periodic cleanup timers in clientHandler (for graceful shutdown / tests). */
export function stopClientHandlerCleanup() {
  if (membershipCacheTimer) {
    clearInterval(membershipCacheTimer)
    membershipCacheTimer = null
  }
  stopWsRateCleanup()
  if (typingDebounceTimer) {
    clearInterval(typingDebounceTimer)
    typingDebounceTimer = null
  }
}
