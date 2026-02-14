import { Hono } from 'hono'
import { and, eq, lt, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { messages, roomMembers } from '../db/schema.js'
import { messageQuerySchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'

export const messageRoutes = new Hono<AuthEnv>()

messageRoutes.use('*', authMiddleware)

// Get the latest message for each of the user's rooms
messageRoutes.get('/recent', async (c) => {
  const userId = c.get('userId')
  const memberRows = db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(eq(roomMembers.memberId, userId))
    .all()

  const roomIds = memberRows.map((m) => m.roomId)
  if (roomIds.length === 0) {
    return c.json({ ok: true, data: {} })
  }

  // Get latest message per room (one query per room, but room count is typically small)
  const result: Record<string, { content: string; senderName: string; createdAt: string }> = {}
  for (const roomId of roomIds) {
    const row = db
      .select()
      .from(messages)
      .where(eq(messages.roomId, roomId))
      .orderBy(desc(messages.createdAt))
      .limit(1)
      .get()
    if (row) {
      result[roomId] = {
        content: row.content,
        senderName: row.senderName,
        createdAt: row.createdAt,
      }
    }
  }

  return c.json({ ok: true, data: result })
})

// Get messages for a room (cursor-based pagination)
messageRoutes.get('/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const query = messageQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const { cursor, limit } = query.data

  let rows
  if (cursor) {
    rows = db
      .select()
      .from(messages)
      .where(and(eq(messages.roomId, roomId), lt(messages.createdAt, cursor)))
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1)
      .all()
  } else {
    rows = db
      .select()
      .from(messages)
      .where(eq(messages.roomId, roomId))
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1)
      .all()
  }

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return c.json({
    ok: true,
    data: {
      items: items.map((m) => ({
        ...m,
        mentions: JSON.parse(m.mentions),
      })),
      nextCursor: hasMore ? items[items.length - 1].createdAt : undefined,
      hasMore,
    },
  })
})
