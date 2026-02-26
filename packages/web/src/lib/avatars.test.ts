import { describe, it, expect } from 'vitest'
import { getAvatarGradient } from './avatars.js'

describe('getAvatarGradient', () => {
  it('generates consistent gradient for the same input', () => {
    const g1 = getAvatarGradient('Alice')
    const g2 = getAvatarGradient('Alice')
    expect(g1).toBe(g2)
  })

  it('returns different gradients for different starting letters', () => {
    const gA = getAvatarGradient('alice')
    const gB = getAvatarGradient('bob')
    // 'a' and 'b' map to different gradient slots
    expect(gA).not.toBe(gB)
  })

  it('handles uppercase letters (case-insensitive)', () => {
    const lower = getAvatarGradient('alice')
    const upper = getAvatarGradient('Alice')
    expect(lower).toBe(upper)
  })

  it('returns the first gradient for empty string', () => {
    const result = getAvatarGradient('')
    // Empty string: charAt(0) returns '', indexOf('') returns 0 -> first gradient
    expect(result).toBe('from-purple-500 to-violet-600')
  })

  it('returns the fallback gradient for special characters', () => {
    const result = getAvatarGradient('#special')
    expect(result).toBe('from-blue-500 to-indigo-600')
  })

  it('returns the fallback gradient for numeric starting character', () => {
    const result = getAvatarGradient('123abc')
    expect(result).toBe('from-blue-500 to-indigo-600')
  })

  it('returns a valid gradient class string for all alphabet letters', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'
    for (const letter of alphabet) {
      const gradient = getAvatarGradient(letter)
      expect(gradient).toMatch(/^from-\w+-\d+ to-\w+-\d+$/)
    }
  })

  it('wraps around gradients for letters beyond the gradient map size', () => {
    // There are 6 gradient entries, so letters beyond 'f' should wrap
    const gA = getAvatarGradient('a') // idx 0 -> 0 % 6 = 0
    const gG = getAvatarGradient('g') // idx 6 -> 6 % 6 = 0
    expect(gA).toBe(gG)
  })

  it('returns the fallback gradient for emoji input', () => {
    const result = getAvatarGradient('\u{1F600}')
    expect(result).toBe('from-blue-500 to-indigo-600')
  })

  it('returns the fallback gradient for whitespace input', () => {
    const result = getAvatarGradient(' ')
    expect(result).toBe('from-blue-500 to-indigo-600')
  })
})
