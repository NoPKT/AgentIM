import { createMiddleware } from 'hono/factory'
import { verifyToken } from '../lib/jwt.js'

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
    c.set('userId', payload.sub)
    c.set('username', payload.username)
    await next()
  } catch {
    return c.json({ ok: false, error: 'Invalid or expired token' }, 401)
  }
})
