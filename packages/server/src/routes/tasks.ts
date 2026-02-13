import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { tasks } from '../db/schema.js'
import { createTaskSchema, updateTaskSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'

export const taskRoutes = new Hono<AuthEnv>()

taskRoutes.use('*', authMiddleware)

// List tasks for a room
taskRoutes.get('/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const taskList = db.select().from(tasks).where(eq(tasks.roomId, roomId)).all()
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

  db.insert(tasks)
    .values({
      id,
      roomId,
      title: parsed.data.title,
      description: parsed.data.description,
      assigneeId: parsed.data.assigneeId,
      assigneeType: parsed.data.assigneeType,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const task = db.select().from(tasks).where(eq(tasks.id, id)).get()
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
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status
  if (parsed.data.assigneeId !== undefined) updateData.assigneeId = parsed.data.assigneeId
  if (parsed.data.assigneeType !== undefined) updateData.assigneeType = parsed.data.assigneeType

  db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).run()

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()
  return c.json({ ok: true, data: task })
})

// Delete task
taskRoutes.delete('/:id', async (c) => {
  const taskId = c.req.param('id')
  db.delete(tasks).where(eq(tasks.id, taskId)).run()
  return c.json({ ok: true })
})
