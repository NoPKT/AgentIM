import { createMiddleware } from 'hono/factory'
import { eq } from 'drizzle-orm'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked } from '../lib/tokenRevocation.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'

export type AuthEnv = {
  Variables: {
    userId: string
    username: string
  }
}

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401)
  }

  const token = header.slice(7)
  try {
    const payload = await verifyToken(token)
    if (payload.type !== 'access') {
      return c.json({ ok: false, error: 'Invalid token type' }, 401)
    }
    // Check if the token was revoked (logout / password change)
    if (payload.iat && (await isTokenRevoked(payload.sub, payload.iat * 1000))) {
      return c.json({ ok: false, error: 'Token revoked' }, 401)
    }
    c.set('userId', payload.sub)
    c.set('username', payload.username)
    await next()
  } catch {
    return c.json({ ok: false, error: 'Invalid or expired token' }, 401)
  }
})

// ─── Admin Role Cache ───
// Short-lived in-process cache to avoid querying DB on every admin request.
// Entries expire after 60 seconds, so role changes take effect within 1 minute.
const ADMIN_CACHE_TTL_MS = 60_000
const ADMIN_CACHE_MAX_SIZE = 500
const adminRoleCache = new Map<string, { role: string; expiresAt: number }>()

function getCachedAdminRole(userId: string): string | null {
  const entry = adminRoleCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    adminRoleCache.delete(userId)
    return null
  }
  return entry.role
}

function setCachedAdminRole(userId: string, role: string) {
  // Evict oldest entry (by expiresAt) if cache is full
  if (adminRoleCache.size >= ADMIN_CACHE_MAX_SIZE) {
    let oldestKey: string | undefined
    let oldestExpiry = Infinity
    for (const [key, entry] of adminRoleCache) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt
        oldestKey = key
      }
    }
    if (oldestKey !== undefined) adminRoleCache.delete(oldestKey)
  }
  adminRoleCache.set(userId, { role, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS })
}

/** Clear admin cache for a specific user (call on role change / password change) */
export function invalidateAdminCache(userId: string) {
  adminRoleCache.delete(userId)
}

export const adminMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const userId = c.get('userId')

  // Check cache first
  const cachedRole = getCachedAdminRole(userId)
  if (cachedRole !== null) {
    if (cachedRole !== 'admin') {
      return c.json({ ok: false, error: 'Admin access required' }, 403)
    }
    await next()
    return
  }

  // Cache miss — query DB
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user || user.role !== 'admin') {
    if (user) setCachedAdminRole(userId, user.role)
    return c.json({ ok: false, error: 'Admin access required' }, 403)
  }

  setCachedAdminRole(userId, user.role)
  await next()
})
