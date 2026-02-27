import { Hono } from 'hono'
import { eq, and, desc, lt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { bookmarks, messages } from '../db/schema.js'
import { createBookmarkSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { validateIdParams, parseJsonBody, formatZodError } from '../lib/validation.js'

const BOOKMARKS_DEFAULT_LIMIT = 50
const BOOKMARKS_MAX_LIMIT = 100

export const bookmarkRoutes = new Hono<AuthEnv>()

bookmarkRoutes.use('*', authMiddleware)
bookmarkRoutes.use('/:id', validateIdParams)

// List user's bookmarks (cursor-based pagination)
bookmarkRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const cursor = c.req.query('cursor')
  const limit = Math.min(
    Math.max(
      parseInt(c.req.query('limit') ?? String(BOOKMARKS_DEFAULT_LIMIT), 10) ||
        BOOKMARKS_DEFAULT_LIMIT,
      1,
    ),
    BOOKMARKS_MAX_LIMIT,
  )

  const conditions = cursor
    ? and(eq(bookmarks.userId, userId), lt(bookmarks.createdAt, cursor))
    : eq(bookmarks.userId, userId)

  const rows = await db
    .select({
      id: bookmarks.id,
      userId: bookmarks.userId,
      messageId: bookmarks.messageId,
      note: bookmarks.note,
      createdAt: bookmarks.createdAt,
      // Join message fields for convenience
      roomId: messages.roomId,
      senderName: messages.senderName,
      content: messages.content,
      messageCreatedAt: messages.createdAt,
    })
    .from(bookmarks)
    .innerJoin(messages, eq(bookmarks.messageId, messages.id))
    .where(conditions)
    .orderBy(desc(bookmarks.createdAt))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  return c.json({
    ok: true,
    data: {
      items: items.map((row) => ({
        id: row.id,
        userId: row.userId,
        messageId: row.messageId,
        note: row.note ?? '',
        createdAt: row.createdAt,
        message: {
          roomId: row.roomId,
          senderName: row.senderName,
          content: row.content,
          createdAt: row.messageCreatedAt,
        },
      })),
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt : undefined,
      hasMore,
    },
  })
})

// Create a bookmark
bookmarkRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body

  const parsed = createBookmarkSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const { messageId, note } = parsed.data

  // Verify the message exists
  const [msg] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1)

  if (!msg) {
    return c.json({ ok: false, error: 'Message not found' }, 404)
  }

  // Check for duplicate bookmark
  const [existing] = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.messageId, messageId)))
    .limit(1)

  if (existing) {
    return c.json({ ok: false, error: 'Bookmark already exists' }, 409)
  }

  const id = nanoid()
  const now = new Date().toISOString()

  const [bookmark] = await db
    .insert(bookmarks)
    .values({
      id,
      userId,
      messageId,
      note,
      createdAt: now,
    })
    .returning()

  return c.json(
    {
      ok: true,
      data: {
        id: bookmark.id,
        userId: bookmark.userId,
        messageId: bookmark.messageId,
        note: bookmark.note ?? '',
        createdAt: bookmark.createdAt,
      },
    },
    201,
  )
})

// Delete a bookmark
bookmarkRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const bookmarkId = c.req.param('id')

  const [bookmark] = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.userId, userId)))
    .limit(1)

  if (!bookmark) {
    return c.json({ ok: false, error: 'Bookmark not found' }, 404)
  }

  await db.delete(bookmarks).where(eq(bookmarks.id, bookmarkId))

  return c.json({ ok: true, data: { id: bookmarkId } })
})
