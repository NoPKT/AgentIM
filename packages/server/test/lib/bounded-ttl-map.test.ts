import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { BoundedTTLMap } from '../../src/lib/bounded-ttl-map.js'

describe('BoundedTTLMap', () => {
  let map: BoundedTTLMap<number>

  beforeEach(() => {
    map = new BoundedTTLMap<number>(5, 60_000)
  })

  after(() => {
    // Ensure no dangling timers
    map.stop()
  })

  describe('get / set', () => {
    it('stores and retrieves a value', () => {
      map.set('a', 42, 10_000)
      assert.equal(map.get('a'), 42)
    })

    it('returns undefined for missing keys', () => {
      assert.equal(map.get('missing'), undefined)
    })

    it('returns undefined for expired entries', () => {
      map.set('a', 1, -1) // negative TTL → already expired
      assert.equal(map.get('a'), undefined)
    })

    it('overwrites existing entry', () => {
      map.set('a', 1, 10_000)
      map.set('a', 2, 10_000)
      assert.equal(map.get('a'), 2)
    })
  })

  describe('has', () => {
    it('returns true for existing non-expired entry', () => {
      map.set('a', 1, 10_000)
      assert.equal(map.has('a'), true)
    })

    it('returns false for missing key', () => {
      assert.equal(map.has('nope'), false)
    })

    it('returns false for expired entry', () => {
      map.set('a', 1, -1) // negative TTL → already expired
      assert.equal(map.has('a'), false)
    })
  })

  describe('update', () => {
    it('updates value without resetting TTL', () => {
      map.set('a', 1, 10_000)
      const updated = map.update('a', 5)
      assert.equal(updated, true)
      assert.equal(map.get('a'), 5)
    })

    it('returns false for missing key', () => {
      assert.equal(map.update('nope', 1), false)
    })

    it('returns false for expired key', () => {
      map.set('a', 1, -1) // negative TTL → already expired
      assert.equal(map.update('a', 2), false)
    })
  })

  describe('delete', () => {
    it('deletes an existing entry', () => {
      map.set('a', 1, 10_000)
      assert.equal(map.delete('a'), true)
      assert.equal(map.get('a'), undefined)
    })

    it('returns false for non-existent key', () => {
      assert.equal(map.delete('nope'), false)
    })
  })

  describe('size', () => {
    it('reflects number of entries', () => {
      assert.equal(map.size, 0)
      map.set('a', 1, 10_000)
      assert.equal(map.size, 1)
      map.set('b', 2, 10_000)
      assert.equal(map.size, 2)
    })

    it('includes expired entries until eviction', () => {
      map.set('a', 1, -1) // already expired
      // Size includes expired entries (lazy eviction)
      assert.equal(map.size, 1)
    })
  })

  describe('capacity eviction', () => {
    it('evicts oldest entry when at capacity', () => {
      map.set('a', 1, 10_000)
      map.set('b', 2, 10_000)
      map.set('c', 3, 10_000)
      map.set('d', 4, 10_000)
      map.set('e', 5, 10_000)
      // At capacity (5), adding another should evict 'a'
      map.set('f', 6, 10_000)
      assert.equal(map.get('a'), undefined)
      assert.equal(map.get('f'), 6)
      assert.equal(map.size, 5)
    })

    it('evicts expired entries before oldest when at capacity', () => {
      map.set('expired1', 1, -1) // already expired
      map.set('b', 2, 10_000)
      map.set('c', 3, 10_000)
      map.set('d', 4, 10_000)
      map.set('e', 5, 10_000)
      // At capacity, but 'expired1' should be evicted first
      map.set('f', 6, 10_000)
      assert.equal(map.get('b'), 2) // 'b' survives because expired1 was evicted
      assert.equal(map.get('f'), 6)
    })

    it('does not evict when overwriting existing key', () => {
      map.set('a', 1, 10_000)
      map.set('b', 2, 10_000)
      map.set('c', 3, 10_000)
      map.set('d', 4, 10_000)
      map.set('e', 5, 10_000)
      // Overwriting existing key should not evict
      map.set('a', 99, 10_000)
      assert.equal(map.get('a'), 99)
      assert.equal(map.size, 5)
      // All entries should still exist
      assert.equal(map.get('b'), 2)
      assert.equal(map.get('e'), 5)
    })
  })

  describe('evictExpired', () => {
    it('removes all expired entries', () => {
      map.set('expired1', 1, -1) // already expired
      map.set('expired2', 2, -1) // already expired
      map.set('live', 3, 10_000)
      map.evictExpired()
      assert.equal(map.size, 1)
      assert.equal(map.get('live'), 3)
    })
  })

  describe('stop', () => {
    it('stops the cleanup timer', () => {
      const m = new BoundedTTLMap<number>(10, 100)
      m.stop()
      // Should not throw when called twice
      m.stop()
    })
  })

  describe('clear', () => {
    it('removes all entries and stops timer', () => {
      map.set('a', 1, 10_000)
      map.set('b', 2, 10_000)
      map.clear()
      assert.equal(map.size, 0)
      assert.equal(map.get('a'), undefined)
    })
  })
})
