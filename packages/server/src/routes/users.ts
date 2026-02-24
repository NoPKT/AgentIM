import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { hash, verify } from 'argon2'
import { db } from '../db/index.js'
import {
  users,
  rooms,
  tasks,
  roomMembers,
  refreshTokens,
  messageAttachments,
  messages,
} from '../db/schema.js'
import {
  updateUserSchema,
  changePasswordSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
} from '@agentim/shared'
import {
  authMiddleware,
  adminMiddleware,
  invalidateAdminCache,
  type AuthEnv,
} from '../middleware/auth.js'
import { sensitiveRateLimit } from '../middleware/rateLimit.js'
import { basename } from 'node:path'
import { sanitizeText } from '../lib/sanitize.js'
import { parseQueryInt } from '../lib/validation.js'
import { logAudit, getClientIp } from '../lib/audit.js'
import { revokeUserTokens } from '../lib/tokenRevocation.js'
import { connectionManager } from '../ws/connections.js'
import { validateIdParams, parseJsonBody, formatZodError } from '../lib/validation.js'
import { cacheDel, userCacheKey } from '../lib/cache.js'
import { getStorage } from '../storage/index.js'

export const userRoutes = new Hono<AuthEnv>()

userRoutes.use('*', authMiddleware)
userRoutes.use('/:id', validateIdParams)

// ─── Current User ───

userRoutes.get('/me', async (c) => {
  const userId = c.get('userId')
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) {
    return c.json({ ok: false, error: 'User not found' }, 404)
  }

  return c.json({
    ok: true,
    data: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  })
})

userRoutes.put('/me', async (c) => {
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = updateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const now = new Date().toISOString()
  const updateData = { ...parsed.data }
  if (updateData.displayName) {
    updateData.displayName = sanitizeText(updateData.displayName)
  }
  await db
    .update(users)
    .set({ ...updateData, updatedAt: now })
    .where(eq(users.id, userId))

  await cacheDel(userCacheKey(userId))

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return c.json({
    ok: true,
    data: {
      id: user!.id,
      username: user!.username,
      displayName: user!.displayName,
      avatarUrl: user!.avatarUrl,
      role: user!.role,
      createdAt: user!.createdAt,
      updatedAt: user!.updatedAt,
    },
  })
})

// ─── Change Password (any user) ───

userRoutes.put('/me/password', sensitiveRateLimit, async (c) => {
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = changePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) {
    return c.json({ ok: false, error: 'User not found' }, 404)
  }

  const valid = await verify(user.passwordHash, parsed.data.currentPassword)
  if (!valid) {
    return c.json({ ok: false, error: 'Current password is incorrect' }, 400)
  }

  const passwordHash = await hash(parsed.data.newPassword)
  const now = new Date().toISOString()
  await db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId))

  // Invalidate all refresh tokens so other sessions must re-login
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
  // Revoke all outstanding access tokens. Best-effort: refresh tokens are
  // already deleted, so no new access tokens can be obtained even if Redis
  // is temporarily unavailable. Existing access tokens expire within TTL.
  try {
    await revokeUserTokens(userId)
  } catch {
    // Error already logged inside revokeUserTokens — continue
  }
  connectionManager.disconnectUser(userId)
  logAudit({ userId, action: 'password_change', ipAddress: getClientIp(c) })

  return c.json({ ok: true })
})

// ─── Admin User Management ───

userRoutes.get('/', adminMiddleware, async (c) => {
  const limit = parseQueryInt(c.req.query('limit'), 100, 1, 500)
  const offset = parseQueryInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER)

  const result = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      maxWsConnections: users.maxWsConnections,
      maxGateways: users.maxGateways,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .orderBy(users.createdAt)
    .limit(limit)
    .offset(offset)

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users)
  return c.json({ ok: true, data: result, total: count })
})

userRoutes.post('/', adminMiddleware, async (c) => {
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = adminCreateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const { username, password, displayName: rawDisplayName, role } = parsed.data
  const displayName = rawDisplayName ? sanitizeText(rawDisplayName) : username

  const id = nanoid()
  const now = new Date().toISOString()
  const passwordHash = await hash(password)

  try {
    await db.insert(users).values({
      id,
      username,
      passwordHash,
      displayName,
      role,
      createdAt: now,
      updatedAt: now,
    })
  } catch (err: unknown) {
    // Handle unique constraint violation (concurrent insert or existing user)
    if (((err as any)?.code ?? (err as any)?.cause?.code) === '23505') {
      return c.json({ ok: false, error: 'Username already taken' }, 409)
    }
    throw err
  }

  logAudit({
    userId: c.get('userId'),
    action: 'user_create',
    targetId: id,
    targetType: 'user',
    ipAddress: getClientIp(c),
  })

  return c.json({
    ok: true,
    data: { id, username, displayName, role, createdAt: now, updatedAt: now },
  })
})

