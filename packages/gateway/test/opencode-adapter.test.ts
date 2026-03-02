import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OpenCodeAdapter } from '../src/adapters/index.js'

function make(env: Record<string, string> = {}) {
  return new OpenCodeAdapter({ agentId: 'oc-test', agentName: 'TestOC', env })
}

// ─── Slash Commands ───

describe('OpenCodeAdapter slash commands', () => {
  it('/clear resets session', async () => {
    const a = make()
    const r = await a.handleSlashCommand('clear', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('cleared'))
    a.dispose()
  })

  it('/model query returns current', async () => {
    const a = make()
    const r = await a.handleSlashCommand('model', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(default)'))
    a.dispose()
  })

  it('/model set with provider/model', async () => {
    const a = make()
    const r = await a.handleSlashCommand('model', 'anthropic/claude-sonnet')
    assert.ok(r.success)
    assert.equal(a.getModel(), 'anthropic/claude-sonnet')
    a.dispose()
  })

  it('/model set without provider', async () => {
    const a = make()
    const r = await a.handleSlashCommand('model', 'gpt-4')
    assert.ok(r.success)
    assert.equal(a.getModel(), 'gpt-4')
    a.dispose()
  })

  it('/cost returns formatted summary', async () => {
    const a = make()
    const r = await a.handleSlashCommand('cost', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('Cost'))
    a.dispose()
  })

  it('unknown command returns failure', async () => {
    const a = make()
    const r = await a.handleSlashCommand('foobar', '')
    assert.equal(r.success, false)
    a.dispose()
  })
})

// ─── Metadata Methods ───

describe('OpenCodeAdapter metadata methods', () => {
  it('getSlashCommands returns 3 commands', () => {
    const a = make()
    const cmds = a.getSlashCommands()
    assert.equal(cmds.length, 3)
    const names = cmds.map((c) => c.name)
    assert.ok(names.includes('clear'))
    assert.ok(names.includes('model'))
    assert.ok(names.includes('cost'))
    a.dispose()
  })

  it('getAvailableModels returns empty initially', () => {
    const a = make()
    assert.deepEqual(a.getAvailableModels(), [])
    a.dispose()
  })

  it('getAvailableModelInfo returns empty initially', () => {
    const a = make()
    assert.deepEqual(a.getAvailableModelInfo(), [])
    a.dispose()
  })

  it('getModel reads env', () => {
    const a = make({ OPENCODE_MODEL_ID: 'gpt-4', OPENCODE_PROVIDER_ID: 'openai' })
    assert.equal(a.getModel(), 'openai/gpt-4')
    a.dispose()
  })

  it('getModel returns undefined when no env', () => {
    const a = make()
    assert.equal(a.getModel(), undefined)
    a.dispose()
  })

  it('type returns opencode', () => {
    const a = make()
    assert.equal(a.type, 'opencode')
    a.dispose()
  })

  it('getAvailableEffortLevels returns empty (not supported)', () => {
    const a = make()
    assert.deepEqual(a.getAvailableEffortLevels(), [])
    a.dispose()
  })

  it('getAvailableThinkingModes returns empty (not supported)', () => {
    const a = make()
    assert.deepEqual(a.getAvailableThinkingModes(), [])
    a.dispose()
  })

  it('getPlanMode returns false (not supported)', () => {
    const a = make()
    assert.equal(a.getPlanMode(), false)
    a.dispose()
  })

  it('getCostSummary returns zero initially', () => {
    const a = make()
    const s = a.getCostSummary()
    assert.equal(s.costUSD, 0)
    assert.equal(s.inputTokens, 0)
    a.dispose()
  })
})
