import { getRedis, INCR_WITH_EXPIRE_LUA, isRedisEnabled } from '../lib/redis.js'
import { BoundedTTLMap } from '../lib/bounded-ttl-map.js'
import { createLogger } from '../lib/logger.js'
import { config, getConfigSync } from '../config.js'

const log = createLogger('AgentRateLimit')

// In-memory agent rate limit counters when Redis is not available
const counters = new BoundedTTLMap<number>(10_000)

/** Stop the periodic agent rate limit counter cleanup. */
export function stopAgentRateCleanup() {
  counters.stop()
}

/**
 * In-memory agent rate limit check using a fixed-window counter.
 * Returns true if the request should be rejected (over limit).
 */
function agentMemoryRateLimit(key: string, windowMs: number, max: number): boolean {
  const count = counters.get(key)
  if (count === undefined) {
    counters.set(key, 1, windowMs)
    return false
  }
  const newCount = count + 1
  // Update counter without resetting the TTL window (fixed-window behavior)
  counters.update(key, newCount)
  return newCount > max
}

/**
 * Check if an agent message should be rate-limited.
 * Uses Redis when available, falls back to in-memory counters.
 */
export async function isAgentRateLimited(
  agentId: string,
  rateLimitWindow?: number,
  rateLimitMax?: number,
): Promise<boolean> {
  const windowSec =
    rateLimitWindow ??
    (getConfigSync<number>('rateLimit.agent.window') || config.agentRateLimitWindow)
  const max =
    rateLimitMax ?? (getConfigSync<number>('rateLimit.agent.max') || config.agentRateLimitMax)

  if (!isRedisEnabled()) {
    const key = `ws:agent_rate:${agentId}`
    const windowMs = windowSec * 1000
    return agentMemoryRateLimit(key, windowMs, max)
  }

  try {
    const redis = getRedis()
    const key = `ws:agent_rate:${agentId}`
    const count = (await redis.eval(INCR_WITH_EXPIRE_LUA, 1, key, windowSec)) as number
    return count > max
  } catch {
    // Redis unavailable — fallback to in-memory rate limiting (fail-open, consistent with clientHandler)
    log.warn('Redis unavailable for agent rate limiting, using in-memory fallback')
    const key = `ws:agent_rate:${agentId}`
    const windowMs = windowSec * 1000
    return agentMemoryRateLimit(key, windowMs, max)
  }
}