userRoutes.put('/:id', adminMiddleware, async (c) => {
  const targetId = c.req.param('id')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = adminUpdateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1)
  if (!target) {
    return c.json({ ok: false, error: 'User not found' }, 404)
  }

  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { updatedAt: now }
  if (parsed.data.displayName) {
    updateData.displayName = sanitizeText(parsed.data.displayName)
  }
  if (parsed.data.role) {
    if (targetId === c.get('userId') && parsed.data.role !== 'admin') {
      return c.json({ ok: false, error: 'Cannot demote yourself' }, 400)
    }
    updateData.role = parsed.data.role
    // Invalidate admin role cache when role changes
    invalidateAdminCache(targetId)
  }
  if (parsed.data.password) {
    updateData.passwordHash = await hash(parsed.data.password)
  }
  if (parsed.data.maxWsConnections !== undefined) {
    updateData.maxWsConnections = parsed.data.maxWsConnections
  }
  if (parsed.data.maxGateways !== undefined) {
    updateData.maxGateways = parsed.data.maxGateways
  }

  await db.update(users).set(updateData).where(eq(users.id, targetId))

  // If password was changed by admin, revoke target user's tokens and disconnect sessions
  if (parsed.data.password) {
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, targetId))
    try {
      await revokeUserTokens(targetId)
    } catch {
      // Error already logged inside revokeUserTokens — continue
    }
    connectionManager.disconnectUser(targetId)
  }

  logAudit({
    userId: c.get('userId'),
    action: 'user_update',
    targetId,
    targetType: 'user',
    ipAddress: getClientIp(c),
  })

  const [updated] = await db.select().from(users).where(eq(users.id, targetId)).limit(1)
  return c.json({
    ok: true,
    data: {
      id: updated!.id,
      username: updated!.username,
      displayName: updated!.displayName,
      role: updated!.role,
      maxWsConnections: updated!.maxWsConnections,
      maxGateways: updated!.maxGateways,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    },
  })
})

userRoutes.delete('/:id', adminMiddleware, async (c) => {
  const targetId = c.req.param('id')
  const adminId = c.get('userId')

  if (targetId === adminId) {
    return c.json({ ok: false, error: 'Cannot delete yourself' }, 400)
  }

  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1)
  if (!target) {
    return c.json({ ok: false, error: 'User not found' }, 404)
  }

  // Collect all storage keys that will be deleted (cascade or direct)
  // so we can delete files from storage after the transaction succeeds.
  const filesToDelete: string[] = []
  try {
    // 1. Avatar (from user record)
    if (target.avatarUrl) {
      filesToDelete.push(basename(target.avatarUrl))
    }

    // 2. Attachments in rooms created by this user (will cascade-delete)
    const userRoomIds = (
      await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.createdById, targetId))
    ).map((r) => r.id)
    if (userRoomIds.length > 0) {
      const roomMsgIds = (
        await db
          .select({ id: messages.id })
          .from(messages)
          .where(inArray(messages.roomId, userRoomIds))
      ).map((m) => m.id)
      if (roomMsgIds.length > 0) {
        const cascadeAttachments = await db
          .select({ url: messageAttachments.url })
          .from(messageAttachments)
          .where(inArray(messageAttachments.messageId, roomMsgIds))
        for (const a of cascadeAttachments) {
          filesToDelete.push(basename(a.url))
        }
      }
    }

    // 3. Orphan attachments uploaded by this user (no message linked)
    const orphanAttachments = await db
      .select({ url: messageAttachments.url })
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.uploadedBy, targetId),
          sql`${messageAttachments.messageId} IS NULL`,
        ),
      )
    for (const a of orphanAttachments) {
      filesToDelete.push(basename(a.url))
    }
  } catch {
    // Non-fatal: DB queries may fail in edge cases
  }

  // Clean up all related resources in a transaction
  try {
    await revokeUserTokens(targetId)
  } catch {
    // Error already logged inside revokeUserTokens — continue with deletion
  }
  connectionManager.disconnectUser(targetId)
  await db.transaction(async (tx) => {
    // Delete rooms created by this user (cascades: room_members, messages, tasks in those rooms)
    await tx.delete(rooms).where(eq(rooms.createdById, targetId))
    // Delete remaining tasks created by this user in other rooms
    await tx.delete(tasks).where(eq(tasks.createdById, targetId))
    // Clear task assignments where user is assignee (preserve task, just remove assignee)
    await tx
      .update(tasks)
      .set({ assigneeId: null, assigneeType: null })
      .where(eq(tasks.assigneeId, targetId))
    // Remove user from rooms they're a member of (but didn't create)
    await tx
      .delete(roomMembers)
      .where(and(eq(roomMembers.memberId, targetId), eq(roomMembers.memberType, 'user')))
    // Delete orphan attachments uploaded by this user (not linked to any message)
    await tx
      .delete(messageAttachments)
      .where(
        and(
          eq(messageAttachments.uploadedBy, targetId),
          sql`${messageAttachments.messageId} IS NULL`,
        ),
      )
    // Clear uploadedBy for linked attachments (preserve message integrity)
    await tx
      .update(messageAttachments)
      .set({ uploadedBy: null })
      .where(eq(messageAttachments.uploadedBy, targetId))
    // Delete user (cascades: refreshTokens, gateways→agents, routers, auditLogs set null)
    await tx.delete(users).where(eq(users.id, targetId))
  })

  // Delete files from storage after transaction succeeds (best-effort)
  const storage = getStorage()
  for (const filename of filesToDelete) {
    try {
      await storage.delete(filename)
    } catch {
      /* file may already be gone */
    }
  }
  logAudit({
    userId: adminId,
    action: 'user_delete',
    targetId,
    targetType: 'user',
    metadata: { username: target.username },
    ipAddress: getClientIp(c),
  })
  return c.json({ ok: true })
})
