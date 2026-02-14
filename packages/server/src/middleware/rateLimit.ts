import { createMiddleware } from 'hono/factory'
import { getRedis } from '../lib/redis.js'

/**
 * Redis-based rate limiter using INCR + EXPIRE atomic operations.
 * @param windowMs - Time window in milliseconds
 * @param maxRequests - Max requests per window per IP
 */
export function rateLimitMiddleware(windowMs: number, maxRequests: number) {
  const isTest = process.env.NODE_ENV === 'test'
  const windowSec = Math.ceil(windowMs / 1000)

  return createMiddleware(async (c, next) => {
    if (isTest) {
      await next()
      return
    }

    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown'

    const redis = getRedis()
    const key = `rl:${ip}:${windowSec}`

    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, windowSec)
    }

    c.header('X-RateLimit-Limit', String(maxRequests))

    if (count > maxRequests) {
      const ttl = await redis.ttl(key)
      c.header('X-RateLimit-Remaining', '0')
      c.header('Retry-After', String(ttl > 0 ? ttl : windowSec))
      return c.json({ ok: false, error: 'Too many requests' }, 429)
    }

    c.header('X-RateLimit-Remaining', String(maxRequests - count))
    await next()
  })
}

// Presets
/** Auth endpoints: 10 requests per minute */
export const authRateLimit = rateLimitMiddleware(60_000, 10)
/** General API: 120 requests per minute */
export const apiRateLimit = rateLimitMiddleware(60_000, 120)
