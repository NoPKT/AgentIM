import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rooms, roomMembers } from '../db/schema.js'
import { createRoomSchema, updateRoomSchema, addMemberSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { sanitizeText } from '../lib/sanitize.js'

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

  return c.json({ ok: true, data: roomList })
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

  await db.insert(rooms).values({
    id,
    name: sanitizeText(parsed.data.name),
    type: parsed.data.type,
    broadcastMode: parsed.data.broadcastMode,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Add creator as owner
  await db.insert(roomMembers).values({
    roomId: id,
    memberId: userId,
    memberType: 'user',
    role: 'owner',
    joinedAt: now,
  })

  // Add additional members
  if (parsed.data.memberIds) {
    for (const memberId of parsed.data.memberIds) {
      await db.insert(roomMembers).values({
        roomId: id,
        memberId,
        memberType: 'user',
        role: 'member',
        joinedAt: now,
      })
    }
  }

  const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1)
  return c.json({ ok: true, data: room }, 201)
})

// Get room by id
roomRoutes.get('/:id', async (c) => {
  const roomId = c.req.param('id')
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) {
    return c.json({ ok: false, error: 'Room not found' }, 404)
  }

  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId))
  return c.json({ ok: true, data: { ...room, members } })
})

// Update room
roomRoutes.put('/:id', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json()
  const parsed = updateRoomSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
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

// Add member to room
roomRoutes.post('/:id/members', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json()
  const parsed = addMemberSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const now = new Date().toISOString()
  try {
    await db.insert(roomMembers).values({
      roomId,
      memberId: parsed.data.memberId,
      memberType: parsed.data.memberType,
      role: parsed.data.role,
      joinedAt: now,
    })
  } catch {
    return c.json({ ok: false, error: 'Member already in room' }, 409)
  }

  return c.json({ ok: true }, 201)
})

// Remove member from room
roomRoutes.delete('/:id/members/:memberId', async (c) => {
  const roomId = c.req.param('id')
  const memberId = c.req.param('memberId')

  await db
    .delete(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, memberId)))

  return c.json({ ok: true })
})

// Get room members
roomRoutes.get('/:id/members', async (c) => {
  const roomId = c.req.param('id')
  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId))
  return c.json({ ok: true, data: members })
})
