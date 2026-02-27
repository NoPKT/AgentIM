import { Hono } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import { hash } from 'argon2'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users, oauthAccounts, refreshTokens } from '../db/schema.js'
import { signRefreshToken } from '../lib/jwt.js'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { logAudit, getClientIp } from '../lib/audit.js'
import {
  isProviderConfigured,
  getAuthorizationUrl,
  exchangeCode,
  type OAuthProvider,
} from '../lib/oauth.js'
import { encryptSecret } from '../lib/crypto.js'
import { config, getConfigSync } from '../config.js'
import { parseExpiryMs } from '../lib/time.js'
import { nanoid } from 'nanoid'
import { createLogger } from '../lib/logger.js'

const log = createLogger('OAuth')

const OAUTH_STATE_COOKIE = 'agentim_oauth_state'
const REFRESH_COOKIE_NAME = 'agentim_rt'
const REFRESH_COOKIE_PATH = '/api/auth'

// ─── OAuth State Store (Redis-backed with in-memory fallback) ─────────────

import { getRedis, isRedisEnabled } from '../lib/redis.js'

const OAUTH_STATE_PREFIX = 'oauth_state:'
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const STATE_TTL_SEC = Math.ceil(STATE_TTL_MS / 1000)

// In-memory fallback for single-node deployments without Redis
const memoryStates = new Map<string, { provider: OAuthProvider; expiresAt: number }>()
const MAX_PENDING_STATES = 1000

// Periodically clean expired in-memory states
let oauthStateCleanupTimer: ReturnType<typeof setInterval> | null = setInterval(
  () => {
    const now = Date.now()
    for (const [key, val] of memoryStates) {
      if (val.expiresAt < now) memoryStates.delete(key)
    }
  },
  5 * 60 * 1000,
)
oauthStateCleanupTimer.unref()

/** Stop the periodic OAuth state cleanup timer (for graceful shutdown). */
export function stopOAuthStateCleanup() {
  if (oauthStateCleanupTimer) {
    clearInterval(oauthStateCleanupTimer)
    oauthStateCleanupTimer = null
  }
}

async function storeOAuthState(
  state: string,
  provider: OAuthProvider,
): Promise<{ ok: boolean; error?: string }> {
  if (isRedisEnabled()) {
    const redis = getRedis()
    await redis.set(
      `${OAUTH_STATE_PREFIX}${state}`,
      JSON.stringify({ provider }),
      'EX',
      STATE_TTL_SEC,
    )
    return { ok: true }
  }
  if (memoryStates.size >= MAX_PENDING_STATES) {
    return { ok: false, error: 'Too many pending OAuth requests, try again later' }
  }
  memoryStates.set(state, { provider, expiresAt: Date.now() + STATE_TTL_MS })
  return { ok: true }
}

async function consumeOAuthState(state: string, expectedProvider: string): Promise<boolean> {
  if (isRedisEnabled()) {
    const redis = getRedis()
    const raw = await redis.get(`${OAUTH_STATE_PREFIX}${state}`)
    if (!raw) return false
    await redis.del(`${OAUTH_STATE_PREFIX}${state}`)
    try {
      const data = JSON.parse(raw) as { provider: string }
      return data.provider === expectedProvider
    } catch {
      return false
    }
  }
  const entry = memoryStates.get(state)
  if (!entry || entry.provider !== expectedProvider || entry.expiresAt < Date.now()) {
    memoryStates.delete(state)
    return false
  }
  memoryStates.delete(state)
  return true
}

const VALID_PROVIDERS = new Set<string>(['github', 'google'])

export const oauthRoutes = new Hono<AuthEnv>()

// GET /oauth/providers — list configured OAuth providers
oauthRoutes.get('/oauth/providers', (_c) => {
  const providers: string[] = []
  if (isProviderConfigured('github')) providers.push('github')
  if (isProviderConfigured('google')) providers.push('google')
  return _c.json({ ok: true, data: providers })
})

// GET /oauth/:provider — redirect to OAuth provider's authorization page
oauthRoutes.get('/oauth/:provider', async (c) => {
  const provider = c.req.param('provider')
  if (!VALID_PROVIDERS.has(provider)) {
    return c.json({ ok: false, error: 'Invalid provider' }, 400)
  }
  if (!isProviderConfigured(provider as OAuthProvider)) {
    return c.json({ ok: false, error: 'Provider not configured' }, 400)
  }

  const state = nanoid(32)
  const storeResult = await storeOAuthState(state, provider as OAuthProvider)
  if (!storeResult.ok) {
    return c.json({ ok: false, error: storeResult.error }, 429)
  }

  // Set state in cookie for double-check on callback
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax', // Must be Lax for OAuth cross-origin redirects
    path: '/api/auth',
    maxAge: 600,
    ...(config.isProduction ? { secure: true } : {}),
  })

  const fwdProto = config.trustProxy ? c.req.header('x-forwarded-proto') : undefined
  const baseUrl = fwdProto ? `${fwdProto}://${c.req.header('host')}` : new URL(c.req.url).origin
  const redirectUri = `${baseUrl}/api/auth/oauth/${provider}/callback`
  const authUrl = getAuthorizationUrl(provider as OAuthProvider, state, redirectUri)

  return c.redirect(authUrl)
})

