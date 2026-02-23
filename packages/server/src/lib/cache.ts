import { getRedis, isRedisEnabled } from './redis.js'

export const USER_CACHE_TTL = 300 // 5 minutes
export const ROOM_MEMBERS_CACHE_TTL = 60 // 1 minute

export function userCacheKey(userId: string): string {
  return `cache:user:${userId}`
}

export function roomMembersCacheKey(roomId: string): string {
  return `cache:room_members:${roomId}`
}

// ─── In-memory cache fallback when Redis is not available ───
const MAX_MEMORY_CACHE_SIZE = 10_000

interface MemoryCacheEntry {
  value: unknown
  expiresAt: number
}

const memoryCache = new Map<string, MemoryCacheEntry>()

function evictExpiredMemoryEntries() {
  const now = Date.now()
  for (const [key, entry] of memoryCache) {
    if (now > entry.expiresAt) {
      memoryCache.delete(key)
    }
  }
}

// Periodic cleanup every 60s
const cleanupTimer = setInterval(evictExpiredMemoryEntries, 60_000)
cleanupTimer.unref()

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!isRedisEnabled()) {
    const entry = memoryCache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      memoryCache.delete(key)
      return null
    }
    // Move to end for LRU ordering
    memoryCache.delete(key)
    memoryCache.set(key, entry)
    return entry.value as T
  }
  try {
    const val = await getRedis().get(key)
    if (!val) return null
    return JSON.parse(val) as T
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!isRedisEnabled()) {
    if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE && !memoryCache.has(key)) {
      evictExpiredMemoryEntries()
      // If still over capacity, evict least-recently-used entry
      if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE) {
        const lru = memoryCache.keys().next().value
        if (lru) memoryCache.delete(lru)
      }
    }
    memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    return
  }
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // Non-fatal — cache writes can fail without affecting correctness
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  if (!isRedisEnabled()) {
    for (const key of keys) {
      memoryCache.delete(key)
    }
    return
  }
  try {
    await getRedis().del(...keys)
  } catch {
    // Non-fatal — cache will expire on its own
  }
}
