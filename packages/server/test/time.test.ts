import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseExpiryMs } from '../src/lib/time.js'

const DEFAULT_MS = 7 * 24 * 60 * 60 * 1000 // 604800000 (7 days)

describe('parseExpiryMs', () => {
  it('parses seconds', () => {
    assert.equal(parseExpiryMs('10s'), 10_000)
  })

  it('parses minutes', () => {
    assert.equal(parseExpiryMs('30m'), 1_800_000)
  })

  it('parses hours', () => {
    assert.equal(parseExpiryMs('24h'), 86_400_000)
  })

  it('parses days', () => {
    assert.equal(parseExpiryMs('7d'), 604_800_000)
  })

  it('returns default for invalid input', () => {
    assert.equal(parseExpiryMs('invalid'), DEFAULT_MS)
  })

  it('returns default for empty string', () => {
    assert.equal(parseExpiryMs(''), DEFAULT_MS)
  })

  it('returns default for missing unit', () => {
    assert.equal(parseExpiryMs('100'), DEFAULT_MS)
  })

  it('handles whitespace between number and unit', () => {
    assert.equal(parseExpiryMs('10 s'), 10_000)
  })

  it('returns 0 for zero value', () => {
    assert.equal(parseExpiryMs('0s'), 0)
  })
})
