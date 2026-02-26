/**
 * A Map with a fixed capacity and automatic TTL-based expiration.
 * Entries older than their TTL are lazily cleaned during access and periodically
 * via a background timer. When at capacity, expired entries are evicted first;
 * if still full, the oldest entry (insertion order) is evicted.
 *
 * Used throughout the codebase for in-memory rate limit counters, caches,
 * and cooldown trackers as a Redis fallback.
 */
export class BoundedTTLMap<V> {
  private map = new Map<string, { value: V; expiresAt: number }>()
  private timer: ReturnType<typeof setInterval> | null
  private readonly maxSize: number

  constructor(maxSize: number, cleanupIntervalMs = 60_000) {
    this.maxSize = maxSize
    this.timer = setInterval(() => this.evictExpired(), cleanupIntervalMs)
    this.timer.unref()
  }

  /** Get a non-expired entry. Returns undefined if missing or expired. */
  get(key: string): V | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    return entry.value
  }

  /** Check if a non-expired entry exists. */
  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  /** Set an entry with a TTL in milliseconds. Evicts if at capacity. */
  set(key: string, value: V, ttlMs: number): void {
    if (this.map.size >= this.maxSize && !this.map.has(key)) {
      this.evictExpired()
      if (this.map.size >= this.maxSize) {
        // Evict oldest entry (first in insertion order)
        const oldestKey = this.map.keys().next().value
        if (oldestKey !== undefined) this.map.delete(oldestKey)
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  /**
   * Update the value of an existing non-expired entry without resetting its TTL.
   * Returns true if the entry existed and was updated. Used by rate limiters to
   * increment counters within a fixed window without extending the window.
   */
  update(key: string, value: V): boolean {
    const entry = this.map.get(key)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return false
    }
    entry.value = value
    return true
  }

  /** Delete an entry. Returns true if it existed. */
  delete(key: string): boolean {
    return this.map.delete(key)
  }

  /** Current number of entries (including potentially expired ones). */
  get size(): number {
    return this.map.size
  }

  /** Remove all expired entries. */
  evictExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.map) {
      if (now > entry.expiresAt) this.map.delete(key)
    }
  }

  /** Stop the periodic cleanup timer (for graceful shutdown / tests). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Clear all entries and stop the timer. */
  clear(): void {
    this.map.clear()
    this.stop()
  }
}
