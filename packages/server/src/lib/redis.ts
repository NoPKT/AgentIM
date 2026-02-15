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

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit()
    redis = null
  }
}
