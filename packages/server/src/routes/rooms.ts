import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import { resolve, basename } from 'node:path'
import { unlink } from 'node:fs/promises'
import { db } from '../db/index.js'
import {
  rooms,
  roomMembers,
  messages,
  messageAttachments,
  agents,
  gateways,
  routers,
  users,
} from '../db/schema.js'
import {
  createRoomSchema,
  updateRoomSchema,
  addMemberSchema,
  NOTIFICATION_PREFS,
} from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { config } from '../config.js'
import { sanitizeText } from '../lib/sanitize.js'
import { createLogger } from '../lib/logger.js'
import { isRoomMember, isRoomAdmin } from '../lib/roomAccess.js'
import { validateIdParams, parseJsonBody, formatZodError } from '../lib/validation.js'
import { isRouterVisibleToUser } from '../lib/routerConfig.js'
import { connectionManager } from '../ws/connections.js'
import { sendRoomContextToAllAgents, broadcastRoomUpdate } from '../ws/gatewayHandler.js'
import { invalidateMembershipCache } from '../ws/clientHandler.js'
import { invalidateRoomAccessCache } from '../lib/roomAccess.js'
import { logAudit, getClientIp } from '../lib/audit.js'
import {
  cacheGet,
  cacheSet,
  cacheDel,
  roomMembersCacheKey,
  ROOM_MEMBERS_CACHE_TTL,
} from '../lib/cache.js'

const log = createLogger('Rooms')

async function checkRouterAccess(
  userId: string,
  routerId: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const [router] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1)
  if (!router) {
    return { ok: false, status: 404, error: 'Router not found' }
  }
  const [me] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!me) {
    return { ok: false, status: 404, error: 'User not found' }
  }
  if (me.role !== 'admin' && !isRouterVisibleToUser(router, userId)) {
    return { ok: false, status: 403, error: 'Router not accessible' }
  }
  return { ok: true }
}

export const roomRoutes = new Hono<AuthEnv>()

roomRoutes.use('*', authMiddleware)
roomRoutes.use('/:id/*', validateIdParams)
roomRoutes.use('/:id', validateIdParams)

// List rooms for current user
roomRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const memberRows = await db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.memberId, userId), eq(roomMembers.memberType, 'user')))

  const roomIds = memberRows.map((m) => m.roomId)
  if (roomIds.length === 0) {
    return c.json({ ok: true, data: [] })
  }

  const roomList = await db.select().from(rooms).where(inArray(rooms.id, roomIds))

  // Attach user's pin/archive status to each room
  const memberMap = new Map(memberRows.map((m) => [m.roomId, m]))
  const enriched = roomList.map((room) => {
    const member = memberMap.get(room.id)
    return {
      ...room,
      pinnedAt: member?.pinnedAt ?? null,
      archivedAt: member?.archivedAt ?? null,
    }
  })

  return c.json({ ok: true, data: enriched })
})

// Create room
roomRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = createRoomSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const id = nanoid()
  const now = new Date().toISOString()

  // Validate routerId if provided
  if (parsed.data.routerId) {
    const check = await checkRouterAccess(userId, parsed.data.routerId)
    if (!check.ok) return c.json({ ok: false, error: check.error }, check.status)
  }

  let room
  try {
    ;[room] = await db.transaction(async (tx) => {
      await tx.insert(rooms).values({
        id,
        name: sanitizeText(parsed.data.name),
        type: parsed.data.type,
        broadcastMode: parsed.data.broadcastMode,
        systemPrompt: parsed.data.systemPrompt ?? null,
        routerId: parsed.data.routerId ?? null,
        createdById: userId,
        createdAt: now,
        updatedAt: now,
      })

      // Add creator as owner
      await tx.insert(roomMembers).values({
        roomId: id,
        memberId: userId,
        memberType: 'user',
        role: 'owner',
        lastReadAt: now,
        joinedAt: now,
      })

      // Add additional members (deduplicate and exclude creator)
      const uniqueMemberIds = [...new Set(parsed.data.memberIds)].filter((id) => id !== userId)
      if (uniqueMemberIds.length > 0) {
        // Verify all users exist
        const existingUsers = await tx
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, uniqueMemberIds))
        if (existingUsers.length !== uniqueMemberIds.length) {
          throw Object.assign(new Error('One or more users not found'), { status: 400 })
        }
        await tx.insert(roomMembers).values(
          uniqueMemberIds.map((memberId) => ({
            roomId: id,
            memberId,
            memberType: 'user' as const,
            role: 'member' as const,
            lastReadAt: now,
            joinedAt: now,
          })),
        )
      }

      return tx.select().from(rooms).where(eq(rooms.id, id)).limit(1)
    })
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 400) {
      return c.json({ ok: false, error: (err as Error).message }, 400)
    }
    if ((err as { code?: string })?.code === '23503') {
      return c.json({ ok: false, error: 'Router no longer exists' }, 409)
    }
    throw err
  }

  logAudit({
    userId,
    action: 'room_create',
    targetId: id,
    targetType: 'room',
    metadata: { name: parsed.data.name, type: parsed.data.type },
    ipAddress: getClientIp(c),
  })

  return c.json({ ok: true, data: room }, 201)
})

