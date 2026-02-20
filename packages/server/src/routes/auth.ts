import { Hono } from 'hono'
import { hash, verify } from 'argon2'
import { eq, sql, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users, refreshTokens } from '../db/schema.js'
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js'
import { loginSchema, refreshSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rateLimit.js'
import { logAudit, getClientIp } from '../lib/audit.js'
import { revokeUserTokens } from '../lib/tokenRevocation.js'
import { connectionManager } from '../ws/connections.js'
import { parseJsonBody } from '../lib/validation.js'
import { config } from '../config.js'

const LOCKOUT_THRESHOLD = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

/** Parse a duration string like '7d', '24h', '30m' into milliseconds. */
function parseExpiryMs(expiry: string): number {
  const match = expiry.match(/^(\d+)\s*([smhd])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000 // default 7 days
  const [, num, unit] = match
  const n = parseInt(num, 10)
  switch (unit) {
    case 's': return n * 1000
    case 'm': return n * 60 * 1000
    case 'h': return n * 60 * 60 * 1000
    case 'd': return n * 24 * 60 * 60 * 1000
    default: return 7 * 24 * 60 * 60 * 1000
  }
}

// Dummy hash for timing-safe comparison when user doesn't exist
// This prevents attackers from enumerating valid usernames via response timing
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

export const authRoutes = new Hono<AuthEnv>()

// Rate limit auth endpoints: 10 req/min per IP
authRoutes.use('*', authRateLimit)

authRoutes.post('/login', async (c) => {
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed' }, 400)
  }

  const { username, password } = parsed.data
  const ip = getClientIp(c)

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1)

  // Always run argon2 verify to prevent timing-based username enumeration
  if (!user) {
    await verify(DUMMY_HASH, password).catch(() => {})
    logAudit({ userId: null, action: 'login_failed', metadata: { username }, ipAddress: ip })
    return c.json({ ok: false, error: 'Invalid credentials' }, 401)
  }

  // Check account lockout — return the same error as invalid credentials
  // to prevent username enumeration via distinct 429 responses.
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    await verify(DUMMY_HASH, password).catch(() => {}) // timing-safe delay
    logAudit({ userId: user.id, action: 'login_failed', metadata: { locked: true }, ipAddress: ip })
    return c.json({ ok: false, error: 'Invalid credentials' }, 401)
  }

  const valid = await verify(user.passwordHash, password)
  if (!valid) {
    // Atomically increment failed attempts using SQL to prevent race conditions
    const [updated] = await db
      .update(users)
      .set({
        failedLoginAttempts: sql`COALESCE(${users.failedLoginAttempts}, 0) + 1`,
        lockedUntil: sql`CASE WHEN COALESCE(${users.failedLoginAttempts}, 0) + 1 >= ${LOCKOUT_THRESHOLD} THEN ${new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()} ELSE ${users.lockedUntil} END`,
      })
      .where(eq(users.id, user.id))
      .returning({ failedLoginAttempts: users.failedLoginAttempts })
    logAudit({ userId: user.id, action: 'login_failed', metadata: { attempts: updated?.failedLoginAttempts }, ipAddress: ip })
    return c.json({ ok: false, error: 'Invalid credentials' }, 401)
  }

  // Reset failed attempts on successful login
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, user.id))
  }

  const accessToken = await signAccessToken({ sub: user.id, username: user.username })
  const refreshToken = await signRefreshToken({ sub: user.id, username: user.username })

  const now = new Date().toISOString()
  const { nanoid } = await import('nanoid')
  const rtId = nanoid()
  const rtHash = await hash(refreshToken)
  const expiresAt = new Date(Date.now() + parseExpiryMs(config.jwtRefreshExpiry)).toISOString()

  // Limit refresh tokens per user: delete oldest when exceeded
  const MAX_REFRESH_TOKENS_PER_USER = config.maxRefreshTokensPerUser
  const existingTokens = await db
    .select({ id: refreshTokens.id, createdAt: refreshTokens.createdAt })
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, user.id))
    .orderBy(refreshTokens.createdAt)
  if (existingTokens.length >= MAX_REFRESH_TOKENS_PER_USER) {
    const toDelete = existingTokens.slice(0, existingTokens.length - MAX_REFRESH_TOKENS_PER_USER + 1)
    await db.delete(refreshTokens).where(inArray(refreshTokens.id, toDelete.map((t) => t.id)))
  }

  await db
    .insert(refreshTokens)
    .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })

  logAudit({ userId: user.id, action: 'login', ipAddress: ip })

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
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
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

    // Verify & rotate in a transaction to prevent concurrent refresh race conditions
    const now = new Date().toISOString()

    const result = await db.transaction(async (tx) => {
      // Serialize concurrent refresh requests per user with an advisory lock.
      // Without this, two requests using the same token could both validate and rotate,
      // causing the first response's new token to be immediately invalidated.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`)

      const storedTokens = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, user.id))

      // Verify tokens sequentially with early exit to avoid O(n) argon2 operations
      let tokenValid = false
      for (const t of storedTokens) {
        if (t.expiresAt && t.expiresAt < now) continue
        const match = await verify(t.tokenHash, parsed.data.refreshToken).catch(() => false)
        if (match) {
          tokenValid = true
          break
        }
      }

      if (!tokenValid) return null

      // Delete all old tokens and insert new one atomically
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, user.id))

      const newAccessToken = await signAccessToken({ sub: user.id, username: user.username })
      const newRefreshToken = await signRefreshToken({ sub: user.id, username: user.username })

      const { nanoid } = await import('nanoid')
      const rtId = nanoid()
      const rtHash = await hash(newRefreshToken)
      const expiresAt = new Date(Date.now() + parseExpiryMs(config.jwtRefreshExpiry)).toISOString()
      await tx
        .insert(refreshTokens)
        .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })

      return { accessToken: newAccessToken, refreshToken: newRefreshToken }
    })

    if (!result) {
      return c.json({ ok: false, error: 'Refresh token revoked or invalid' }, 401)
    }

    return c.json({ ok: true, data: result })
  } catch (err) {
    // jose JWT errors have a `code` property starting with "ERR_" (e.g. ERR_JWT_EXPIRED)
    const isJoseError =
      err instanceof Error && 'code' in err && typeof (err as { code: unknown }).code === 'string' &&
      ((err as { code: string }).code.startsWith('ERR_JWT') ||
        (err as { code: string }).code.startsWith('ERR_JWS'))
    if (isJoseError) {
      return c.json({ ok: false, error: 'Invalid or expired refresh token' }, 401)
    }
    throw err
  }
})

authRoutes.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId')
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
  // Revoke all outstanding access tokens and disconnect active WS sessions
  await revokeUserTokens(userId)
  connectionManager.disconnectUser(userId)
  logAudit({ userId, action: 'logout', ipAddress: getClientIp(c) })
  return c.json({ ok: true })
})
