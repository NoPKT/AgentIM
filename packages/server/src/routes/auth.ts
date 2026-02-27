import { Hono } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import { hash, verify } from 'argon2'
import { eq, sql, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users, refreshTokens } from '../db/schema.js'
import {
  signAccessToken,
  signRefreshToken,
  signTotpChallengeToken,
  verifyToken,
} from '../lib/jwt.js'
import {
  loginSchema,
  totpVerifyLoginSchema,
  totpSetupVerifySchema,
  disableTotpSchema,
} from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { authRateLimit, rateLimitMiddleware } from '../middleware/rateLimit.js'
import { logAudit, getClientIp } from '../lib/audit.js'
import { revokeUserTokens } from '../lib/tokenRevocation.js'
import { connectionManager } from '../ws/connections.js'
import { parseJsonBody, formatZodError } from '../lib/validation.js'
import { config, getConfigSync } from '../config.js'
import { parseExpiryMs } from '../lib/time.js'
import {
  generateTotpSecret,
  getTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  verifyBackupCode,
} from '../lib/totp.js'

const REFRESH_COOKIE_NAME = 'agentim_rt'
const REFRESH_COOKIE_PATH = '/api/auth'

function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string, maxAgeSec: number) {
  setCookie(c, REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSec,
    ...(config.isProduction ? { secure: true } : {}),
  })
}

function clearRefreshCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, REFRESH_COOKIE_NAME, {
    path: REFRESH_COOKIE_PATH,
  })
}

const LOCKOUT_THRESHOLD = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

// Dummy hash for timing-safe comparison when user doesn't exist
// This prevents attackers from enumerating valid usernames via response timing
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

export const authRoutes = new Hono<AuthEnv>()

// Rate limit login attempts: 20 req/min per IP (brute-force protection).
// /refresh is intentionally excluded — it's cookie-gated and called frequently
// by the web client on every page load/API request to restore sessions.
// A separate, higher limit (60/min) is applied to /refresh to prevent DoS
// while not interfering with legitimate high-frequency session restoration.
const refreshRateLimit = rateLimitMiddleware(60_000, 60, 'auth_refresh')

authRoutes.post('/login', authRateLimit, async (c) => {
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
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

  // OAuth-only users have null passwordHash — reject with same error to prevent enumeration
  if (!user.passwordHash) {
    await verify(DUMMY_HASH, password).catch(() => {})
    logAudit({
      userId: user.id,
      action: 'login_failed',
      metadata: { noPassword: true },
      ipAddress: ip,
    })
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
    logAudit({
      userId: user.id,
      action: 'login_failed',
      metadata: { attempts: updated?.failedLoginAttempts },
      ipAddress: ip,
    })
    return c.json({ ok: false, error: 'Invalid credentials' }, 401)
  }

  // Reset failed attempts on successful login (best-effort; login succeeds regardless)
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    try {
      await db
        .update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, user.id))
    } catch {
      // Non-critical: login still succeeds; counter resets on next successful login
    }
  }

  // If TOTP 2FA is enabled, return a challenge token instead of real tokens
  if (user.totpEnabled) {
    const totpToken = await signTotpChallengeToken({ sub: user.id, username: user.username })
    return c.json({
      ok: true,
      data: { totpRequired: true, totpToken },
    })
  }

  const accessToken = await signAccessToken({ sub: user.id, username: user.username })
  const refreshToken = await signRefreshToken({ sub: user.id, username: user.username })

  const now = new Date().toISOString()
  const { nanoid } = await import('nanoid')
  const rtId = nanoid()
  const rtHash = await hash(refreshToken)
  const expiresAt = new Date(
    Date.now() +
      parseExpiryMs(getConfigSync<string>('jwt.refreshExpiry') ?? config.jwtRefreshExpiry),
  ).toISOString()

  // Limit refresh tokens per user: delete oldest when exceeded
  const MAX_REFRESH_TOKENS_PER_USER = config.maxRefreshTokensPerUser
  const existingTokens = await db
    .select({ id: refreshTokens.id, createdAt: refreshTokens.createdAt })
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, user.id))
    .orderBy(refreshTokens.createdAt)
  if (existingTokens.length >= MAX_REFRESH_TOKENS_PER_USER) {
    const toDelete = existingTokens.slice(
      0,
      existingTokens.length - MAX_REFRESH_TOKENS_PER_USER + 1,
    )
    await db.delete(refreshTokens).where(
      inArray(
        refreshTokens.id,
        toDelete.map((t) => t.id),
      ),
    )
  }

  await db
    .insert(refreshTokens)
    .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })

  logAudit({ userId: user.id, action: 'login', ipAddress: ip })

  // Set httpOnly Cookie for browser clients (web app).
  // The refresh token is also returned in the JSON body for CLI clients.
  // Note: The web client ignores the body refreshToken and relies solely on the
  // httpOnly cookie. This dual delivery is intentional for backward compatibility
  // with Gateway CLI clients that cannot use cookies.
  const cookieMaxAge = Math.floor(
    parseExpiryMs(getConfigSync<string>('jwt.refreshExpiry') ?? config.jwtRefreshExpiry) / 1000,
  )
  setRefreshCookie(c, refreshToken, cookieMaxAge)

  return c.json({
    ok: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        totpEnabled: user.totpEnabled,
      },
      accessToken,
      refreshToken,
    },
  })
})

