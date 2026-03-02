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
    assert.ok(r.message?.includes('codex-mini-latest'))
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

  it('/sandbox set valid mode', async () => {
    const a = make()
    const r = await a.handleSlashCommand('sandbox', 'read-only')
    assert.ok(r.success)
    assert.ok(r.message?.includes('read-only'))
    a.dispose()
  })

  it('/sandbox workspace-write', async () => {
    const a = make()
    const r = await a.handleSlashCommand('sandbox', 'workspace-write')
    assert.ok(r.success)
    assert.ok(r.message?.includes('workspace-write'))
    a.dispose()
  })

  it('/sandbox query', async () => {
    const a = make()
    const r = await a.handleSlashCommand('sandbox', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(default)'))
    a.dispose()
  })

  it('/sandbox invalid', async () => {
    const a = make()
    const r = await a.handleSlashCommand('sandbox', 'turbo')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/websearch set valid mode', async () => {
    const a = make()
    const r = await a.handleSlashCommand('websearch', 'live')
    assert.ok(r.success)
    assert.ok(r.message?.includes('live'))
    a.dispose()
  })

  it('/websearch disabled', async () => {
    const a = make()
    const r = await a.handleSlashCommand('websearch', 'disabled')
    assert.ok(r.success)
    assert.ok(r.message?.includes('disabled'))
    a.dispose()
  })

  it('/websearch query', async () => {
    const a = make()
    const r = await a.handleSlashCommand('websearch', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(default)'))
    a.dispose()
  })

  it('/websearch invalid', async () => {
    const a = make()
    const r = await a.handleSlashCommand('websearch', 'turbo')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/network on and off', async () => {
    const a = make()
    let r = await a.handleSlashCommand('network', 'on')
    assert.ok(r.success)
    assert.ok(r.message?.includes('enabled'))
    r = await a.handleSlashCommand('network', 'off')
    assert.ok(r.success)
    assert.ok(r.message?.includes('disabled'))
    a.dispose()
  })

  it('/network query', async () => {
    const a = make()
    const r = await a.handleSlashCommand('network', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(default)'))
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
  it('getSlashCommands returns 7 commands', () => {
    const a = make()
    const cmds = a.getSlashCommands()
    assert.equal(cmds.length, 7)
    const names = cmds.map((c) => c.name)
    assert.ok(names.includes('clear'))
    assert.ok(names.includes('model'))
    assert.ok(names.includes('effort'))
    assert.ok(names.includes('cost'))
    assert.ok(names.includes('sandbox'))
    assert.ok(names.includes('websearch'))
    assert.ok(names.includes('network'))
    a.dispose()
  })

  it('getAvailableModels returns array (empty before API fetch)', () => {
    const a = make()
    const models = a.getAvailableModels()
    // Models are fetched asynchronously from API — starts empty
    assert.ok(Array.isArray(models))
    a.dispose()
  })

  it('getAvailableModelInfo returns array (empty before API fetch)', () => {
    const a = make()
    const info = a.getAvailableModelInfo()
    assert.ok(Array.isArray(info))
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
    const a = make({ CODEX_MODEL: 'gpt-5.3-codex' })
    assert.equal(a.getModel(), 'gpt-5.3-codex')
    a.dispose()
  })

  it('getModel returns default when no env', () => {
    const a = make()
    assert.equal(a.getModel(), 'codex-mini-latest')
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
