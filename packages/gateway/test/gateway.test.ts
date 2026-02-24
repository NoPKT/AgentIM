import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAdapter, BaseAgentAdapter } from '../src/adapters/index.js'
import type { MessageContext } from '../src/adapters/base.js'
import { wsUrlToHttpUrl } from '../src/config.js'
import { getDeviceInfo } from '../src/device.js'
import { AgentManager } from '../src/agent-manager.js'
import { generateAgentName } from '../src/name-generator.js'

// ─── Config Utilities ───

describe('wsUrlToHttpUrl', () => {
  it('converts ws:// to http://', () => {
    assert.equal(wsUrlToHttpUrl('ws://localhost:3000/ws/gateway'), 'http://localhost:3000')
  })

  it('converts wss:// to https://', () => {
    assert.equal(wsUrlToHttpUrl('wss://example.com/ws/gateway'), 'https://example.com')
  })

  it('handles trailing slash', () => {
    assert.equal(wsUrlToHttpUrl('ws://localhost:3000/ws/gateway/'), 'http://localhost:3000')
  })

  it('preserves port', () => {
    assert.equal(wsUrlToHttpUrl('ws://host:8080/ws/gateway'), 'http://host:8080')
  })
})

// ─── Name Generator ───

describe('generateAgentName', () => {
  it('generates a name with expected format', () => {
    const name = generateAgentName('claude-code', '/home/user/my-project')
    const parts = name.split('_')
    // hostname_dirname_type_hex
    assert.ok(parts.length >= 4)
    assert.equal(parts[parts.length - 2], 'claude-code')
    assert.equal(parts[parts.length - 3], 'my-project')
    // hex should be 4 characters
    assert.match(parts[parts.length - 1], /^[0-9a-f]{4}$/)
  })

  it('uses "default" when no workDir', () => {
    const name = generateAgentName('codex')
    assert.ok(name.includes('_default_'))
  })

  it('sanitizes special characters in directory name', () => {
    const name = generateAgentName('gemini', '/path/to/my project!')
    // Spaces and special chars should be stripped
    assert.ok(!name.includes(' '))
    assert.ok(!name.includes('!'))
  })

  it('generates unique names', () => {
    const name1 = generateAgentName('claude-code', '/project')
    const name2 = generateAgentName('claude-code', '/project')
    assert.notEqual(name1, name2)
  })
})

// ─── Device Info ───

describe('getDeviceInfo', () => {
  it('returns all required fields', () => {
    const info = getDeviceInfo()
    assert.ok(typeof info.hostname === 'string')
    assert.ok(typeof info.platform === 'string')
    assert.ok(typeof info.arch === 'string')
    assert.ok(info.nodeVersion.startsWith('v'))
  })
})

// ─── Adapter Factory ───

describe('createAdapter', () => {
  it('throws on unknown type', () => {
    assert.throws(
      () => createAdapter('unknown', { agentId: 'a', agentName: 'test' }),
      /Unknown adapter type/,
    )
  })

  it('creates claude-code adapter', () => {
    const adapter = createAdapter('claude-code', { agentId: 'a', agentName: 'test' })
    assert.equal(adapter.type, 'claude-code')
    assert.equal(adapter.agentId, 'a')
    assert.equal(adapter.agentName, 'test')
    assert.equal(adapter.running, false)
    adapter.dispose()
  })

  it('creates generic adapter with default command', () => {
    const adapter = createAdapter('generic', { agentId: 'b', agentName: 'gen' })
    assert.equal(adapter.type, 'generic')
    adapter.dispose()
  })

  it('creates codex adapter', () => {
    const adapter = createAdapter('codex', { agentId: 'c', agentName: 'codex' })
    assert.equal(adapter.type, 'codex')
    adapter.dispose()
  })

  it('creates gemini adapter', () => {
    const adapter = createAdapter('gemini', { agentId: 'd', agentName: 'gem' })
    assert.equal(adapter.type, 'gemini')
    adapter.dispose()
  })

  it('throws on removed cursor adapter', () => {
    assert.throws(
      () => createAdapter('cursor', { agentId: 'e', agentName: 'cur' }),
      /Unknown adapter type/,
    )
  })
})

// ─── AgentManager ───