// GET /oauth/:provider/callback — handle OAuth callback
oauthRoutes.get('/oauth/:provider/callback', async (c) => {
  const provider = c.req.param('provider')
  if (!VALID_PROVIDERS.has(provider)) {
    return c.redirect('/login?error=invalid_provider')
  }

  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    log.warn(`OAuth ${provider} error: ${error}`)
    return c.redirect(`/login?error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return c.redirect('/login?error=missing_params')
  }

  // Verify state (store + cookie double-check)
  const validState = await consumeOAuthState(state, provider)
  if (!validState) {
    return c.redirect('/login?error=invalid_state')
  }

  const cookieState = getCookie(c, OAUTH_STATE_COOKIE)
  if (cookieState !== state) {
    return c.redirect('/login?error=state_mismatch')
  }
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/api/auth' })

  const ip = getClientIp(c)

  try {
    const cbFwdProto = config.trustProxy ? c.req.header('x-forwarded-proto') : undefined
    const baseUrl = cbFwdProto
      ? `${cbFwdProto}://${c.req.header('host')}`
      : new URL(c.req.url).origin
    const redirectUri = `${baseUrl}/api/auth/oauth/${provider}/callback`
    const userInfo = await exchangeCode(provider as OAuthProvider, code, redirectUri)

    // Check if this OAuth account is already linked to a user
    const [existingOAuth] = await db
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerAccountId, userInfo.providerAccountId),
        ),
      )
      .limit(1)

    let userId: string
    let username: string

    if (existingOAuth) {
      // Existing linked account — log in as that user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, existingOAuth.userId))
        .limit(1)
      if (!user) {
        return c.redirect('/login?error=user_not_found')
      }
      userId = user.id
      username = user.username

      // Update OAuth account info
      const now = new Date().toISOString()
      await db
        .update(oauthAccounts)
        .set({
          email: userInfo.email,
          displayName: userInfo.displayName,
          avatarUrl: userInfo.avatarUrl,
          accessToken: userInfo.accessToken ? encryptSecret(userInfo.accessToken) : null,
          refreshToken: userInfo.refreshToken ? encryptSecret(userInfo.refreshToken) : null,
          updatedAt: now,
        })
        .where(eq(oauthAccounts.id, existingOAuth.id))
    } else {
      // New OAuth account — always create a new user.
      // We intentionally do NOT auto-link by email because OAuth providers
      // may not verify email ownership, allowing account takeover attacks
      // (e.g. attacker sets victim's email on their GitHub account).
      // Users can link additional OAuth providers manually when logged in.
      userId = nanoid()
      username = await generateUniqueUsername(userInfo.displayName || userInfo.email || provider)
      const now = new Date().toISOString()
      await db.insert(users).values({
        id: userId,
        username,
        passwordHash: null,
        displayName: userInfo.displayName || username,
        avatarUrl: userInfo.avatarUrl,
        role: 'user',
        createdAt: now,
        updatedAt: now,
      })

      // Link the OAuth account
      const oauthId = nanoid()
      await db.insert(oauthAccounts).values({
        id: oauthId,
        userId,
        provider,
        providerAccountId: userInfo.providerAccountId,
        email: userInfo.email,
        displayName: userInfo.displayName,
        avatarUrl: userInfo.avatarUrl,
        accessToken: userInfo.accessToken ? encryptSecret(userInfo.accessToken) : null,
        refreshToken: userInfo.refreshToken ? encryptSecret(userInfo.refreshToken) : null,
        createdAt: now,
        updatedAt: now,
      })
    }

    // Issue refresh token (client will obtain access token via /auth/refresh)
    const refreshToken = await signRefreshToken({ sub: userId, username })

    const now = new Date().toISOString()
    const rtId = nanoid()
    const rtHash = await hash(refreshToken)
    const expiresAt = new Date(
      Date.now() +
        parseExpiryMs(getConfigSync<string>('jwt.refreshExpiry') || config.jwtRefreshExpiry),
    ).toISOString()

    await db
      .insert(refreshTokens)
      .values({ id: rtId, userId, tokenHash: rtHash, expiresAt, createdAt: now })

    // Set refresh token cookie
    const cookieMaxAge = Math.floor(
      parseExpiryMs(getConfigSync<string>('jwt.refreshExpiry') || config.jwtRefreshExpiry) / 1000,
    )
    setCookie(c, REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: 'Lax', // Lax for OAuth redirect landing
      path: REFRESH_COOKIE_PATH,
      maxAge: cookieMaxAge,
      ...(config.isProduction ? { secure: true } : {}),
    })

    logAudit({ userId, action: 'login', metadata: { via: `oauth:${provider}` }, ipAddress: ip })

    // Redirect to the callback page which will restore session via refresh token
    return c.redirect('/auth/callback?provider=' + provider)
  } catch (err) {
    log.error(`OAuth callback error for ${provider}: ${(err as Error).message}`)
    return c.redirect('/login?error=oauth_failed')
  }
})

