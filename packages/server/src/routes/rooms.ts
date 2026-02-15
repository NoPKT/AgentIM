import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rooms, roomMembers, agents, gateways } from '../db/schema.js'
import { createRoomSchema, updateRoomSchema, addMemberSchema, NOTIFICATION_PREFS } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { sanitizeText } from '../lib/sanitize.js'
import { isRoomMember, isRoomAdmin } from '../lib/roomAccess.js'
import { connectionManager } from '../ws/connections.js'
import { sendRoomContextToAllAgents } from '../ws/gatewayHandler.js'

async function broadcastRoomUpdate(roomId: string) {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) return
  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId))
  connectionManager.broadcastToRoom(roomId, {
    type: 'server:room_update',
    room,
    members,
  })
}

export const roomRoutes = new Hono<AuthEnv>()

roomRoutes.use('*', authMiddleware)

// List rooms for current user
roomRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const memberRows = await db
    .select()
    .from(roomMembers)
    .where(eq(roomMembers.memberId, userId))

  const roomIds = memberRows.map((m) => m.roomId)
  if (roomIds.length === 0) {
    return c.json({ ok: true, data: [] })
  }

  const roomList = await db
    .select()
    .from(rooms)
    .where(inArray(rooms.id, roomIds))

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
  const body = await c.req.json()
  const parsed = createRoomSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten() }, 400)
  }

  const id = nanoid()
  const now = new Date().toISOString()

  const [room] = await db.transaction(async (tx) => {
    await tx.insert(rooms).values({
      id,
      name: sanitizeText(parsed.data.name),
      type: parsed.data.type,
      broadcastMode: parsed.data.broadcastMode,
      systemPrompt: parsed.data.systemPrompt ?? null,
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

  if (!await isRoomMember(userId, roomId)) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId))
  return c.json({ ok: true, data: { ...room, members } })
})

// Update room (owner/admin only)
roomRoutes.put('/:id', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = updateRoomSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  if (!await isRoomAdmin(userId, roomId)) {
    return c.json({ ok: false, error: 'Only room owner or admin can update settings' }, 403)
  }

  const now = new Date().toISOString()
  const updateData = { ...parsed.data, updatedAt: now }
  if (updateData.name) {
    updateData.name = sanitizeText(updateData.name)
  }
  await db
    .update(rooms)
    .set(updateData)
    .where(eq(rooms.id, roomId))

  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)

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

  await db.delete(rooms).where(eq(rooms.id, roomId))
  return c.json({ ok: true })
})

// Add member to room (owner/admin only)
roomRoutes.post('/:id/members', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = addMemberSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  if (!await isRoomAdmin(userId, roomId)) {
    return c.json({ ok: false, error: 'Only room owner or admin can add members' }, 403)
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
      const [gw] = await db
        .select()
        .from(gateways)
        .where(eq(gateways.id, agent.gatewayId))
        .limit(1)
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
    const code = (err as { code?: string })?.code
    if (code === '23505') {
      return c.json({ ok: false, error: 'Member already in room' }, 409)
    }
    throw err
  }

  await broadcastRoomUpdate(roomId)
  await sendRoomContextToAllAgents(roomId)

  return c.json({ ok: true }, 201)
})

// Remove member from room (owner/admin, or self-leave)
roomRoutes.delete('/:id/members/:memberId', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')
  const memberId = c.req.param('memberId')

  // Self-leave is always allowed; otherwise require owner/admin
  if (memberId !== userId && !await isRoomAdmin(userId, roomId)) {
    return c.json({ ok: false, error: 'Only room owner or admin can remove members' }, 403)
  }

  await db
    .delete(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, memberId)))

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
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, userId)))
    .limit(1)
  if (!member) return c.json({ ok: false, error: 'Not a member' }, 404)

  const pinnedAt = member.pinnedAt ? null : new Date().toISOString()
  await db
    .update(roomMembers)
    .set({ pinnedAt })
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, userId)))

  return c.json({ ok: true, data: { pinned: !!pinnedAt } })
})

// Toggle archive for current user in a room
roomRoutes.put('/:id/archive', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')

  const [member] = await db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, userId)))
    .limit(1)
  if (!member) return c.json({ ok: false, error: 'Not a member' }, 404)

  const archivedAt = member.archivedAt ? null : new Date().toISOString()
  await db
    .update(roomMembers)
    .set({ archivedAt })
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, userId)))

  return c.json({ ok: true, data: { archived: !!archivedAt } })
})

// Update notification preference for current user in a room
roomRoutes.put('/:id/notification-pref', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')
  const body = await c.req.json()
  const pref = body?.pref

  if (!pref || !(NOTIFICATION_PREFS as readonly string[]).includes(pref)) {
    return c.json({ ok: false, error: `Invalid preference. Must be one of: ${NOTIFICATION_PREFS.join(', ')}` }, 400)
  }

  await db
    .update(roomMembers)
    .set({ notificationPref: pref })
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, userId)))

  return c.json({ ok: true })
})

// Get room members
roomRoutes.get('/:id/members', async (c) => {
  const roomId = c.req.param('id')
  const userId = c.get('userId')

  if (!await isRoomMember(userId, roomId)) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId))
  return c.json({ ok: true, data: members })
})
