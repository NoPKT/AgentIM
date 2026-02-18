import { Hono } from 'hono'
import { sql, and, eq, lt, gt, gte, lte, desc, ilike, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { unlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { db } from '../db/index.js'
import {
  messages,
  roomMembers,
  messageAttachments,
  messageReactions,
  messageEdits,
  users,
} from '../db/schema.js'
import { messageQuerySchema, editMessageSchema } from '@agentim/shared'
import { sensitiveRateLimit } from '../middleware/rateLimit.js'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { connectionManager } from '../ws/connections.js'
import { sanitizeContent } from '../lib/sanitize.js'
import { isRoomMember } from '../lib/roomAccess.js'
import { validateIdParams, parseJsonBody } from '../lib/validation.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('Messages')

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

// Helper: attach attachments to a list of messages
async function attachAttachments(msgs: { id: string; [k: string]: unknown }[]) {
  if (msgs.length === 0) return msgs
  const ids = msgs.map((m) => m.id)
  const attachRows = await db
    .select()
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, ids))

  const attachMap = new Map<string, typeof attachRows>()
  for (const row of attachRows) {
    const list = attachMap.get(row.messageId!) ?? []
    list.push(row)
    attachMap.set(row.messageId!, list)
  }

  return msgs.map((m) => {
    const att = attachMap.get(m.id)
    return att && att.length > 0
      ? {
          ...m,
          attachments: att.map((a) => ({
            id: a.id,
            messageId: a.messageId!,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
            url: a.url,
          })),
        }
      : m
  })
}

export const messageRoutes = new Hono<AuthEnv>()

messageRoutes.use('*', authMiddleware)
messageRoutes.use('/:id/*', validateIdParams)
messageRoutes.use('/:id', validateIdParams)
messageRoutes.use('/rooms/:roomId/*', validateIdParams)
messageRoutes.use('/rooms/:roomId', validateIdParams)

