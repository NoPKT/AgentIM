import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { getRedis } from '../lib/redis.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('RateLimit')

/**
 * Resolve client IP. Only trusts proxy headers when TRUST_PROXY=true.
 * Falls back to socket remote address when not behind a proxy.
 */
export function getClientIpFromRequest(c: Context): string {
  if (config.trustProxy) {
    return (
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown'
    )
  }
  // Use socket remote address when not behind a proxy
  try {
    const info = getConnInfo(c)
    return info.remote?.address || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Redis-based rate limiter using INCR + EXPIRE atomic operations.
 * @param windowMs - Time window in milliseconds
 * @param maxRequests - Max requests per window per IP
 */
export function rateLimitMiddleware(windowMs: number, maxRequests: number, prefix = 'api') {
  const isTest = process.env.NODE_ENV === 'test'
  const windowSec = Math.ceil(windowMs / 1000)

  return createMiddleware(async (c, next) => {
    if (isTest) {
      await next()
      return
    }

    const ip = getClientIpFromRequest(c)

    try {
      const redis = getRedis()
      const key = `rl:${prefix}:${ip}:${windowSec}`

      const count = await redis.incr(key)
      // Only set EXPIRE when the key is first created (count === 1) to use fixed time buckets.
      // This prevents the window from sliding forward on every request, which would cause
      // the counter to grow monotonically under continuous traffic.
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
    } catch {
      // Redis unavailable — fail-closed: reject the request
      log.warn('Redis unavailable for rate limiting, rejecting request (fail-closed)')
      return c.json({ ok: false, error: 'Service temporarily unavailable' }, 503)
    }

    await next()
  })
}

// Presets
/** Auth endpoints: 10 requests per minute */
export const authRateLimit = rateLimitMiddleware(60_000, 10, 'auth')
/** General API: 120 requests per minute */
export const apiRateLimit = rateLimitMiddleware(60_000, 120, 'api')
/** Sensitive endpoints: 5 requests per minute */
export const sensitiveRateLimit = rateLimitMiddleware(60_000, 5, 'sens')
/** Upload endpoints: 10 requests per minute */
export const uploadRateLimit = rateLimitMiddleware(60_000, 10, 'upload')
