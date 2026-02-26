import { getRedis, INCR_WITH_EXPIRE_LUA, isRedisEnabled } from '../lib/redis.js'
import { BoundedTTLMap } from '../lib/bounded-ttl-map.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('WsRateLimit')

// In-memory fallback counters when Redis is unavailable for WS rate limiting.
// Process-local: effective limit is (max x number-of-processes) in multi-process deployments.
const counters = new BoundedTTLMap<number>(10_000)

/**
 * In-memory rate limit check using a fixed-window counter.
 * Returns true if the request should be rejected (over limit).
 */
export function wsMemoryRateLimit(compositeKey: string, window: number, max: number): boolean {
  const windowMs = window * 1000
  const count = counters.get(compositeKey)
  if (count === undefined) {
    counters.set(compositeKey, 1, windowMs)
    return false
  }
  const newCount = count + 1
  // Update counter without resetting the TTL window (fixed-window behavior)
  counters.update(compositeKey, newCount)
  return newCount > max
}

/**
 * Check if a client message should be rate-limited.
 * Uses Redis when available, falls back to in-memory counters.
 */
export async function isWsRateLimited(
  keySuffix: string,
  window: number,
  max: number,
): Promise<boolean> {
  if (!isRedisEnabled()) {
    return wsMemoryRateLimit(keySuffix, window, max)
  }

  try {
    const redis = getRedis()
    const key = `ws:rate:${keySuffix}`
    const count = (await redis.eval(INCR_WITH_EXPIRE_LUA, 1, key, String(window))) as number
    return count > max
  } catch {
    // Redis unavailable — fallback to in-memory rate limiting (fail-open degradation)
    log.warn('Redis unavailable for WS rate limiting, using in-memory fallback')
    return wsMemoryRateLimit(keySuffix, window, max)
  }
}

/** Stop the periodic WS rate limit counter cleanup (for graceful shutdown / tests). */
export function stopWsRateCleanup() {
  counters.stop()
}
