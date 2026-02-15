import { Hono } from 'hono'
import { hash, verify } from 'argon2'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users, refreshTokens } from '../db/schema.js'
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js'
import { loginSchema, refreshSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rateLimit.js'

export const authRoutes = new Hono<AuthEnv>()

// Rate limit auth endpoints: 10 req/min per IP
authRoutes.use('*', authRateLimit)

authRoutes.post('/login', async (c) => {
  const body = await c.req.json()
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const { username, password } = parsed.data

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1)
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
  const { nanoid } = await import('nanoid')
  const rtId = nanoid()
  const rtHash = await hash(refreshToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  await db
    .insert(refreshTokens)
    .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })

  return c.json({
    ok: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
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

    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1)
    if (!user) {
      return c.json({ ok: false, error: 'User not found' }, 401)
    }

    // Verify the refresh token exists in the database (prevents reuse after logout/rotation)
    const storedTokens = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id))
    const tokenValid = await Promise.all(
      storedTokens.map((t) => verify(t.tokenHash, parsed.data.refreshToken).catch(() => false)),
    ).then((results) => results.some(Boolean))
    if (!tokenValid) {
      return c.json({ ok: false, error: 'Refresh token revoked or invalid' }, 401)
    }

    // Rotate: delete old refresh tokens for this user and issue new ones
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))

    const accessToken = await signAccessToken({ sub: user.id, username: user.username })
    const refreshToken = await signRefreshToken({ sub: user.id, username: user.username })

    const now = new Date().toISOString()
    const { nanoid } = await import('nanoid')
    const rtId = nanoid()
    const rtHash = await hash(refreshToken)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await db
      .insert(refreshTokens)
      .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })

    return c.json({ ok: true, data: { accessToken, refreshToken } })
  } catch {
    return c.json({ ok: false, error: 'Invalid or expired refresh token' }, 401)
  }
})

authRoutes.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId')
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
  return c.json({ ok: true })
})
