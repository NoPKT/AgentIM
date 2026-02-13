import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { hash, verify } from 'argon2'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users, refreshTokens } from '../db/schema.js'
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js'
import { registerSchema, loginSchema, refreshSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'

export const authRoutes = new Hono<AuthEnv>()

authRoutes.post('/register', async (c) => {
  const body = await c.req.json()
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten() }, 400)
  }

  const { username, password, displayName } = parsed.data

  const existing = db.select().from(users).where(eq(users.username, username)).get()
  if (existing) {
    return c.json({ ok: false, error: 'Username already taken' }, 409)
  }

  const id = nanoid()
  const now = new Date().toISOString()
  const passwordHash = await hash(password)

  db.insert(users)
    .values({
      id,
      username,
      passwordHash,
      displayName: displayName ?? username,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const accessToken = await signAccessToken({ sub: id, username })
  const refreshToken = await signRefreshToken({ sub: id, username })

  // Store refresh token hash
  const rtId = nanoid()
  const rtHash = await hash(refreshToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  db.insert(refreshTokens)
    .values({ id: rtId, userId: id, tokenHash: rtHash, expiresAt, createdAt: now })
    .run()

  return c.json({
    ok: true,
    data: {
      user: { id, username, displayName: displayName ?? username },
      accessToken,
      refreshToken,
    },
  })
})

authRoutes.post('/login', async (c) => {
  const body = await c.req.json()
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const { username, password } = parsed.data

  const user = db.select().from(users).where(eq(users.username, username)).get()
  if (!user) {
    return c.json({ ok: false, error: 'Invalid credentials' }, 401)
  }

  const valid = await verify(user.passwordHash, password)
  if (!valid) {
    return c.json({ ok: false, error: 'Invalid credentials' }, 401)
  }

  const accessToken = await signAccessToken({ sub: user.id, username: user.username })
  const refreshToken = await signRefreshToken({ sub: user.id, username: user.username })

  const now = new Date().toISOString()
  const rtId = nanoid()
  const rtHash = await hash(refreshToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  db.insert(refreshTokens)
    .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })
    .run()

  return c.json({
    ok: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      accessToken,
      refreshToken,
    },
  })
})

authRoutes.post('/refresh', async (c) => {
  const body = await c.req.json()
  const parsed = refreshSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  try {
    const payload = await verifyToken(parsed.data.refreshToken)
    if (payload.type !== 'refresh') {
      return c.json({ ok: false, error: 'Invalid token type' }, 401)
    }

    const user = db.select().from(users).where(eq(users.id, payload.sub)).get()
    if (!user) {
      return c.json({ ok: false, error: 'User not found' }, 401)
    }

    // Rotate: delete old refresh tokens for this user and issue new ones
    db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id)).run()

    const accessToken = await signAccessToken({ sub: user.id, username: user.username })
    const refreshToken = await signRefreshToken({ sub: user.id, username: user.username })

    const now = new Date().toISOString()
    const rtId = nanoid()
    const rtHash = await hash(refreshToken)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    db.insert(refreshTokens)
      .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })
      .run()

    return c.json({ ok: true, data: { accessToken, refreshToken } })
  } catch {
    return c.json({ ok: false, error: 'Invalid or expired refresh token' }, 401)
  }
})

authRoutes.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId')
  db.delete(refreshTokens).where(eq(refreshTokens.userId, userId)).run()
  return c.json({ ok: true })
})
