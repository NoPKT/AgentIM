import { getRedis } from './redis.js'

export const USER_CACHE_TTL = 300 // 5 minutes
export const ROOM_MEMBERS_CACHE_TTL = 60 // 1 minute

export function userCacheKey(userId: string): string {
  return `cache:user:${userId}`
}

export function roomMembersCacheKey(roomId: string): string {
  return `cache:room_members:${roomId}`
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const val = await getRedis().get(key)
    if (!val) return null
    return JSON.parse(val) as T
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // Non-fatal — cache writes can fail without affecting correctness
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    await getRedis().del(...keys)
  } catch {
    // Non-fatal — cache will expire on its own
  }
}