// Get room by id
roomRoutes.get('/:id', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')

  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) {
    return c.json({ ok: false, error: 'Room not found' }, 404)
  }

  if (!(await isRoomMember(userId, roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  let members = await cacheGet<(typeof roomMembers.$inferSelect)[]>(roomMembersCacheKey(roomId))
  if (!members) {
    members = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId)).limit(500)
    await cacheSet(roomMembersCacheKey(roomId), members, ROOM_MEMBERS_CACHE_TTL)
  }
  return c.json({ ok: true, data: { ...room, members } })
})

// Update room (owner/admin only)
roomRoutes.put('/:id', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = updateRoomSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  if (!(await isRoomAdmin(userId, roomId))) {
    return c.json({ ok: false, error: 'Only room owner or admin can update settings' }, 403)
  }

  // Validate routerId if provided
  if (parsed.data.routerId !== undefined && parsed.data.routerId !== null) {
    const check = await checkRouterAccess(userId, parsed.data.routerId)
    if (!check.ok) return c.json({ ok: false, error: check.error }, check.status)
  }

  const now = new Date().toISOString()
  const updateData = { ...parsed.data, updatedAt: now }
  if (updateData.name) {
    updateData.name = sanitizeText(updateData.name)
  }
  try {
    await db.update(rooms).set(updateData).where(eq(rooms.id, roomId))
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === '23503') {
      return c.json({ ok: false, error: 'Router no longer exists' }, 409)
    }
    throw err
  }

  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)

  logAudit({
    userId,
    action: 'room_update',
    targetId: roomId,
    targetType: 'room',
    ipAddress: getClientIp(c),
  })

  await broadcastRoomUpdate(roomId)
  await sendRoomContextToAllAgents(roomId)

  return c.json({ ok: true, data: room })
})

// Delete room
roomRoutes.delete('/:id', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')

  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) {
    return c.json({ ok: false, error: 'Room not found' }, 404)
  }
  if (room.createdById !== userId) {
    return c.json({ ok: false, error: 'Only room creator can delete' }, 403)
  }

  // Collect members before deletion so we can notify them
  const memberRows = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId))
  const userMemberIds = memberRows.filter((m) => m.memberType === 'user').map((m) => m.memberId)

  // Collect attachment file URLs before cascade-deleting (DB records will be gone after)
  const roomMessageIds = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.roomId, roomId))
  const msgIds = roomMessageIds.map((m) => m.id)
  let attachmentUrls: string[] = []
  if (msgIds.length > 0) {
    const attachments = await db
      .select({ url: messageAttachments.url })
      .from(messageAttachments)
      .where(inArray(messageAttachments.messageId, msgIds))
    attachmentUrls = attachments.map((a) => a.url)
  }

  await db.delete(rooms).where(eq(rooms.id, roomId))

  // Clean up attachment files from disk (best-effort, non-blocking)
  if (attachmentUrls.length > 0) {
    const uploadDir = resolve(config.uploadDir)
    for (const url of attachmentUrls) {
      const filename = basename(url)
      const filePath = resolve(uploadDir, filename)
      unlink(filePath).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.warn(`Failed to unlink attachment ${filename}: ${(err as Error).message}`)
        }
      })
    }
  }

  // Notify all connected members that the room has been removed
  for (const memberId of userMemberIds) {
    connectionManager.evictUserFromRoom(memberId, roomId)
  }

  logAudit({
    userId,
    action: 'room_delete',
    targetId: roomId,
    targetType: 'room',
    metadata: { name: room.name },
    ipAddress: getClientIp(c),
  })

  return c.json({ ok: true })
})

// Add member to room (owner/admin only)
roomRoutes.post('/:id/members', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = addMemberSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  if (!(await isRoomAdmin(userId, roomId))) {
    return c.json({ ok: false, error: 'Only room owner or admin can add members' }, 403)
  }

  // Verify member exists
  if (parsed.data.memberType === 'user') {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, parsed.data.memberId))
      .limit(1)
    if (!user) {
      return c.json({ ok: false, error: 'User not found' }, 404)
    }
  }

  // Agent ownership / visibility check
  if (parsed.data.memberType === 'agent') {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, parsed.data.memberId))
      .limit(1)
    if (!agent) {
      return c.json({ ok: false, error: 'Agent not found' }, 404)
    }
    if (agent.visibility !== 'shared') {
      const [gw] = await db.select().from(gateways).where(eq(gateways.id, agent.gatewayId)).limit(1)
      if (!gw || gw.userId !== userId) {
        return c.json({ ok: false, error: 'You do not own this agent and it is not shared' }, 403)
      }
    }
  }

  const now = new Date().toISOString()
  try {
    await db.insert(roomMembers).values({
      roomId,
      memberId: parsed.data.memberId,
      memberType: parsed.data.memberType,
      role: parsed.data.role,
      roleDescription: parsed.data.roleDescription ?? null,
      lastReadAt: now,
      joinedAt: now,
    })
  } catch (err: unknown) {
    const code = (err as any)?.code ?? (err as any)?.cause?.code
    if (code === '23505') {
      return c.json({ ok: false, error: 'Member already in room' }, 409)
    }
    throw err
  }

  logAudit({
    userId,
    action: 'member_add',
    targetId: parsed.data.memberId,
    targetType: 'member',
    metadata: { roomId, memberType: parsed.data.memberType, role: parsed.data.role },
    ipAddress: getClientIp(c),
  })

  // Invalidate WS membership cache so the new member can join immediately
  if (parsed.data.memberType === 'user') {
    await invalidateMembershipCache(parsed.data.memberId, roomId)
  }
  // Invalidate HTTP access caches
  await invalidateRoomAccessCache(parsed.data.memberId, roomId)
  await cacheDel(roomMembersCacheKey(roomId))

  await broadcastRoomUpdate(roomId)
  await sendRoomContextToAllAgents(roomId)

  return c.json({ ok: true }, 201)
})

