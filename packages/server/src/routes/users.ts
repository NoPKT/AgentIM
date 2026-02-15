import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, ne, sql } from 'drizzle-orm'
import { hash, verify } from 'argon2'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { updateUserSchema, changePasswordSchema, adminCreateUserSchema, adminUpdateUserSchema } from '@agentim/shared'
import { authMiddleware, adminMiddleware, type AuthEnv } from '../middleware/auth.js'
import { sanitizeText } from '../lib/sanitize.js'

export const userRoutes = new Hono<AuthEnv>()

userRoutes.use('*', authMiddleware)

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
  const body = await c.req.json()
  const parsed = updateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
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

userRoutes.put('/me/password', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = changePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
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

  return c.json({ ok: true })
})

// ─── Admin User Management ───

userRoutes.get('/', adminMiddleware, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 500)
  const offset = Number(c.req.query('offset')) || 0

  const result = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: users.role,
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
  const body = await c.req.json()
  const parsed = adminCreateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten() }, 400)
  }

  const { username, password, displayName: rawDisplayName, role } = parsed.data
  const displayName = rawDisplayName ? sanitizeText(rawDisplayName) : username

  const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1)
  if (existing) {
    return c.json({ ok: false, error: 'Username already taken' }, 409)
  }

  const id = nanoid()
  const now = new Date().toISOString()
  const passwordHash = await hash(password)

  await db.insert(users).values({
    id,
    username,
    passwordHash,
    displayName,
    role,
    createdAt: now,
    updatedAt: now,
  })

  return c.json({
    ok: true,
    data: { id, username, displayName, role, createdAt: now, updatedAt: now },
  })
})

userRoutes.put('/:id', adminMiddleware, async (c) => {
  const targetId = c.req.param('id')
  const body = await c.req.json()
  const parsed = adminUpdateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
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
    updateData.role = parsed.data.role
  }
  if (parsed.data.password) {
    updateData.passwordHash = await hash(parsed.data.password)
  }

  await db.update(users).set(updateData).where(eq(users.id, targetId))

  const [updated] = await db.select().from(users).where(eq(users.id, targetId)).limit(1)
  return c.json({
    ok: true,
    data: {
      id: updated!.id,
      username: updated!.username,
      displayName: updated!.displayName,
      role: updated!.role,
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

  await db.delete(users).where(eq(users.id, targetId))
  return c.json({ ok: true })
})
