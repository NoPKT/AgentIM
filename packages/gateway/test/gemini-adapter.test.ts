import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GeminiAdapter } from '../src/adapters/index.js'

function make(env: Record<string, string> = {}) {
  return new GeminiAdapter({ agentId: 'gem-test', agentName: 'TestGemini', env })
}

// ─── Basic Properties ───

describe('GeminiAdapter basic properties', () => {
  it('type returns gemini', () => {
    const a = make()
    assert.equal(a.type, 'gemini')
    a.dispose()
  })

  it('getPlanMode defaults to false', () => {
    const a = make()
    assert.equal(a.getPlanMode(), false)
    a.dispose()
  })

  it('getModel reads env GEMINI_MODEL', () => {
    const a = make({ GEMINI_MODEL: 'gemini-2.5-flash' })
    assert.equal(a.getModel(), 'gemini-2.5-flash')
    a.dispose()
  })

  it('getModel returns undefined with no env', () => {
    const a = make()
    assert.equal(a.getModel(), undefined)
    a.dispose()
  })

  it('getCostSummary returns zero initially', () => {
    const a = make()
    const s = a.getCostSummary()
    assert.equal(s.costUSD, 0)
    assert.equal(s.inputTokens, 0)
    assert.equal(s.outputTokens, 0)
    assert.equal(s.cacheReadTokens, 0)
    a.dispose()
  })
})

// ─── Model Management ───

describe('GeminiAdapter model management', () => {
  it('getAvailableModels returns models from SDK', async () => {
    const a = make()
    // Wait for async SDK load triggered in constructor
    await new Promise((r) => setTimeout(r, 200))
    const models = a.getAvailableModels()
    assert.ok(models.length >= 5)
    assert.ok(models.includes('gemini-2.5-pro'))
    assert.ok(models.includes('gemini-2.5-flash'))
    assert.ok(models.includes('gemini-3-pro-preview'))
    a.dispose()
  })

  it('getAvailableModelInfo returns ModelOption array from SDK', async () => {
    const a = make()
    await new Promise((r) => setTimeout(r, 200))
    const info = a.getAvailableModelInfo()
    assert.ok(info.length >= 5)
    const first = info[0]
    assert.ok(first.value)
    assert.ok(first.displayName)
    a.dispose()
  })
})

// ─── Slash Commands ───

describe('GeminiAdapter slash commands', () => {
  it('getSlashCommands returns 6 commands', () => {
    const a = make()
    const cmds = a.getSlashCommands()
    assert.equal(cmds.length, 6)
    const names = cmds.map((c) => c.name)
    assert.ok(names.includes('clear'))
    assert.ok(names.includes('compact'))
    assert.ok(names.includes('model'))
    assert.ok(names.includes('cost'))
    assert.ok(names.includes('plan'))
    assert.ok(names.includes('think'))
    a.dispose()
  })

  it('/clear resets session', async () => {
    const a = make()
    const r = await a.handleSlashCommand('clear', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('cleared'))
    a.dispose()
  })

  it('/compact succeeds with no active session', async () => {
    const a = make()
    const r = await a.handleSlashCommand('compact', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('No active session'))
    a.dispose()
  })

  it('/model query returns current (default)', async () => {
    const a = make()
    const r = await a.handleSlashCommand('model', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(default)'))
    a.dispose()
  })

  it('/model gemini-2.5-flash sets model', async () => {
    const a = make()
    const r = await a.handleSlashCommand('model', 'gemini-2.5-flash')
    assert.ok(r.success)
    assert.equal(a.getModel(), 'gemini-2.5-flash')
    assert.ok(r.message?.includes('gemini-2.5-flash'))
    a.dispose()
  })

  it('/cost returns formatted summary', async () => {
    const a = make()
    const r = await a.handleSlashCommand('cost', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('Token Usage'))
    a.dispose()
  })

  it('/plan toggles plan mode', async () => {
    const a = make()
    assert.equal(a.getPlanMode(), false)
    const r1 = await a.handleSlashCommand('plan', '')
    assert.ok(r1.success)
    assert.equal(a.getPlanMode(), true)
    const r2 = await a.handleSlashCommand('plan', '')
    assert.ok(r2.success)
    assert.equal(a.getPlanMode(), false)
    a.dispose()
  })

  it('/plan on enables plan mode', async () => {
    const a = make()
    const r = await a.handleSlashCommand('plan', 'on')
    assert.ok(r.success)
    assert.equal(a.getPlanMode(), true)
    assert.ok(r.message?.includes('enabled'))
    a.dispose()
  })

  it('/plan off disables plan mode', async () => {
    const a = make()
    await a.handleSlashCommand('plan', 'on')
    const r = await a.handleSlashCommand('plan', 'off')
    assert.ok(r.success)
    assert.equal(a.getPlanMode(), false)
    assert.ok(r.message?.includes('disabled'))
    a.dispose()
  })

  it('unknown command returns failure', async () => {
    const a = make()
    const r = await a.handleSlashCommand('foobar', '')
    assert.equal(r.success, false)
    a.dispose()
  })
})

// ─── Lifecycle ───

describe('GeminiAdapter lifecycle', () => {
  it('stop resets running state', () => {
    const a = make()
    a.stop()
    assert.equal(a.running, false)
    a.dispose()
  })

  it('dispose cleans up', () => {
    const a = make()
    a.dispose()
    assert.equal(a.running, false)
  })
})