// Remove member from room (owner/admin, or self-leave)
roomRoutes.delete('/:id/members/:memberId', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')
  const memberId = c.req.param('memberId')

  // Self-leave: verify the caller is actually a member before proceeding
  if (memberId === userId) {
    if (!(await isRoomMember(userId, roomId))) {
      return c.json({ ok: false, error: 'Not a member of this room' }, 403)
    }
  } else if (!(await isRoomAdmin(userId, roomId))) {
    return c.json({ ok: false, error: 'Only room owner or admin can remove members' }, 403)
  }

  // Prevent removing the room creator — would orphan the room
  const [room] = await db
    .select({ createdById: rooms.createdById })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1)
  if (room && room.createdById === memberId) {
    return c.json({ ok: false, error: 'Cannot remove the room creator' }, 400)
  }

  await db
    .delete(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, memberId)))

  // Evict removed member from WS room state (keeps joinedRooms in sync with DB)
  connectionManager.evictUserFromRoom(memberId, roomId)
  // Invalidate WS membership cache so the removed user cannot rejoin within the TTL
  await invalidateMembershipCache(memberId, roomId)
  // Invalidate HTTP access caches
  await invalidateRoomAccessCache(memberId, roomId)
  await cacheDel(roomMembersCacheKey(roomId))

  logAudit({
    userId,
    action: 'member_remove',
    targetId: memberId,
    targetType: 'member',
    metadata: { roomId, selfLeave: memberId === userId },
    ipAddress: getClientIp(c),
  })

  await broadcastRoomUpdate(roomId)
  await sendRoomContextToAllAgents(roomId)

  return c.json({ ok: true })
})

// Toggle pin for current user in a room
roomRoutes.put('/:id/pin', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')

  const [member] = await db
    .select()
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.memberId, userId),
        eq(roomMembers.memberType, 'user'),
      ),
    )
    .limit(1)
  if (!member) return c.json({ ok: false, error: 'Not a member' }, 404)

  const pinnedAt = member.pinnedAt ? null : new Date().toISOString()
  await db
    .update(roomMembers)
    .set({ pinnedAt })
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.memberId, userId),
        eq(roomMembers.memberType, 'user'),
      ),
    )

  return c.json({ ok: true, data: { pinned: !!pinnedAt } })
})

// Toggle archive for current user in a room
roomRoutes.put('/:id/archive', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')

  const [member] = await db
    .select()
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.memberId, userId),
        eq(roomMembers.memberType, 'user'),
      ),
    )
    .limit(1)
  if (!member) return c.json({ ok: false, error: 'Not a member' }, 404)

  const archivedAt = member.archivedAt ? null : new Date().toISOString()
  await db
    .update(roomMembers)
    .set({ archivedAt })
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.memberId, userId),
        eq(roomMembers.memberType, 'user'),
      ),
    )

  return c.json({ ok: true, data: { archived: !!archivedAt } })
})

// Update notification preference for current user in a room
roomRoutes.put('/:id/notification-pref', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const pref = (body as Record<string, unknown>)?.pref

  if (
    !pref ||
    typeof pref !== 'string' ||
    !(NOTIFICATION_PREFS as readonly string[]).includes(pref)
  ) {
    return c.json(
      { ok: false, error: `Invalid preference. Must be one of: ${NOTIFICATION_PREFS.join(', ')}` },
      400,
    )
  }

  const result = await db
    .update(roomMembers)
    .set({ notificationPref: pref as string })
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.memberId, userId),
        eq(roomMembers.memberType, 'user'),
      ),
    )
    .returning({ roomId: roomMembers.roomId })

  if (result.length === 0) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  return c.json({ ok: true })
})

// Get room members
roomRoutes.get('/:id/members', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')

  if (!(await isRoomMember(userId, roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const members = await db
    .select()
    .from(roomMembers)
    .where(eq(roomMembers.roomId, roomId))
    .limit(500)
  return c.json({ ok: true, data: members })
})
