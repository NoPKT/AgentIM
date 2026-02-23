import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { getRedis, INCR_WITH_EXPIRE_LUA, isRedisEnabled } from '../lib/redis.js'
import { config, getConfigSync } from '../config.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('RateLimit')

/**
 * Resolve client IP. Only trusts proxy headers when TRUST_PROXY=true.
 * Falls back to socket remote address when not behind a proxy.
 */
export function getClientIpFromRequest(c: Context): string {
  const trustProxy = getConfigSync<boolean>('trust.proxy') || config.trustProxy
  if (trustProxy) {
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
// In-memory fallback counters when Redis is unavailable.
// NOTE: these counters are process-local. In a multi-process or multi-node
// deployment each process maintains its own independent counter, so the
// effective rate limit per IP is (maxRequests × number-of-processes). Ensure
// Redis is highly available to avoid relying on this fallback in production.
const memoryCounters = new Map<string, { count: number; resetAt: number }>()

let memoryRateLimitWarned = false

/** In-memory rate limit check. Returns true if the request should be rejected. */
function memoryRateLimit(key: string, windowMs: number, maxRequests: number): boolean {
  if (!memoryRateLimitWarned) {
    memoryRateLimitWarned = true
    log.warn(
      'Using in-memory rate limiting. In multi-process/multi-node deployments, ' +
        'enable Redis for accurate cross-process rate limiting.',
    )
  }
  const now = Date.now()
  const entry = memoryCounters.get(key) ?? { count: 0, resetAt: now + windowMs }
  if (now > entry.resetAt) {
    entry.count = 0
    entry.resetAt = now + windowMs
  }
  entry.count++
  memoryCounters.set(key, entry)
  return entry.count > maxRequests
}

export function rateLimitMiddleware(
  windowMs: number,
  maxRequests: number,
  prefix = 'api',
  options?: { useUserId?: boolean },
) {
  const isTest = process.env.NODE_ENV === 'test'
  const windowSec = Math.ceil(windowMs / 1000)

  return createMiddleware(async (c, next) => {
    if (isTest) {
      await next()
      return
    }

    const userId = options?.useUserId ? c.get('userId') : undefined
    const identity = userId ? `u:${userId}` : getClientIpFromRequest(c)
    const key = `rl:${prefix}:${identity}:${windowSec}`

    if (!isRedisEnabled()) {
      const limited = memoryRateLimit(key, windowMs, maxRequests)
      if (limited) {
        return c.json({ ok: false, error: 'Too many requests' }, 429)
      }
      await next()
      return
    }

    try {
      const redis = getRedis()

      const count = (await redis.eval(INCR_WITH_EXPIRE_LUA, 1, key, windowSec)) as number

      c.header('X-RateLimit-Limit', String(maxRequests))

      if (count > maxRequests) {
        const ttl = await redis.ttl(key)
        c.header('X-RateLimit-Remaining', '0')
        c.header('Retry-After', String(ttl > 0 ? ttl : windowSec))
        return c.json({ ok: false, error: 'Too many requests' }, 429)
      }

      c.header('X-RateLimit-Remaining', String(maxRequests - count))
    } catch {
      // Redis unavailable — fallback to in-memory rate limiting
      log.warn(
        'Redis unavailable for rate limiting, using in-memory fallback. ' +
          'WARNING: In multi-process/multi-node deployments each process maintains its own ' +
          'counter, so the effective rate limit per IP is (maxRequests × number-of-processes). ' +
          'Ensure Redis is highly available to avoid this fallback in production.',
      )
      const limited = memoryRateLimit(key, windowMs, maxRequests)
      if (limited) {
        return c.json({ ok: false, error: 'Too many requests' }, 429)
      }
    }

    await next()
  })
}

// Presets
/** Auth login endpoint: 20 requests per minute per IP.
 *  Primary brute-force protection is the 5-attempt account lockout (15 min).
 *  This rate limit provides a secondary per-IP throttle. 20/min allows
 *  legitimate multi-device usage while blocking automated credential-stuffing
 *  attacks. E2E tests bypass rate limiting via NODE_ENV=test. */
export const authRateLimit = rateLimitMiddleware(60_000, 20, 'auth')
/** General API: 120 requests per minute */
export const apiRateLimit = rateLimitMiddleware(60_000, 120, 'api')
/** Sensitive endpoints: 5 requests per minute per user (falls back to IP if unauthenticated) */
export const sensitiveRateLimit = rateLimitMiddleware(60_000, 5, 'sens', { useUserId: true })
/** Upload endpoints: 10 requests per minute per user (falls back to IP if unauthenticated) */
export const uploadRateLimit = rateLimitMiddleware(60_000, 10, 'upload', { useUserId: true })
/** WebSocket upgrade: 30 attempts per minute per IP — prevents connection exhaustion attacks */
export const wsUpgradeRateLimit = rateLimitMiddleware(60_000, 30, 'ws_upgrade')