authRoutes.post('/refresh', refreshRateLimit, async (c) => {
  // Priority 1: httpOnly Cookie (web browser path)
  // Priority 2: JSON body refreshToken (Gateway CLI path — backward compatible)
  let incomingRefreshToken = getCookie(c, REFRESH_COOKIE_NAME) ?? null
  const usingCookie = incomingRefreshToken !== null

  if (!incomingRefreshToken) {
    // Try to read refreshToken from JSON body (Gateway CLI path).
    // If the body is missing or not valid JSON, silently skip — we'll fall through
    // to the "Refresh token required" 401 below rather than returning a misleading 400.
    const body = await parseJsonBody(c)
    if (!(body instanceof Response)) {
      const rt = (body as Record<string, unknown>)?.refreshToken
      if (typeof rt === 'string' && rt.length > 0 && rt.length <= 2000) {
        incomingRefreshToken = rt
      }
    }
  }

  if (!incomingRefreshToken) {
    return c.json({ ok: false, error: 'Refresh token required' }, 401)
  }

  // CSRF defence-in-depth: when using the Cookie path (browser clients), verify
  // the Origin header in production to prevent cross-site refresh token abuse.
  // Gateway CLI uses the JSON body path and skips this check.
  // SameSite=Strict already provides primary CSRF protection; this adds a
  // secondary layer for environments where SameSite may not be enforced.
  // Uses dynamic CORS config (same source as global CORS middleware) to stay
  // consistent when admins change allowed origins at runtime.
  if (usingCookie && config.isProduction) {
    const allowed = getConfigSync<string>('cors.origin') ?? config.corsOrigin
    if (allowed) {
      const origin = c.req.header('origin')
      if (origin) {
        const origins = allowed.split(',').map((s) => s.trim())
        if (!origins.includes(origin)) {
          return c.json({ ok: false, error: 'Forbidden' }, 403)
        }
      }
    }
  }

  try {
    const payload = await verifyToken(incomingRefreshToken)
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
      let matchedTokenId: string | null = null
      for (const t of storedTokens) {
        if (t.expiresAt && t.expiresAt < now) continue
        const match = await verify(t.tokenHash, incomingRefreshToken!).catch(() => false)
        if (match) {
          matchedTokenId = t.id
          break
        }
      }

      if (!matchedTokenId) return null

      // Delete only the matched token (preserve other sessions) and insert new one atomically
      await tx.delete(refreshTokens).where(eq(refreshTokens.id, matchedTokenId))

      const newAccessToken = await signAccessToken({ sub: user.id, username: user.username })
      const newRefreshToken = await signRefreshToken({ sub: user.id, username: user.username })

      const { nanoid } = await import('nanoid')
      const rtId = nanoid()
      const rtHash = await hash(newRefreshToken)
      const expiresAt = new Date(
        Date.now() +
          parseExpiryMs(getConfigSync<string>('jwt.refreshExpiry') ?? config.jwtRefreshExpiry),
      ).toISOString()
      await tx
        .insert(refreshTokens)
        .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })

      return { accessToken: newAccessToken, refreshToken: newRefreshToken }
    })

    if (!result) {
      clearRefreshCookie(c)
      return c.json({ ok: false, error: 'Refresh token revoked or invalid' }, 401)
    }

    // Rotate Cookie for web clients
    const cookieMaxAge = Math.floor(
      parseExpiryMs(getConfigSync<string>('jwt.refreshExpiry') ?? config.jwtRefreshExpiry) / 1000,
    )
    setRefreshCookie(c, result.refreshToken, cookieMaxAge)

    // Omit refreshToken from body when the Cookie path is used (browser clients)
    const responseData = usingCookie ? { accessToken: result.accessToken } : result

    return c.json({ ok: true, data: responseData })
  } catch (err) {
    // jose JWT errors have a `code` property starting with "ERR_" (e.g. ERR_JWT_EXPIRED)
    const isJoseError =
      err instanceof Error &&
      'code' in err &&
      typeof (err as { code: unknown }).code === 'string' &&
      ((err as { code: string }).code.startsWith('ERR_JWT') ||
        (err as { code: string }).code.startsWith('ERR_JWS'))
    if (isJoseError) {
      clearRefreshCookie(c)
      return c.json({ ok: false, error: 'Invalid or expired refresh token' }, 401)
    }
    throw err
  }
})

