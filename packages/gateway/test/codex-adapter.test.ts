import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CodexAdapter } from '../src/adapters/index.js'

function make(env: Record<string, string> = {}) {
  return new CodexAdapter({ agentId: 'cx-test', agentName: 'TestCX', env })
}

// ─── Slash Commands ───

describe('CodexAdapter slash commands', () => {
  it('/clear resets thread', async () => {
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

  it('/model set changes model and restarts thread', async () => {
    const a = make()
    const r = await a.handleSlashCommand('model', 'o3')
    assert.ok(r.success)
    assert.equal(a.getModel(), 'o3')
    assert.ok(r.message?.includes('thread will restart'))
    a.dispose()
  })

  it('/effort set valid levels', async () => {
    const a = make()
    for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
      const r = await a.handleSlashCommand('effort', level)
      assert.ok(r.success, `effort ${level} should succeed`)
      assert.equal(a.getEffortLevel(), level)
    }
    a.dispose()
  })

  it('/effort query', async () => {
    const a = make()
    const r = await a.handleSlashCommand('effort', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(default)'))
    a.dispose()
  })

  it('/effort invalid', async () => {
    const a = make()
    const r = await a.handleSlashCommand('effort', 'turbo')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/cost returns token usage', async () => {
    const a = make()
    const r = await a.handleSlashCommand('cost', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('Token Usage'))
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

describe('CodexAdapter metadata methods', () => {
  it('getSlashCommands returns 4 commands', () => {
    const a = make()
    const cmds = a.getSlashCommands()
    assert.equal(cmds.length, 4)
    const names = cmds.map((c) => c.name)
    assert.ok(names.includes('clear'))
    assert.ok(names.includes('model'))
    assert.ok(names.includes('effort'))
    assert.ok(names.includes('cost'))
    a.dispose()
  })

  it('getAvailableModels returns known models', () => {
    const a = make()
    const models = a.getAvailableModels()
    assert.ok(models.length >= 4)
    assert.ok(models.includes('codex-mini'))
    assert.ok(models.includes('o3'))
    a.dispose()
  })

  it('getAvailableEffortLevels returns 5 levels', () => {
    const a = make()
    const levels = a.getAvailableEffortLevels()
    assert.equal(levels.length, 5)
    assert.deepEqual(levels, ['minimal', 'low', 'medium', 'high', 'xhigh'])
    a.dispose()
  })

  it('getModel reads env CODEX_MODEL', () => {
    const a = make({ CODEX_MODEL: 'o4-mini' })
    assert.equal(a.getModel(), 'o4-mini')
    a.dispose()
  })

  it('getModel returns undefined when no env', () => {
    const a = make()
    assert.equal(a.getModel(), undefined)
    a.dispose()
  })

  it('type returns codex', () => {
    const a = make()
    assert.equal(a.type, 'codex')
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
    assert.equal(s.outputTokens, 0)
    a.dispose()
  })
})
