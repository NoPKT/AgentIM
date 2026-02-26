import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { wsMemoryRateLimit, stopWsRateCleanup } from '../../src/ws/wsRateLimit.js'

after(async () => {
  stopWsRateCleanup()
  // Close persistent connections opened by transitive imports (redis, db)
  const { closeRedis } = await import('../../src/lib/redis.js')
  const { closeDb } = await import('../../src/db/index.js')
  await closeRedis()
  await closeDb()
})

describe('wsMemoryRateLimit', () => {
  it('allows requests under the limit', () => {
    const key = `ws-test-${Date.now()}-under`
    const window = 60 // seconds
    const max = 5

    for (let i = 0; i < max; i++) {
      assert.equal(wsMemoryRateLimit(key, window, max), false, `request ${i + 1} should be allowed`)
    }
  })

  it('rejects requests over the limit', () => {
    const key = `ws-test-${Date.now()}-over`
    const window = 60
    const max = 3

    // Fill up the limit
    for (let i = 0; i < max; i++) {
      wsMemoryRateLimit(key, window, max)
    }

    // Next request should be rejected
    assert.equal(wsMemoryRateLimit(key, window, max), true)
  })

  it('uses fixed-window behavior (counter resets after TTL, not on each request)', () => {
    const key = `ws-test-${Date.now()}-window`
    const window = 60
    const max = 2

    // First request initializes counter
    assert.equal(wsMemoryRateLimit(key, window, max), false)
    // Second request increments
    assert.equal(wsMemoryRateLimit(key, window, max), false)
    // Third request exceeds limit
    assert.equal(wsMemoryRateLimit(key, window, max), true)
  })

  it('different keys are independent', () => {
    const key1 = `ws-test-${Date.now()}-k1`
    const key2 = `ws-test-${Date.now()}-k2`
    const window = 60
    const max = 1

    assert.equal(wsMemoryRateLimit(key1, window, max), false)
    assert.equal(wsMemoryRateLimit(key1, window, max), true) // key1 over limit
    assert.equal(wsMemoryRateLimit(key2, window, max), false) // key2 still ok
  })

  it('allows requests again after TTL expires', async () => {
    const key = `ws-test-${Date.now()}-expire`
    const window = 1 // 1 second window
    const max = 1

    assert.equal(wsMemoryRateLimit(key, window, max), false)
    assert.equal(wsMemoryRateLimit(key, window, max), true) // over limit

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 1100))

    // After expiry, should be allowed again
    assert.equal(wsMemoryRateLimit(key, window, max), false)
  })
})
