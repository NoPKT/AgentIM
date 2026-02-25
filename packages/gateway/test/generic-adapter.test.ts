import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GenericAdapter } from '../src/adapters/generic.js'

const baseOpts = { agentId: 'g1', agentName: 'test' }

describe('GenericAdapter constructor validation', () => {
  it('accepts a simple command name', () => {
    const adapter = new GenericAdapter({ ...baseOpts, command: 'echo' })
    assert.equal(adapter.type, 'generic')
    adapter.dispose()
  })

  it('accepts an absolute path', () => {
    const adapter = new GenericAdapter({ ...baseOpts, command: '/usr/bin/echo' })
    assert.equal(adapter.type, 'generic')
    adapter.dispose()
  })

  it('accepts a Windows absolute path', () => {
    const adapter = new GenericAdapter({
      ...baseOpts,
      command: 'C:\\Program Files (x86)\\tool.exe',
    })
    assert.equal(adapter.type, 'generic')
    adapter.dispose()
  })

  it('rejects empty command', () => {
    assert.throws(
      () => new GenericAdapter({ ...baseOpts, command: '' }),
      /must not be empty/,
    )
  })

  it('rejects command with null bytes', () => {
    assert.throws(
      () => new GenericAdapter({ ...baseOpts, command: 'cmd\0injected' }),
      /null bytes/,
    )
  })

  it('rejects command starting with a dash', () => {
    assert.throws(
      () => new GenericAdapter({ ...baseOpts, command: '--version' }),
      /must not start with a dash/,
    )
  })

  it('rejects command with shell metacharacters', () => {
    for (const ch of [';', '&', '|', '`', '$', '<', '>', '!', '#', '~', '*', '?']) {
      assert.throws(
        () => new GenericAdapter({ ...baseOpts, command: `cmd${ch}bad` }),
        /unsafe characters/,
        `Should reject "${ch}" in command`,
      )
    }
  })

  it('rejects relative path traversal', () => {
    assert.throws(
      () => new GenericAdapter({ ...baseOpts, command: '../../bin/sh' }),
      /traversal/,
    )
    assert.throws(
      () => new GenericAdapter({ ...baseOpts, command: 'foo/../../etc/passwd' }),
      /traversal/,
    )
  })

  it('allows absolute path containing ".." (resolved by OS)', () => {
    const adapter = new GenericAdapter({ ...baseOpts, command: '/usr/../bin/echo' })
    assert.equal(adapter.type, 'generic')
    adapter.dispose()
  })

  it('defaults promptVia to stdin', () => {
    // GenericAdapter doesn't expose promptVia publicly, but we can verify
    // the constructor doesn't throw
    const adapter = new GenericAdapter({ ...baseOpts, command: 'cat' })
    adapter.dispose()
  })
})
