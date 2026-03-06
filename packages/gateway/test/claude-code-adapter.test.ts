import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ClaudeCodeAdapter } from '../src/adapters/index.js'

function make(env: Record<string, string> = {}) {
  return new ClaudeCodeAdapter({ agentId: 'cc-test', agentName: 'TestCC', env })
}

// ─── Slash Commands ───

describe('ClaudeCodeAdapter slash commands', () => {
  it('/model query returns current model', async () => {
    const a = make()
    const r = await a.handleSlashCommand('model', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(default)'))
    a.dispose()
  })

  it('/model set changes model', async () => {
    const a = make()
    const r = await a.handleSlashCommand('model', 'opus')
    assert.ok(r.success)
    assert.equal(a.getModel(), 'opus')
    a.dispose()
  })

  it('/think adaptive', async () => {
    const a = make()
    const r = await a.handleSlashCommand('think', 'adaptive')
    assert.ok(r.success)
    assert.equal(a.getThinkingMode(), 'adaptive')
    a.dispose()
  })

  it('/think enabled with budget', async () => {
    const a = make()
    const r = await a.handleSlashCommand('think', 'enabled:10000')
    assert.ok(r.success)
    assert.equal(a.getThinkingMode(), 'enabled:10000')
    a.dispose()
  })

  it('/think enabled without budget', async () => {
    const a = make()
    const r = await a.handleSlashCommand('think', 'enabled')
    assert.ok(r.success)
    assert.equal(a.getThinkingMode(), 'enabled')
    a.dispose()
  })

  it('/think disabled', async () => {
    const a = make()
    const r = await a.handleSlashCommand('think', 'disabled')
    assert.ok(r.success)
    assert.equal(a.getThinkingMode(), 'disabled')
    a.dispose()
  })

  it('/think invalid mode', async () => {
    const a = make()
    const r = await a.handleSlashCommand('think', 'turbo')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/effort low/medium/high', async () => {
    const a = make()
    for (const level of ['low', 'medium', 'high']) {
      const r = await a.handleSlashCommand('effort', level)
      assert.ok(r.success, `effort ${level} should succeed`)
      assert.equal(a.getEffortLevel(), level)
    }
    a.dispose()
  })

  it('/effort invalid', async () => {
    const a = make()
    const r = await a.handleSlashCommand('effort', 'turbo')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/plan toggle', async () => {
    const a = make()
    assert.equal(a.getPlanMode(), false)
    await a.handleSlashCommand('plan', '')
    assert.equal(a.getPlanMode(), true)
    await a.handleSlashCommand('plan', '')
    assert.equal(a.getPlanMode(), false)
    a.dispose()
  })

  it('/plan on and off', async () => {
    const a = make()
    await a.handleSlashCommand('plan', 'on')
    assert.equal(a.getPlanMode(), true)
    await a.handleSlashCommand('plan', 'off')
    assert.equal(a.getPlanMode(), false)
    a.dispose()
  })

  it('/cost returns formatted summary', async () => {
    const a = make()
    const r = await a.handleSlashCommand('cost', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('Cost'))
    assert.ok(r.message?.includes('$0.0000'))
    a.dispose()
  })

  it('/context returns info', async () => {
    const a = make()
    const r = await a.handleSlashCommand('context', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('Context Info'))
    a.dispose()
  })

  it('/clear resets session', async () => {
    const a = make()
    const r = await a.handleSlashCommand('clear', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('cleared'))
    a.dispose()
  })

  it('/compact resets session', async () => {
    const a = make()
    const r = await a.handleSlashCommand('compact', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('compacted'))
    a.dispose()
  })

  it('/budget set valid amount', async () => {
    const a = make()
    const r = await a.handleSlashCommand('budget', '5.50')
    assert.ok(r.success)
    assert.ok(r.message?.includes('$5.5'))
    a.dispose()
  })

  it('/budget query', async () => {
    const a = make()
    const r = await a.handleSlashCommand('budget', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(none)'))
    a.dispose()
  })

  it('/budget invalid', async () => {
    const a = make()
    const r = await a.handleSlashCommand('budget', 'abc')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/budget zero rejected', async () => {
    const a = make()
    const r = await a.handleSlashCommand('budget', '0')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/turns set valid count', async () => {
    const a = make()
    const r = await a.handleSlashCommand('turns', '20')
    assert.ok(r.success)
    assert.ok(r.message?.includes('20'))
    a.dispose()
  })

  it('/turns query', async () => {
    const a = make()
    const r = await a.handleSlashCommand('turns', '')
    assert.ok(r.success)
    assert.ok(r.message?.includes('(none)'))
    a.dispose()
  })

  it('/turns invalid', async () => {
    const a = make()
    const r = await a.handleSlashCommand('turns', 'abc')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/turns decimal rejected', async () => {
    const a = make()
    const r = await a.handleSlashCommand('turns', '3.5')
    assert.equal(r.success, false)
    a.dispose()
  })

  it('/sandbox on and off', async () => {
    const a = make()
    let r = await a.handleSlashCommand('sandbox', 'on')
    assert.ok(r.success)
    assert.ok(r.message?.includes('enabled'))
    r = await a.handleSlashCommand('sandbox', 'off')
    assert.ok(r.success)
    assert.ok(r.message?.includes('disabled'))
    a.dispose()
  })

  it('/sandbox toggle', async () => {
    const a = make()
    await a.handleSlashCommand('sandbox', '')
    // Toggled from false to true
    const r = await a.handleSlashCommand('sandbox', '')
    assert.ok(r.success)
    a.dispose()
  })

  it('/checkpoint on and off', async () => {
    const a = make()
    let r = await a.handleSlashCommand('checkpoint', 'on')
    assert.ok(r.success)
    assert.ok(r.message?.includes('enabled'))
    r = await a.handleSlashCommand('checkpoint', 'off')
    assert.ok(r.success)
    assert.ok(r.message?.includes('disabled'))
    a.dispose()
  })

  it('/rewind without active query', async () => {
    const a = make()
    const r = await a.handleSlashCommand('rewind', 'msg-123')
    assert.equal(r.success, false)
    assert.ok(r.message?.includes('No active query'))
    a.dispose()
  })

  it('/rewind without messageId', async () => {
    const a = make()
    const r = await a.handleSlashCommand('rewind', '')
    assert.equal(r.success, false)
    assert.ok(r.message?.includes('Usage'))
    a.dispose()
  })

  it('unknown command returns failure', async () => {
    const a = make()
    const r = await a.handleSlashCommand('foobar', '')
    assert.equal(r.success, false)
    a.dispose()
  })
})

// ─── Metadata & Info Methods ───

describe('ClaudeCodeAdapter metadata methods', () => {
  it('getSlashCommands returns all expected commands', () => {
    const a = make()
    const cmds = a.getSlashCommands()
    const names = cmds.map((c) => c.name)
    for (const expected of [
      'clear',
      'compact',
      'model',
      'think',
      'effort',
      'cost',
      'context',
      'plan',
      'budget',
      'turns',
      'sandbox',
      'checkpoint',
      'rewind',
    ]) {
      assert.ok(names.includes(expected), `missing command: ${expected}`)
    }
    // All builtin commands should have source 'builtin'
    for (const cmd of cmds) {
      if (!cmd.usage.startsWith('/')) continue
      assert.equal(cmd.source, 'builtin')
    }
    a.dispose()
  })

  it('getAvailableModels returns fallback list', () => {
    const a = make()
    const models = a.getAvailableModels()
    assert.ok(models.length >= 3)
    assert.ok(models.includes('sonnet'))
    assert.ok(models.includes('opus'))
    assert.ok(models.includes('haiku'))
    a.dispose()
  })

  it('getAvailableModelInfo returns empty initially', () => {
    const a = make()
    assert.deepEqual(a.getAvailableModelInfo(), [])
    a.dispose()
  })

  it('getAvailableEffortLevels returns 3 levels', () => {
    const a = make()
    assert.deepEqual(a.getAvailableEffortLevels(), ['low', 'medium', 'high'])
    a.dispose()
  })

  it('getAvailableThinkingModes returns 3 modes', () => {
    const a = make()
    assert.deepEqual(a.getAvailableThinkingModes(), ['adaptive', 'enabled', 'disabled'])
    a.dispose()
  })

  it('getPlanMode defaults to false', () => {
    const a = make()
    assert.equal(a.getPlanMode(), false)
    a.dispose()
  })

  it('getModel reads env ANTHROPIC_MODEL', () => {
    const a = make({ ANTHROPIC_MODEL: 'claude-opus-4-6' })
    assert.equal(a.getModel(), 'claude-opus-4-6')
    a.dispose()
  })

  it('getModel reads env CLAUDE_MODEL as fallback', () => {
    const a = make({ CLAUDE_MODEL: 'sonnet' })
    assert.equal(a.getModel(), 'sonnet')
    a.dispose()
  })

  it('getModel returns undefined when no env', () => {
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

  it('type returns claude-code', () => {
    const a = make()
    assert.equal(a.type, 'claude-code')
    a.dispose()
  })
})
