import { getRedis, INCR_WITH_EXPIRE_LUA, isRedisEnabled } from '../lib/redis.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('WsRateLimit')

// In-memory fallback counters when Redis is unavailable for WS rate limiting.
// Process-local: effective limit is (max x number-of-processes) in multi-process deployments.
const MAX_WS_MEMORY_COUNTERS = 10_000
const wsMemoryCounters = new Map<string, { count: number; resetAt: number }>()

// Periodically clean up expired WS rate limit counters
let wsRateCleanupTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of wsMemoryCounters) {
    if (now > entry.resetAt) wsMemoryCounters.delete(key)
  }
}, 60_000)
wsRateCleanupTimer.unref()

/**
 * In-memory rate limit check using a fixed-window counter.
 * Returns true if the request should be rejected (over limit).
 */
export function wsMemoryRateLimit(compositeKey: string, window: number, max: number): boolean {
  const now = Date.now()
  const windowMs = window * 1000
  const entry = wsMemoryCounters.get(compositeKey)
  if (!entry || now > entry.resetAt) {
    // Enforce capacity limit — evict expired entries first
    if (wsMemoryCounters.size >= MAX_WS_MEMORY_COUNTERS && !wsMemoryCounters.has(compositeKey)) {
      for (const [k, e] of wsMemoryCounters) {
        if (now > e.resetAt) wsMemoryCounters.delete(k)
      }
      if (wsMemoryCounters.size >= MAX_WS_MEMORY_COUNTERS) {
        const oldestKey = wsMemoryCounters.keys().next().value
        if (oldestKey) wsMemoryCounters.delete(oldestKey)
      }
    }
    wsMemoryCounters.set(compositeKey, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count++
  return entry.count > max
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
  if (wsRateCleanupTimer) {
    clearInterval(wsRateCleanupTimer)
    wsRateCleanupTimer = null
  }
}
