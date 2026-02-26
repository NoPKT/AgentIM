import { getRedis, INCR_WITH_EXPIRE_LUA, isRedisEnabled } from '../lib/redis.js'
import { createLogger } from '../lib/logger.js'
import { config, getConfigSync } from '../config.js'

const log = createLogger('AgentRateLimit')

// In-memory agent rate limit counters when Redis is not available
const MAX_AGENT_RATE_COUNTERS = 10_000
const agentRateCounters = new Map<string, { count: number; resetAt: number }>()

// Periodically clean up expired agent rate limit counters
let agentRateCleanupTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of agentRateCounters) {
    if (now > entry.resetAt) agentRateCounters.delete(key)
  }
}, 60_000)
agentRateCleanupTimer.unref()

/** Stop the periodic agent rate limit counter cleanup. */
export function stopAgentRateCleanup() {
  if (agentRateCleanupTimer) {
    clearInterval(agentRateCleanupTimer)
    agentRateCleanupTimer = null
  }
}

/**
 * In-memory agent rate limit check using a fixed-window counter.
 * Returns true if the request should be rejected (over limit).
 */
function agentMemoryRateLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  const entry = agentRateCounters.get(key)
  if (!entry || now > entry.resetAt) {
    if (agentRateCounters.size >= MAX_AGENT_RATE_COUNTERS && !agentRateCounters.has(key)) {
      for (const [k, e] of agentRateCounters) {
        if (now > e.resetAt) agentRateCounters.delete(k)
      }
      if (agentRateCounters.size >= MAX_AGENT_RATE_COUNTERS) {
        const oldestKey = agentRateCounters.keys().next().value
        if (oldestKey) agentRateCounters.delete(oldestKey)
      }
    }
    agentRateCounters.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count++
  return entry.count > max
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