describe('AgentManager', () => {
  let sentMessages: unknown[]
  let manager: AgentManager

  beforeEach(() => {
    sentMessages = []
    // Mock WsClient
    const mockWsClient = {
      send(msg: unknown) {
        sentMessages.push(msg)
      },
    }
    manager = new AgentManager(mockWsClient as any)
  })

  it('addAgent registers an agent and sends registration message', () => {
    const id = manager.addAgent({ type: 'claude-code', name: 'TestAgent' })
    assert.ok(typeof id === 'string')
    assert.ok(id.length > 0)

    // Should have sent a register message
    assert.equal(sentMessages.length, 1)
    const msg = sentMessages[0] as any
    assert.equal(msg.type, 'gateway:register_agent')
    assert.equal(msg.agent.name, 'TestAgent')
    assert.equal(msg.agent.type, 'claude-code')
    assert.equal(msg.agent.id, id)
  })

  it('listAgents returns registered agents', () => {
    const id = manager.addAgent({ type: 'claude-code', name: 'A1' })
    const list = manager.listAgents()
    assert.equal(list.length, 1)
    assert.equal(list[0].id, id)
    assert.equal(list[0].name, 'A1')
    assert.equal(list[0].type, 'claude-code')
  })

  it('removeAgent disposes adapter and sends unregister', () => {
    const id = manager.addAgent({ type: 'claude-code', name: 'A2' })
    sentMessages.length = 0 // Reset

    manager.removeAgent(id)
    assert.equal(manager.listAgents().length, 0)
    assert.equal(sentMessages.length, 1)
    assert.deepEqual(sentMessages[0], { type: 'gateway:unregister_agent', agentId: id })
  })

  it('removeAgent is a no-op for unknown id', () => {
    manager.removeAgent('nonexistent')
    assert.equal(sentMessages.length, 0)
  })

  it('handleServerMessage stores room context', () => {
    const id = manager.addAgent({ type: 'claude-code', name: 'A3' })
    sentMessages.length = 0

    manager.handleServerMessage({
      type: 'server:room_context',
      agentId: id,
      context: {
        roomId: 'room1',
        roomName: 'Test Room',
        members: [],
      },
    })

    // Room context should be stored (no error thrown)
    assert.equal(sentMessages.length, 0)
  })

  it('handleServerMessage ignores unknown agentId', () => {
    sentMessages.length = 0

    manager.handleServerMessage({
      type: 'server:send_to_agent',
      agentId: 'unknown',
      roomId: 'room1',
      content: 'hello',
      senderName: 'user1',
      senderType: 'user',
      routingMode: 'broadcast',
      conversationId: 'conv-1',
      depth: 0,
      messageId: 'msg1',
    })

    // Should not crash, no messages sent
    assert.equal(sentMessages.length, 0)
  })

  it('handleServerMessage stop agent calls adapter.stop', () => {
    const id = manager.addAgent({ type: 'claude-code', name: 'A5' })
    sentMessages.length = 0

    // Should not throw
    manager.handleServerMessage({
      type: 'server:stop_agent',
      agentId: id,
    })
  })

  it('disposeAll cleans up all agents', async () => {
    manager.addAgent({ type: 'claude-code', name: 'B1' })
    manager.addAgent({ type: 'claude-code', name: 'B2' })
    assert.equal(manager.listAgents().length, 2)

    sentMessages.length = 0
    await manager.disposeAll()
    assert.equal(manager.listAgents().length, 0)

    // Should send 2 unregister messages
    const unregisters = sentMessages.filter((m: any) => m.type === 'gateway:unregister_agent')
    assert.equal(unregisters.length, 2)
  })

  it('addAgent passes capabilities', () => {
    manager.addAgent({ type: 'claude-code', name: 'C1', capabilities: ['code', 'debug'] })
    const msg = sentMessages[0] as any
    assert.deepEqual(msg.agent.capabilities, ['code', 'debug'])
  })

  it('addAgent passes workingDirectory', () => {
    manager.addAgent({ type: 'claude-code', name: 'D1', workingDirectory: '/home/user/project' })
    const msg = sentMessages[0] as any
    assert.equal(msg.agent.workingDirectory, '/home/user/project')
  })
})

// ─── BaseAgentAdapter.buildPrompt ───

