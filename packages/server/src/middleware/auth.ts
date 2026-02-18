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

export const adminMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const userId = c.get('userId')
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user || user.role !== 'admin') {
    return c.json({ ok: false, error: 'Admin access required' }, 403)
  }
  await next()
})
