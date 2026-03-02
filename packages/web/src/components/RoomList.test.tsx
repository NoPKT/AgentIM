import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatTimeAgo } from './RoomList.js'

// Use stable timestamps for deterministic tests
const NOW = new Date('2026-03-01T12:00:00Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('formatTimeAgo', () => {
  it('formats seconds ago', () => {
    const date = new Date(NOW - 30 * 1000).toISOString()
    const result = formatTimeAgo(date, 'en')
    expect(result).toMatch(/30 seconds ago/)
  })

  it('formats minutes ago', () => {
    const date = new Date(NOW - 5 * 60 * 1000).toISOString()
    const result = formatTimeAgo(date, 'en')
    expect(result).toMatch(/5 minutes ago/)
  })

  it('formats hours ago', () => {
    const date = new Date(NOW - 3 * 60 * 60 * 1000).toISOString()
    const result = formatTimeAgo(date, 'en')
    expect(result).toMatch(/3 hours ago/)
  })

  it('formats days ago', () => {
    const date = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString()
    const result = formatTimeAgo(date, 'en')
    expect(result).toMatch(/2 days ago/)
  })

  it('formats dates older than 30 days as absolute date', () => {
    const date = new Date(NOW - 60 * 24 * 60 * 60 * 1000).toISOString()
    const result = formatTimeAgo(date, 'en')
    // Should contain month and year, not "X days ago"
    expect(result).not.toMatch(/ago/)
    expect(result).toMatch(/2025|2026/)
  })

  it('handles 0 seconds ago', () => {
    const date = new Date(NOW).toISOString()
    const result = formatTimeAgo(date, 'en')
    // Should be "now" or "0 seconds ago" depending on locale
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles 59 seconds (still seconds)', () => {
    const date = new Date(NOW - 59 * 1000).toISOString()
    const result = formatTimeAgo(date, 'en')
    expect(result).toMatch(/second/)
  })

  it('handles 60 seconds (becomes 1 minute)', () => {
    const date = new Date(NOW - 60 * 1000).toISOString()
    const result = formatTimeAgo(date, 'en')
    expect(result).toMatch(/minute/)
  })
})
