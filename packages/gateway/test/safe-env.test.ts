import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getSafeEnv } from '../src/adapters/spawn-base.js'

describe('getSafeEnv', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    // Save original values for sensitive keys we'll test with
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'ANTHROPIC_API_KEY', 'MY_CUSTOM_VAR']) {
      savedEnv[key] = process.env[key]
    }
  })

  afterEach(() => {
    // Restore original values
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = val
      }
    }
  })

  it('filters known sensitive env vars', () => {
    process.env.DATABASE_URL = 'postgres://test'
    process.env.JWT_SECRET = 'secret123'
    const env = getSafeEnv()
    assert.equal(env.DATABASE_URL, undefined)
    assert.equal(env.JWT_SECRET, undefined)
  })

  it('keeps non-sensitive env vars', () => {
    process.env.MY_CUSTOM_VAR = 'hello'
    const env = getSafeEnv()
    assert.equal(env.MY_CUSTOM_VAR, 'hello')
  })

  it('allows passEnv to whitelist non-critical sensitive vars', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const env = getSafeEnv(new Set(['ANTHROPIC_API_KEY']))
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-test')
  })

  it('never passes through NEVER_PASSABLE_KEYS even with passEnv', () => {
    process.env.JWT_SECRET = 'supersecret'
    process.env.DATABASE_URL = 'postgres://test'
    const env = getSafeEnv(new Set(['JWT_SECRET', 'DATABASE_URL']))
    assert.equal(env.JWT_SECRET, undefined)
    assert.equal(env.DATABASE_URL, undefined)
  })

  it('filters vars matching sensitive prefixes', () => {
    process.env.ROUTER_LLM_API_KEY = 'key123'
    const env = getSafeEnv()
    assert.equal(env.ROUTER_LLM_API_KEY, undefined)
    delete process.env.ROUTER_LLM_API_KEY
  })
})