authRoutes.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId')
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
  // Revoke all outstanding access tokens. Best-effort: the refresh token is
  // already deleted above so the user cannot obtain new access tokens even if
  // Redis is temporarily unavailable. Existing access tokens expire within TTL.
  try {
    await revokeUserTokens(userId)
  } catch {
    // Error already logged inside revokeUserTokens — continue with logout
  }
  connectionManager.disconnectUser(userId)
  // Clear the httpOnly refresh token Cookie for browser clients
  clearRefreshCookie(c)
  logAudit({ userId, action: 'logout', ipAddress: getClientIp(c) })
  return c.json({ ok: true })
})

// ─── TOTP 2FA Endpoints ───

/** Verify TOTP challenge (step 2 of login when 2FA is enabled). */
authRoutes.post('/verify-totp', authRateLimit, async (c) => {
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = totpVerifyLoginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const { totpToken, code } = parsed.data
  const ip = getClientIp(c)

  try {
    const payload = await verifyToken(totpToken)
    if (payload.type !== 'totp_challenge') {
      return c.json({ ok: false, error: 'Invalid token type' }, 401)
    }

    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1)
    if (!user || !user.totpEnabled || !user.totpSecret) {
      return c.json({ ok: false, error: 'Invalid TOTP state' }, 401)
    }

    // Try TOTP code first, then backup codes
    let validCode = verifyTotpCode(user.totpSecret, code)
    if (!validCode && user.totpBackupCodes) {
      const hashedCodes: string[] = JSON.parse(user.totpBackupCodes)
      const result = await verifyBackupCode(code, hashedCodes)
      if (result.valid) {
        validCode = true
        // Remove used backup code
        await db
          .update(users)
          .set({ totpBackupCodes: JSON.stringify(result.remainingCodes) })
          .where(eq(users.id, user.id))
      }
    }

    if (!validCode) {
      logAudit({
        userId: user.id,
        action: 'totp_verify_failed',
        ipAddress: ip,
      })
      return c.json({ ok: false, error: 'Invalid TOTP code' }, 401)
    }

    // Issue real tokens
    const accessToken = await signAccessToken({ sub: user.id, username: user.username })
    const refreshToken = await signRefreshToken({ sub: user.id, username: user.username })

    const now = new Date().toISOString()
    const { nanoid } = await import('nanoid')
    const rtId = nanoid()
    const rtHash = await hash(refreshToken)
    const expiresAt = new Date(
      Date.now() +
        parseExpiryMs(getConfigSync<string>('jwt.refreshExpiry') ?? config.jwtRefreshExpiry),
    ).toISOString()

    // Limit refresh tokens per user
    const existingTokens = await db
      .select({ id: refreshTokens.id, createdAt: refreshTokens.createdAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id))
      .orderBy(refreshTokens.createdAt)
    if (existingTokens.length >= config.maxRefreshTokensPerUser) {
      const toDelete = existingTokens.slice(
        0,
        existingTokens.length - config.maxRefreshTokensPerUser + 1,
      )
      await db.delete(refreshTokens).where(
        inArray(
          refreshTokens.id,
          toDelete.map((t) => t.id),
        ),
      )
    }

    await db
      .insert(refreshTokens)
      .values({ id: rtId, userId: user.id, tokenHash: rtHash, expiresAt, createdAt: now })

    logAudit({ userId: user.id, action: 'login', ipAddress: ip })

    const cookieMaxAge = Math.floor(
      parseExpiryMs(getConfigSync<string>('jwt.refreshExpiry') ?? config.jwtRefreshExpiry) / 1000,
    )
    setRefreshCookie(c, refreshToken, cookieMaxAge)

    return c.json({
      ok: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          role: user.role,
          totpEnabled: user.totpEnabled,
        },
        accessToken,
        refreshToken,
      },
    })
  } catch {
    return c.json({ ok: false, error: 'Invalid or expired TOTP token' }, 401)
  }
})

