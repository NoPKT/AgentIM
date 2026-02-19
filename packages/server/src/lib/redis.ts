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

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit()
    redis = null
  }
}
