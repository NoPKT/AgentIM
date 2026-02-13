import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { updateUserSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { sanitizeText } from '../lib/sanitize.js'

export const userRoutes = new Hono<AuthEnv>()

userRoutes.use('*', authMiddleware)

userRoutes.get('/me', async (c) => {
  const userId = c.get('userId')
  const user = db.select().from(users).where(eq(users.id, userId)).get()
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
  db.update(users)
    .set({ ...updateData, updatedAt: now })
    .where(eq(users.id, userId))
    .run()

  const user = db.select().from(users).where(eq(users.id, userId)).get()
  return c.json({
    ok: true,
    data: {
      id: user!.id,
      username: user!.username,
      displayName: user!.displayName,
      avatarUrl: user!.avatarUrl,
      createdAt: user!.createdAt,
      updatedAt: user!.updatedAt,
    },
  })
})
