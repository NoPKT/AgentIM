import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { and, eq, inArray, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { tasks, roomMembers } from '../db/schema.js'
import { createTaskSchema, updateTaskSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { sanitizeText, sanitizeContent } from '../lib/sanitize.js'
import { isRoomMember, isRoomAdmin } from '../lib/roomAccess.js'
import { validateIdParams, parseJsonBody } from '../lib/validation.js'

export const taskRoutes = new Hono<AuthEnv>()

taskRoutes.use('*', authMiddleware)
taskRoutes.use('/:id', validateIdParams)
taskRoutes.use('/rooms/:roomId', validateIdParams)

// List all tasks for current user's rooms
taskRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '') || 50, 1), 100)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '') || 0, 0)

  const memberRows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(eq(roomMembers.memberId, userId), eq(roomMembers.memberType, 'user')))
  const roomIds = memberRows.map((r) => r.roomId)
  if (roomIds.length === 0) {
    return c.json({ ok: true, data: [] })
  }
  const taskList = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.roomId, roomIds))
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset)
  return c.json({ ok: true, data: taskList })
})

// List tasks for a room
taskRoutes.get('/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const userId = c.get('userId')
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '') || 50, 1), 100)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '') || 0, 0)

  if (!(await isRoomMember(userId, roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const taskList = await db
    .select()
    .from(tasks)
    .where(eq(tasks.roomId, roomId))
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset)
  return c.json({ ok: true, data: taskList })
})

// Create task
taskRoutes.post('/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const userId = c.get('userId')

  if (!(await isRoomMember(userId, roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  // Validate assignee is a member of the room
  if (parsed.data.assigneeId) {
    const assigneeType = parsed.data.assigneeType ?? 'user'
    if (!(await isRoomMember(parsed.data.assigneeId, roomId, undefined, assigneeType))) {
      return c.json({ ok: false, error: 'Assignee is not a member of this room' }, 400)
    }
  }

  const id = nanoid()
  const now = new Date().toISOString()

  await db.insert(tasks).values({
    id,
    roomId,
    title: sanitizeText(parsed.data.title),
    description: sanitizeContent(parsed.data.description ?? ''),
    assigneeId: parsed.data.assigneeId,
    assigneeType: parsed.data.assigneeId ? (parsed.data.assigneeType ?? 'user') : parsed.data.assigneeType,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
  return c.json({ ok: true, data: task }, 201)
})

// Update task
// - Status: any room member can update (for kanban workflow)
// - Other fields (title, description, assignee): creator, assignee, or room admin only
taskRoutes.put('/:id', async (c) => {
  const taskId = c.req.param('id')
  const userId = c.get('userId')

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!existing) {
    return c.json({ ok: false, error: 'Task not found' }, 404)
  }

  if (!(await isRoomMember(userId, existing.roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = updateTaskSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  // Check if non-status fields are being modified
  const hasNonStatusFields =
    parsed.data.title !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.assigneeId !== undefined ||
    parsed.data.assigneeType !== undefined

  if (hasNonStatusFields) {
    const isCreator = existing.createdById === userId
    const isAssignee = existing.assigneeId === userId
    const isAdmin = await isRoomAdmin(userId, existing.roomId)
    if (!isCreator && !isAssignee && !isAdmin) {
      return c.json(
        { ok: false, error: 'Only task creator, assignee, or room admin can modify task details' },
        403,
      )
    }
  }

  // Validate assignee consistency: assigneeId and assigneeType must stay paired.
  // If either is set to null, clear both to prevent orphaned fields.
  if (parsed.data.assigneeType === null && parsed.data.assigneeId === undefined) {
    parsed.data.assigneeId = null
  }
  if (parsed.data.assigneeId === null && parsed.data.assigneeType === undefined) {
    parsed.data.assigneeType = null
  }

  // Compute effective values after merging request with existing record.
  // Normalize legacy data: missing assigneeType defaults to 'user' when assigneeId is present
  // (task creation previously allowed omitting assigneeType, storing null in DB).
  const effectiveAssigneeId = parsed.data.assigneeId !== undefined ? parsed.data.assigneeId : existing.assigneeId
  const rawEffectiveType = parsed.data.assigneeType !== undefined ? parsed.data.assigneeType : existing.assigneeType
  const effectiveAssigneeType = effectiveAssigneeId && !rawEffectiveType ? 'user' : rawEffectiveType

  // Reject mismatched combinations that would leave orphaned fields
  if (!effectiveAssigneeId && effectiveAssigneeType) {
    return c.json(
      { ok: false, error: 'assigneeId is required when assigneeType is set' },
      400,
    )
  }

  // If assigneeType changes (non-null) but assigneeId stays the same, re-validate
  if (
    parsed.data.assigneeType !== undefined &&
    parsed.data.assigneeType !== null &&
    parsed.data.assigneeId === undefined &&
    effectiveAssigneeId
  ) {
    if (!(await isRoomMember(effectiveAssigneeId, existing.roomId, undefined, parsed.data.assigneeType as 'user' | 'agent'))) {
      return c.json(
        { ok: false, error: 'Current assignee is not valid for the new assigneeType; provide a new assigneeId' },
        400,
      )
    }
  }

  // Validate assignee is a member of the room
  if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== null) {
    const assigneeType = (effectiveAssigneeType ?? 'user') as 'user' | 'agent'
    if (!(await isRoomMember(parsed.data.assigneeId, existing.roomId, undefined, assigneeType))) {
      return c.json({ ok: false, error: 'Assignee is not a member of this room' }, 400)
    }
  }

  // Validate status transition — prevent nonsensical backwards transitions
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    const TERMINAL_STATUSES = new Set(['completed', 'cancelled'])
    if (TERMINAL_STATUSES.has(existing.status) && parsed.data.status === 'in_progress') {
      return c.json(
        { ok: false, error: `Cannot transition from "${existing.status}" to "in_progress"` },
        400,
      )
    }
  }

  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { updatedAt: now }
  if (parsed.data.title !== undefined) updateData.title = sanitizeText(parsed.data.title)
  if (parsed.data.description !== undefined)
    updateData.description = sanitizeContent(parsed.data.description)
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status
  if (parsed.data.assigneeId !== undefined) updateData.assigneeId = parsed.data.assigneeId
  if (parsed.data.assigneeType !== undefined) updateData.assigneeType = parsed.data.assigneeType
  // Auto-repair legacy data: backfill missing assigneeType when assigneeId is present
  if (existing.assigneeId && !existing.assigneeType && updateData.assigneeType === undefined) {
    updateData.assigneeType = 'user'
  }

  await db.update(tasks).set(updateData).where(eq(tasks.id, taskId))

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  return c.json({ ok: true, data: task })
})

// Delete task (creator or room admin only)
taskRoutes.delete('/:id', async (c) => {
  const taskId = c.req.param('id')
  const userId = c.get('userId')

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!existing) {
    return c.json({ ok: false, error: 'Task not found' }, 404)
  }

  if (!(await isRoomMember(userId, existing.roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const isCreator = existing.createdById === userId
  const isAdmin = await isRoomAdmin(userId, existing.roomId)
  if (!isCreator && !isAdmin) {
    return c.json({ ok: false, error: 'Only task creator or room admin can delete' }, 403)
  }

  await db.delete(tasks).where(eq(tasks.id, taskId))
  return c.json({ ok: true })
})