describe('BaseAgentAdapter.buildPrompt', () => {
  class TestAdapter extends BaseAgentAdapter {
    get type() {
      return 'test'
    }
    sendMessage() {
      /* no-op */
    }
    stop() {
      /* no-op */
    }
    dispose() {
      /* no-op */
    }
    public testBuildPrompt(content: string, context?: MessageContext) {
      return this.buildPrompt(content, context)
    }
  }

  it('returns content as-is when no context', () => {
    const adapter = new TestAdapter({ agentId: 'bp-1', agentName: 'Test' })
    assert.equal(adapter.testBuildPrompt('Hello'), 'Hello')
  })

  it('prepends sender name', () => {
    const adapter = new TestAdapter({ agentId: 'bp-2', agentName: 'Test' })
    const result = adapter.testBuildPrompt('Hello', { roomId: 'r1', senderName: 'Alice' })
    assert.equal(result, '[From: Alice]\n\nHello')
  })

  it('prepends system prompt and sender name', () => {
    const adapter = new TestAdapter({ agentId: 'bp-3', agentName: 'Test' })
    const result = adapter.testBuildPrompt('Hello', {
      roomId: 'r1',
      senderName: 'Alice',
      roomContext: { roomId: 'r1', roomName: 'Room', members: [], systemPrompt: 'Be helpful' },
    })
    assert.equal(result, '[System: Be helpful]\n\n[From: Alice]\n\nHello')
  })

  it('skips sender when empty', () => {
    const adapter = new TestAdapter({ agentId: 'bp-4', agentName: 'Test' })
    const result = adapter.testBuildPrompt('Hello', {
      roomId: 'r1',
      senderName: '',
      roomContext: { roomId: 'r1', roomName: 'Room', members: [], systemPrompt: 'Be concise' },
    })
    assert.equal(result, '[System: Be concise]\n\nHello')
  })

  it('skips system prompt when absent', () => {
    const adapter = new TestAdapter({ agentId: 'bp-5', agentName: 'Test' })
    const result = adapter.testBuildPrompt('Hello', {
      roomId: 'r1',
      senderName: 'Bob',
      roomContext: { roomId: 'r1', roomName: 'Room', members: [] },
    })
    assert.equal(result, '[From: Bob]\n\nHello')
  })
})

// ─── Codex Adapter stop/dispose ───

describe('CodexAdapter stop and dispose', () => {
  it('stop resets isRunning flag', () => {
    const adapter = createAdapter('codex', { agentId: 'cx-1', agentName: 'CodStop' })
    adapter.stop()
    assert.equal(adapter.running, false, 'running should be false after stop')
    adapter.dispose()
  })

  it('dispose cleans up adapter state', () => {
    const adapter = createAdapter('codex', { agentId: 'cx-2', agentName: 'CodDispose' })
    adapter.dispose()
    assert.equal(adapter.running, false, 'running should be false after dispose')
  })

  it('stop followed by dispose does not throw', () => {
    const adapter = createAdapter('codex', { agentId: 'cx-3', agentName: 'CodBoth' })
    adapter.stop()
    adapter.dispose()
    assert.equal(adapter.running, false)
  })
})

// ─── Adapter edge cases ───

describe('Adapter common behaviour', () => {
  it('all adapter types start with running=false', () => {
    for (const type of ['claude-code', 'codex', 'gemini', 'generic'] as const) {
      const adapter = createAdapter(type, { agentId: `edge-${type}`, agentName: `E${type}` })
      assert.equal(adapter.running, false, `${type} adapter should start not running`)
      adapter.dispose()
    }
  })

  it('adapter exposes agentId and agentName', () => {
    const adapter = createAdapter('claude-code', { agentId: 'edge-id', agentName: 'EdgeName' })
    assert.equal(adapter.agentId, 'edge-id')
    assert.equal(adapter.agentName, 'EdgeName')
    adapter.dispose()
  })

  it('double dispose does not throw', () => {
    const adapter = createAdapter('claude-code', {
      agentId: 'edge-dd',
      agentName: 'DoubleDispose',
    })
    adapter.dispose()
    adapter.dispose() // should not throw
  })
})

// ─── AgentManager extended tests ───

describe('AgentManager extended', () => {
  let sentMessages: unknown[]
  let manager: AgentManager

  beforeEach(() => {
    sentMessages = []
    const mockWsClient = { send(msg: unknown) { sentMessages.push(msg) } }
    manager = new AgentManager(mockWsClient as any)
  })

  it('removeAgent for same id twice is idempotent', () => {
    const id = manager.addAgent({ type: 'claude-code', name: 'Idem' })
    manager.removeAgent(id)
    sentMessages.length = 0
    manager.removeAgent(id) // should not send message
    assert.equal(sentMessages.length, 0)
  })

  it('addAgent multiple agents and list all', () => {
    const id1 = manager.addAgent({ type: 'claude-code', name: 'Multi1' })
    const id2 = manager.addAgent({ type: 'codex', name: 'Multi2' })
    const id3 = manager.addAgent({ type: 'generic', name: 'Multi3' })

    const list = manager.listAgents()
    assert.equal(list.length, 3)
    const ids = list.map((a) => a.id)
    assert.ok(ids.includes(id1))
    assert.ok(ids.includes(id2))
    assert.ok(ids.includes(id3))
  })

  it('handleServerMessage remove_agent cleans up agent', () => {
    const id = manager.addAgent({ type: 'claude-code', name: 'RemTest' })
    sentMessages.length = 0

    manager.handleServerMessage({ type: 'server:remove_agent', agentId: id })
    assert.equal(manager.listAgents().length, 0)
  })
})
