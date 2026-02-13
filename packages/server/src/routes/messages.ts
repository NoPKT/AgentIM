import { Hono } from 'hono'
import { and, eq, lt, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { messages } from '../db/schema.js'
import { messageQuerySchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'

export const messageRoutes = new Hono<AuthEnv>()

messageRoutes.use('*', authMiddleware)

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