// Get the latest message + unread count for each of the user's rooms
messageRoutes.get('/recent', async (c) => {
  const userId = c.get('userId')

  // Single CTE query: latest message + unread count per room (replaces 2N queries)
  const rows = await db.execute<{
    room_id: string
    content: string
    sender_name: string
    created_at: string
    unread: number
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (m.room_id)
        m.room_id, m.content, m.sender_name, m.created_at
      FROM messages m
      JOIN room_members rm ON rm.room_id = m.room_id AND rm.member_id = ${userId}
      ORDER BY m.room_id, m.created_at DESC
    ),
    unreads AS (
      SELECT rm.room_id, COUNT(m.id)::int as unread
      FROM room_members rm
      LEFT JOIN messages m ON m.room_id = rm.room_id
        AND (rm.last_read_at IS NULL OR m.created_at > rm.last_read_at)
      WHERE rm.member_id = ${userId}
      GROUP BY rm.room_id
    )
    SELECT l.room_id, l.content, l.sender_name, l.created_at,
           COALESCE(u.unread, 0)::int as unread
    FROM latest l
    LEFT JOIN unreads u ON u.room_id = l.room_id
    UNION ALL
    SELECT u.room_id, ''::text, ''::text, ''::text, u.unread
    FROM unreads u
    WHERE u.room_id NOT IN (SELECT room_id FROM latest)
      AND u.unread > 0
  `)

  const result: Record<
    string,
    { content: string; senderName: string; createdAt: string; unread: number }
  > = {}
  for (const row of rows.rows) {
    result[row.room_id] = {
      content: row.content,
      senderName: row.sender_name,
      createdAt: row.created_at,
      unread: row.unread,
    }
  }

  return c.json({ ok: true, data: result })
})

// Mark all rooms as read for the current user
messageRoutes.post('/mark-all-read', async (c) => {
  const userId = c.get('userId')
  const username = c.get('username')
  const now = new Date().toISOString()

  // Get all rooms the user belongs to
  const memberRows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(eq(roomMembers.memberId, userId))

  if (memberRows.length > 0) {
    await db.update(roomMembers).set({ lastReadAt: now }).where(eq(roomMembers.memberId, userId))

    // Broadcast read receipts to all rooms
    for (const row of memberRows) {
      connectionManager.broadcastToRoom(row.roomId, {
        type: 'server:read_receipt',
        roomId: row.roomId,
        userId,
        username,
        lastReadAt: now,
      })
    }
  }

  return c.json({ ok: true })
})

// Mark a room as read for the current user
messageRoutes.post('/rooms/:roomId/read', async (c) => {
  const userId = c.get('userId')
  const username = c.get('username')
  const roomId = c.req.param('roomId')

  if (!(await isRoomMember(userId, roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const now = new Date().toISOString()

  await db
    .update(roomMembers)
    .set({ lastReadAt: now })
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, userId)))

  // Broadcast read receipt to room members
  connectionManager.broadcastToRoom(roomId, {
    type: 'server:read_receipt',
    roomId,
    userId,
    username,
    lastReadAt: now,
  })

  return c.json({ ok: true })
})

// Search messages across user's rooms
messageRoutes.get('/search', sensitiveRateLimit, async (c) => {
  const userId = c.get('userId')
  const q = c.req.query('q')?.trim()
  const roomId = c.req.query('roomId')
  const limitRaw = parseInt(c.req.query('limit') ?? '20', 10)
  const limit = Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : Math.min(limitRaw, 50)

  if (!q || q.length < 2) {
    return c.json({ ok: false, error: 'Query must be at least 2 characters' }, 400)
  }
  if (q.length > 200) {
    return c.json({ ok: false, error: 'Query must be at most 200 characters' }, 400)
  }

  // Get rooms the user belongs to
  const memberRows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(eq(roomMembers.memberId, userId))
  const userRoomIds = new Set(memberRows.map((m) => m.roomId))

  if (roomId && !userRoomIds.has(roomId)) {
    return c.json({ ok: false, error: 'Room not found' }, 404)
  }

  const sender = c.req.query('sender')?.trim().slice(0, 100)
  const dateFrom = c.req.query('from')?.trim()
  const dateTo = c.req.query('to')?.trim()

  if (dateFrom && isNaN(new Date(dateFrom).getTime())) {
    return c.json({ ok: false, error: 'Invalid "from" date format' }, 400)
  }
  if (dateTo && isNaN(new Date(dateTo).getTime())) {
    return c.json({ ok: false, error: 'Invalid "to" date format' }, 400)
  }

  const searchPattern = `%${q}%`
  const filters = [
    roomId ? eq(messages.roomId, roomId) : inArray(messages.roomId, [...userRoomIds]),
    ilike(messages.content, searchPattern),
  ]
  if (sender) filters.push(ilike(messages.senderName, `%${sender}%`))
  if (dateFrom) filters.push(gte(messages.createdAt, new Date(dateFrom).toISOString()))
  if (dateTo) filters.push(lte(messages.createdAt, new Date(dateTo).toISOString()))

  const conditions = and(...filters)

  const rows = await db
    .select()
    .from(messages)
    .where(conditions)
    .orderBy(desc(messages.createdAt))
    .limit(limit)

  const parsed = rows.map((m) => ({
    ...m,
    mentions: safeJsonParse(m.mentions, []),
    chunks: m.chunks ? safeJsonParse(m.chunks, undefined) : undefined,
  }))

  return c.json({
    ok: true,
    data: await attachReactions(await attachAttachments(parsed)),
  })
})

// Get messages for a room (cursor-based pagination)
messageRoutes.get('/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const userId = c.get('userId')

  if (!(await isRoomMember(userId, roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const query = messageQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const { cursor, limit } = query.data
  const after = c.req.query('after')

  let rows
  if (after) {
    // Forward sync: get messages newer than `after` timestamp
    rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.roomId, roomId), gt(messages.createdAt, after)))
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1)
  } else if (cursor) {
    rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.roomId, roomId), lt(messages.createdAt, cursor)))
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1)
  } else {
    rows = await db
      .select()
      .from(messages)
      .where(eq(messages.roomId, roomId))
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1)
  }

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  const parsed = items.map((m) => ({
    ...m,
    mentions: safeJsonParse(m.mentions, []),
    chunks: m.chunks ? safeJsonParse(m.chunks, undefined) : undefined,
  }))

  return c.json({
    ok: true,
    data: {
      items: await attachReactions(await attachAttachments(parsed)),
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt : undefined,
      hasMore,
    },
  })
})

// Toggle a reaction on a message
messageRoutes.post('/:id/reactions', async (c) => {
  const messageId = c.req.param('id')
  const userId = c.get('userId')
  const username = c.get('username')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const emoji = (body as Record<string, unknown>)?.emoji

  if (!emoji || typeof emoji !== 'string' || emoji.length > 8) {
    return c.json({ ok: false, error: 'Invalid emoji' }, 400)
  }

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1)
  if (!msg) {
    return c.json({ ok: false, error: 'Message not found' }, 404)
  }

  if (!(await isRoomMember(userId, msg.roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  // Check if user already reacted with this emoji
  const [existing] = await db
    .select()
    .from(messageReactions)
    .where(
      and(
        eq(messageReactions.messageId, messageId),
        eq(messageReactions.userId, userId),
        eq(messageReactions.emoji, emoji),
      ),
    )
    .limit(1)

  if (existing) {
    // Remove reaction
    await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, emoji),
        ),
      )
  } else {
    // Check per-user reaction limit on this message (max 20 distinct emojis)
    const [{ count: reactionCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messageReactions)
      .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId)))
    if (reactionCount >= 20) {
      return c.json({ ok: false, error: 'Maximum reactions per message reached' }, 400)
    }

    // Add reaction
    const now = new Date().toISOString()
    await db.insert(messageReactions).values({
      messageId,
      userId,
      emoji,
      createdAt: now,
    })
  }

  // Fetch updated reactions for this message
  const reactions = await getMessageReactions(messageId)

  // Broadcast to room
  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:reaction_update',
    roomId: msg.roomId,
    messageId,
    reactions,
  })

  return c.json({ ok: true, data: reactions })
})

// Helper: get aggregated reactions for a message
async function getMessageReactions(messageId: string) {
  const rows = await db
    .select({
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
      username: users.username,
    })
    .from(messageReactions)
    .innerJoin(users, eq(messageReactions.userId, users.id))
    .where(eq(messageReactions.messageId, messageId))

  const emojiMap = new Map<string, { userIds: string[]; usernames: string[] }>()
  for (const row of rows) {
    const entry = emojiMap.get(row.emoji) ?? { userIds: [], usernames: [] }
    entry.userIds.push(row.userId)
    entry.usernames.push(row.username)
    emojiMap.set(row.emoji, entry)
  }

  return [...emojiMap.entries()].map(([emoji, { userIds, usernames }]) => ({
    emoji,
    userIds,
    usernames,
  }))
}

// Helper: attach reactions to a list of messages
async function attachReactions(msgs: { id: string; [k: string]: unknown }[]) {
  if (msgs.length === 0) return msgs
  const ids = msgs.map((m) => m.id)
  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
      username: users.username,
    })
    .from(messageReactions)
    .innerJoin(users, eq(messageReactions.userId, users.id))
    .where(inArray(messageReactions.messageId, ids))

  // Group by messageId → emoji
  const map = new Map<string, Map<string, { userIds: string[]; usernames: string[] }>>()
  for (const row of rows) {
    let emojiMap = map.get(row.messageId)
    if (!emojiMap) {
      emojiMap = new Map()
      map.set(row.messageId, emojiMap)
    }
    const entry = emojiMap.get(row.emoji) ?? { userIds: [], usernames: [] }
    entry.userIds.push(row.userId)
    entry.usernames.push(row.username)
    emojiMap.set(row.emoji, entry)
  }

  return msgs.map((m) => {
    const emojiMap = map.get(m.id)
    if (!emojiMap) return m
    const reactions = [...emojiMap.entries()].map(([emoji, { userIds, usernames }]) => ({
      emoji,
      userIds,
      usernames,
    }))
    return { ...m, reactions }
  })
}

// Get edit history for a message
messageRoutes.get('/:id/history', async (c) => {
  const messageId = c.req.param('id')
  const userId = c.get('userId')

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1)
  if (!msg) {
    return c.json({ ok: false, error: 'Message not found' }, 404)
  }

  if (!(await isRoomMember(userId, msg.roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }

  const edits = await db
    .select()
    .from(messageEdits)
    .where(eq(messageEdits.messageId, messageId))
    .orderBy(desc(messageEdits.editedAt))
    .limit(100)

  return c.json({ ok: true, data: edits })
})

// Edit a message (only the sender can edit)
messageRoutes.put('/:id', async (c) => {
  const messageId = c.req.param('id')
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = editMessageSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1)
  if (!msg) {
    return c.json({ ok: false, error: 'Message not found' }, 404)
  }
  if (!(await isRoomMember(userId, msg.roomId))) {
    return c.json({ ok: false, error: 'Not a member of this room' }, 403)
  }
  if (msg.senderId !== userId || msg.senderType !== 'user') {
    return c.json({ ok: false, error: 'Only the sender can edit this message' }, 403)
  }

  const now = new Date().toISOString()
  const content = sanitizeContent(parsed.data.content)

  // Atomic: save edit history + update message in a single transaction
  const [updated] = await db.transaction(async (tx) => {
    await tx.insert(messageEdits).values({
      id: nanoid(),
      messageId,
      previousContent: msg.content,
      editedAt: now,
    })

    return tx
      .update(messages)
      .set({ content, updatedAt: now })
      .where(eq(messages.id, messageId))
      .returning()
  })

  const message = {
    ...updated!,
    mentions: safeJsonParse(updated!.mentions, []),
    chunks: updated!.chunks ? safeJsonParse(updated!.chunks, undefined) : undefined,
  }

  // Broadcast edit to room
  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:message_edited',
    message,
  })

  return c.json({ ok: true, data: message })
})

// Delete a message (only the sender can delete)
messageRoutes.delete('/:id', async (c) => {
  const messageId = c.req.param('id')
  const userId = c.get('userId')

  // Use transaction to prevent TOCTOU between permission check and delete
  // Collect attachment URLs inside the transaction, delete files after commit
  const result = await db.transaction(async (tx) => {
    const [msg] = await tx.select().from(messages).where(eq(messages.id, messageId)).limit(1)
    if (!msg) return { error: 'Message not found', status: 404 as const }
    if (!(await isRoomMember(userId, msg.roomId))) return { error: 'Not a member of this room', status: 403 as const }
    if (msg.senderId !== userId || msg.senderType !== 'user') return { error: 'Only the sender can delete this message', status: 403 as const }

    // Collect attachment URLs to delete after transaction commits
    const attachments = await tx
      .select({ url: messageAttachments.url })
      .from(messageAttachments)
      .where(eq(messageAttachments.messageId, messageId))

    await tx.delete(messages).where(eq(messages.id, messageId))
    return { roomId: msg.roomId, attachmentUrls: attachments.map((a) => a.url) }
  })

  if ('error' in result) {
    return c.json({ ok: false, error: result.error }, result.status)
  }

  // Clean up physical attachment files after transaction success
  for (const url of result.attachmentUrls) {
    try {
      const filename = basename(url)
      await unlink(resolve(config.uploadDir, filename))
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        log.warn(`Failed to delete attachment file ${url}: ${err?.message}`)
      }
    }
  }

  // Broadcast deletion to room
  connectionManager.broadcastToRoom(result.roomId, {
    type: 'server:message_deleted',
    roomId: result.roomId,
    messageId,
  })

  return c.json({ ok: true })
})
