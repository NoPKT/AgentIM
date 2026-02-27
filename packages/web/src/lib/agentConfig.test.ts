import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { getStatusConfig, getTypeConfig, agentGradients } from './agentConfig.js'

// Simple mock t function that returns the key as-is
const t: TFunction = ((key: string) => key) as TFunction

describe('getStatusConfig', () => {
  const statusConfig = getStatusConfig(t)

  it('returns config for all four statuses', () => {
    expect(Object.keys(statusConfig)).toEqual(['online', 'offline', 'busy', 'error'])
  })

  it('each status has color, label, textColor, bgColor', () => {
    for (const key of ['online', 'offline', 'busy', 'error'] as const) {
      const cfg = statusConfig[key]
      expect(cfg).toHaveProperty('color')
      expect(cfg).toHaveProperty('label')
      expect(cfg).toHaveProperty('textColor')
      expect(cfg).toHaveProperty('bgColor')
      expect(typeof cfg.color).toBe('string')
      expect(typeof cfg.label).toBe('string')
      expect(typeof cfg.textColor).toBe('string')
      expect(typeof cfg.bgColor).toBe('string')
    }
  })

  it('online has green color', () => {
    expect(statusConfig.online.color).toContain('green')
  })

  it('offline has gray color', () => {
    expect(statusConfig.offline.color).toContain('gray')
  })

  it('busy has yellow color', () => {
    expect(statusConfig.busy.color).toContain('yellow')
  })

  it('error has red color', () => {
    expect(statusConfig.error.color).toContain('red')
  })

  it('uses t function for labels', () => {
    expect(statusConfig.online.label).toBe('common.online')
    expect(statusConfig.offline.label).toBe('common.offline')
    expect(statusConfig.busy.label).toBe('common.busy')
    expect(statusConfig.error.label).toBe('common.error')
  })
})

describe('getTypeConfig', () => {
  const typeConfig = getTypeConfig(t)

  it('returns config for all six agent types', () => {
    const keys = Object.keys(typeConfig)
    expect(keys).toContain('claude-code')
    expect(keys).toContain('codex')
    expect(keys).toContain('gemini')
    expect(keys).toContain('opencode')
    expect(keys).toContain('cursor')
    expect(keys).toContain('generic')
  })

  it('each type has label and color', () => {
    for (const key of Object.keys(typeConfig)) {
      const cfg = typeConfig[key]
      expect(cfg).toHaveProperty('label')
      expect(cfg).toHaveProperty('color')
      expect(typeof cfg.label).toBe('string')
      expect(typeof cfg.color).toBe('string')
    }
  })

  it('uses t function for labels', () => {
    expect(typeConfig['claude-code'].label).toBe('agent.claudeCode')
    expect(typeConfig['codex'].label).toBe('agent.codex')
    expect(typeConfig['gemini'].label).toBe('agent.gemini')
    expect(typeConfig['opencode'].label).toBe('agent.opencode')
    expect(typeConfig['cursor'].label).toBe('agent.cursor')
    expect(typeConfig['generic'].label).toBe('agent.generic')
  })

  it('color strings contain CSS classes', () => {
    for (const key of Object.keys(typeConfig)) {
      // All color values should be non-empty CSS class strings
      expect(typeConfig[key].color.length).toBeGreaterThan(0)
    }
  })
})

describe('agentGradients', () => {
  it('has gradient strings for all six agent types', () => {
    expect(Object.keys(agentGradients)).toEqual([
      'claude-code',
      'codex',
      'gemini',
      'opencode',
      'cursor',
      'generic',
    ])
  })

  it('each gradient contains "from-" and "to-" classes', () => {
    for (const key of Object.keys(agentGradients)) {
      expect(agentGradients[key]).toMatch(/from-/)
      expect(agentGradients[key]).toMatch(/to-/)
    }
  })

  it('claude-code has purple/violet gradient', () => {
    expect(agentGradients['claude-code']).toContain('purple')
    expect(agentGradients['claude-code']).toContain('violet')
  })

  it('codex has blue/indigo gradient', () => {
    expect(agentGradients['codex']).toContain('blue')
    expect(agentGradients['codex']).toContain('indigo')
  })

  it('generic has gray gradient', () => {
    expect(agentGradients['generic']).toContain('gray')
  })
})
