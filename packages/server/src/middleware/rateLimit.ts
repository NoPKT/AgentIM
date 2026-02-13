import { createMiddleware } from 'hono/factory'

interface RateLimitEntry {
  count: number
  resetAt: number
}

/**
 * Simple in-memory rate limiter.
 * @param windowMs - Time window in milliseconds
 * @param maxRequests - Max requests per window per IP
 */
export function rateLimitMiddleware(windowMs: number, maxRequests: number) {
  const store = new Map<string, RateLimitEntry>()

  // Periodic cleanup to prevent memory leak
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key)
      }
    }
  }, windowMs * 2)

  return createMiddleware(async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown'

    const now = Date.now()
    const entry = store.get(ip)

    if (!entry || entry.resetAt <= now) {
      store.set(ip, { count: 1, resetAt: now + windowMs })
      c.header('X-RateLimit-Limit', String(maxRequests))
      c.header('X-RateLimit-Remaining', String(maxRequests - 1))
      await next()
      return
    }

    entry.count++

    if (entry.count > maxRequests) {
      c.header('X-RateLimit-Limit', String(maxRequests))
      c.header('X-RateLimit-Remaining', '0')
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return c.json({ ok: false, error: 'Too many requests' }, 429)
    }

    c.header('X-RateLimit-Limit', String(maxRequests))
    c.header('X-RateLimit-Remaining', String(maxRequests - entry.count))
    await next()
  })
}

// Presets
/** Auth endpoints: 10 requests per minute */
export const authRateLimit = rateLimitMiddleware(60_000, 10)
/** General API: 120 requests per minute */
export const apiRateLimit = rateLimitMiddleware(60_000, 120)