/** Begin TOTP setup: generate secret and return otpauth URI. */
authRoutes.post('/setup-totp', authMiddleware, async (c) => {
  const userId = c.get('userId')

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return c.json({ ok: false, error: 'User not found' }, 404)
  if (user.totpEnabled) return c.json({ ok: false, error: '2FA is already enabled' }, 400)

  const secret = generateTotpSecret()
  const uri = getTotpUri(secret, user.username)

  // Store secret temporarily (not yet enabled until verified)
  await db.update(users).set({ totpSecret: secret }).where(eq(users.id, userId))

  logAudit({ userId, action: 'totp_setup', ipAddress: getClientIp(c) })

  return c.json({ ok: true, data: { secret, uri } })
})

/** Confirm TOTP setup: verify code → enable 2FA → return backup codes. */
authRoutes.post('/verify-totp-setup', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = totpSetupVerifySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return c.json({ ok: false, error: 'User not found' }, 404)
  if (user.totpEnabled) return c.json({ ok: false, error: '2FA is already enabled' }, 400)
  if (!user.totpSecret) return c.json({ ok: false, error: 'No TOTP setup in progress' }, 400)

  if (!verifyTotpCode(user.totpSecret, parsed.data.code)) {
    return c.json({ ok: false, error: 'Invalid TOTP code' }, 400)
  }

  const { plainCodes, hashedCodes } = await generateBackupCodes()

  await db
    .update(users)
    .set({
      totpEnabled: true,
      totpBackupCodes: JSON.stringify(hashedCodes),
    })
    .where(eq(users.id, userId))

  logAudit({ userId, action: 'totp_enabled', ipAddress: getClientIp(c) })

  return c.json({ ok: true, data: { backupCodes: plainCodes } })
})

/** Disable TOTP 2FA (requires password confirmation). */
authRoutes.post('/disable-totp', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = disableTotpSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return c.json({ ok: false, error: 'User not found' }, 404)
  if (!user.totpEnabled) return c.json({ ok: false, error: '2FA is not enabled' }, 400)

  if (!user.passwordHash) {
    return c.json({ ok: false, error: 'Password not set' }, 400)
  }

  const valid = await verify(user.passwordHash, parsed.data.password)
  if (!valid) {
    return c.json({ ok: false, error: 'Invalid password' }, 401)
  }

  await db
    .update(users)
    .set({
      totpEnabled: false,
      totpSecret: null,
      totpBackupCodes: null,
    })
    .where(eq(users.id, userId))

  logAudit({ userId, action: 'totp_disabled', ipAddress: getClientIp(c) })

  return c.json({ ok: true })
})
