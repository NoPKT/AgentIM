import Redis from 'ioredis'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('Redis')

let redis: Redis | null = null

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000)
        log.warn(`Reconnecting to Redis (attempt ${times}, delay ${delay}ms)`)
        return delay
      },
      lazyConnect: true,
    })
    redis.on('error', (err) => {
      log.error(`Redis error: ${err.message}`)
    })
    redis.on('connect', () => {
      log.info('Connected to Redis')
    })
    redis.connect().catch((err) => {
      log.error(`Redis initial connection failed: ${err.message}`)
    })
  }
  return redis
}

/** Ensure Redis is reachable before the server starts accepting requests. */
export async function ensureRedisConnected(retries = 3, delayMs = 1000): Promise<void> {
  const r = getRedis()
  for (let i = 0; i < retries; i++) {
    try {
      await r.ping()
      log.info('Redis health check passed')
      return
    } catch (err) {
      log.warn(`Redis health check attempt ${i + 1}/${retries} failed: ${(err as Error).message}`)
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  throw new Error(`Redis is not reachable after ${retries} attempts`)
}

/** Create a dedicated Redis connection for Pub/Sub (subscriber mode). */
export function createRedisSubscriber(): Redis {
  const sub = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null, // subscriber connections must not timeout
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000)
      log.warn(`Pub/Sub subscriber reconnecting (attempt ${times}, delay ${delay}ms)`)
      return delay
    },
    lazyConnect: true,
  })
  sub.on('error', (err) => {
    log.error(`Redis subscriber error: ${err.message}`)
  })
  return sub
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit()
    redis = null
  }
}

/**
 * Atomic INCR + EXPIRE-on-first Lua script.
 * Used by rate limiter middleware and agent rate limiting in gateway handler.
 * The EXPIRE is set only on the first INCR so that the TTL is not reset on
 * every request, ensuring a fixed window rather than a sliding one.
 */
export const INCR_WITH_EXPIRE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`
