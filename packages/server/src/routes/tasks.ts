import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { tasks, roomMembers } from '../db/schema.js'
import { createTaskSchema, updateTaskSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { sanitizeText, sanitizeContent } from '../lib/sanitize.js'

export const taskRoutes = new Hono<AuthEnv>()

taskRoutes.use('*', authMiddleware)

// List all tasks for current user's rooms
taskRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const memberRows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(eq(roomMembers.memberId, userId))
  const roomIds = memberRows.map((r) => r.roomId)
  if (roomIds.length === 0) {
    return c.json({ ok: true, data: [] })
  }
  const taskList = await db.select().from(tasks).where(inArray(tasks.roomId, roomIds))
  return c.json({ ok: true, data: taskList })
})

// List tasks for a room
taskRoutes.get('/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const taskList = await db.select().from(tasks).where(eq(tasks.roomId, roomId))
  return c.json({ ok: true, data: taskList })
})

// Create task
taskRoutes.post('/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const id = nanoid()
  const now = new Date().toISOString()

  await db.insert(tasks).values({
    id,
    roomId,
    title: sanitizeText(parsed.data.title),
    description: sanitizeContent(parsed.data.description ?? ''),
    assigneeId: parsed.data.assigneeId,
    assigneeType: parsed.data.assigneeType,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
  return c.json({ ok: true, data: task }, 201)
})

// Update task
taskRoutes.put('/:id', async (c) => {
  const taskId = c.req.param('id')
  const body = await c.req.json()
  const parsed = updateTaskSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { updatedAt: now }
  if (parsed.data.title !== undefined) updateData.title = sanitizeText(parsed.data.title)
  if (parsed.data.description !== undefined) updateData.description = sanitizeContent(parsed.data.description)
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status
  if (parsed.data.assigneeId !== undefined) updateData.assigneeId = parsed.data.assigneeId
  if (parsed.data.assigneeType !== undefined) updateData.assigneeType = parsed.data.assigneeType

  await db.update(tasks).set(updateData).where(eq(tasks.id, taskId))

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  return c.json({ ok: true, data: task })
})

// Delete task
taskRoutes.delete('/:id', async (c) => {
  const taskId = c.req.param('id')
  await db.delete(tasks).where(eq(tasks.id, taskId))
  return c.json({ ok: true })
})