// POST /oauth/:provider/link — link OAuth account to current user
oauthRoutes.post('/oauth/:provider/link', authMiddleware, async (c) => {
  const provider = c.req.param('provider')
  if (!VALID_PROVIDERS.has(provider)) {
    return c.json({ ok: false, error: 'Invalid provider' }, 400)
  }
  if (!isProviderConfigured(provider as OAuthProvider)) {
    return c.json({ ok: false, error: 'Provider not configured' }, 400)
  }

  const userId = c.get('userId')

  // Check if already linked
  const [existing] = await db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)))
    .limit(1)

  if (existing) {
    return c.json({ ok: false, error: 'Already linked' }, 400)
  }

  // Redirect to OAuth flow — the callback performs the standard OAuth handling;
  // linking to the current user is completed by subsequent application logic
  const state = nanoid(32)
  const storeResult = await storeOAuthState(state, provider as OAuthProvider)
  if (!storeResult.ok) {
    return c.json({ ok: false, error: storeResult.error }, 429)
  }

  // Store state in a cookie so the callback can verify it
  setCookie(c, 'oauth_state', state, {
    path: '/api/auth/oauth',
    httpOnly: true,
    secure: config.trustProxy || c.req.url.startsWith('https://'),
    sameSite: 'lax',
    maxAge: Math.floor(parseExpiryMs('10m') / 1000),
  })

  const fwdProto = config.trustProxy ? c.req.header('x-forwarded-proto') : undefined
  const baseUrl = fwdProto ? `${fwdProto}://${c.req.header('host')}` : new URL(c.req.url).origin
  const redirectUri = `${baseUrl}/api/auth/oauth/${provider}/callback`
  const authUrl = getAuthorizationUrl(provider as OAuthProvider, state, redirectUri)

  return c.json({ ok: true, data: { url: authUrl } })
})

// DELETE /oauth/:provider/unlink — unlink OAuth account from current user
oauthRoutes.delete('/oauth/:provider/unlink', authMiddleware, async (c) => {
  const provider = c.req.param('provider')
  if (!VALID_PROVIDERS.has(provider)) {
    return c.json({ ok: false, error: 'Invalid provider' }, 400)
  }

  const userId = c.get('userId')

  // Check if the user has a password — if not, must keep at least one OAuth link
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) {
    return c.json({ ok: false, error: 'User not found' }, 404)
  }

  if (!user.passwordHash) {
    // Count OAuth accounts
    const accounts = await db
      .select({ id: oauthAccounts.id })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
    if (accounts.length <= 1) {
      return c.json({ ok: false, error: 'Cannot unlink last authentication method' }, 400)
    }
  }

  const result = await db
    .delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)))

  const { getAffectedRowCount } = await import('../lib/drizzleUtils.js')
  const deleted = getAffectedRowCount(result)
  if (deleted === 0) {
    return c.json({ ok: false, error: 'Not linked' }, 404)
  }

  logAudit({
    userId,
    action: 'oauth_unlink',
    metadata: { provider },
    ipAddress: getClientIp(c),
  })

  return c.json({ ok: true })
})

const USERNAME_BASE_MAX_LENGTH = 40
const USERNAME_MAX_SEQUENTIAL_ATTEMPTS = 100

/** Generate a unique username from a display name or email prefix. */
async function generateUniqueUsername(source: string): Promise<string> {
  // Sanitize: keep only alphanumeric and underscores, lowercase
  let base = source
    .split('@')[0]
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase()
    .slice(0, USERNAME_BASE_MAX_LENGTH)
  if (!base) base = 'user'

  let username = base
  let attempt = 0
  while (true) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1)
    if (!existing) return username
    attempt++
    username = `${base}${attempt}`
    if (attempt > USERNAME_MAX_SEQUENTIAL_ATTEMPTS) {
      // Fallback to nanoid suffix
      return `${base}_${nanoid(6)}`
    }
  }
}
