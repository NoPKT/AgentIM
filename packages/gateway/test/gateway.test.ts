import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
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

// ─── OpenCode Adapter ───

describe('OpenCodeAdapter creation', () => {
  it('creates opencode adapter', () => {
    const adapter = createAdapter('opencode', { agentId: 'oc-1', agentName: 'opencode-test' })
    assert.equal(adapter.type, 'opencode')
    assert.equal(adapter.agentId, 'oc-1')
    assert.equal(adapter.agentName, 'opencode-test')
    assert.equal(adapter.running, false)
    adapter.dispose()
  })
})

describe('OpenCodeAdapter stop and dispose', () => {
  it('stop resets isRunning flag', () => {
    const adapter = createAdapter('opencode', { agentId: 'oc-2', agentName: 'OcStop' })
    adapter.stop()
    assert.equal(adapter.running, false, 'running should be false after stop')
    adapter.dispose()
  })

  it('dispose cleans up adapter state', () => {
    const adapter = createAdapter('opencode', { agentId: 'oc-3', agentName: 'OcDispose' })
    adapter.dispose()
    assert.equal(adapter.running, false, 'running should be false after dispose')
  })

  it('stop followed by dispose does not throw', () => {
    const adapter = createAdapter('opencode', { agentId: 'oc-4', agentName: 'OcBoth' })
    adapter.stop()
    adapter.dispose()
    assert.equal(adapter.running, false)
  })

  it('double dispose does not throw', () => {
    const adapter = createAdapter('opencode', { agentId: 'oc-5', agentName: 'OcDouble' })
    adapter.dispose()
    adapter.dispose()
    assert.equal(adapter.running, false)
  })
})

// ─── Adapter edge cases ───

describe('Adapter common behaviour', () => {
  it('all adapter types start with running=false', () => {
    for (const type of ['claude-code', 'codex', 'gemini', 'opencode', 'generic'] as const) {
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

// ─── AgentManager message queue tests ───

/**
 * Controllable adapter stub: lets the test decide when sendMessage completes
 * by calling the captured onComplete/onError callback.
 */
class ControllableAdapter extends BaseAgentAdapter {
  private _onComplete: ((content: string) => void) | null = null
  private _onError: ((error: string) => void) | null = null
  public messageCount = 0

  get type() {
    return 'test'
  }

  sendMessage(
    _content: string,
    _onChunk: (chunk: any) => void,
    onComplete: (content: string) => void,
    onError: (error: string) => void,
  ) {
    if (this.isRunning) {
      onError('Agent is already processing a message')
      return
    }
    this.isRunning = true
    this.messageCount++
    this._onComplete = onComplete
    this._onError = onError
  }

  /** Simulate adapter finishing successfully. */
  complete(content = 'done') {
    const cb = this._onComplete
    this.isRunning = false
    this._onComplete = null
    this._onError = null
    cb?.(content)
  }

  /** Simulate adapter finishing with error. */
  fail(error = 'fail') {
    const cb = this._onError
    this.isRunning = false
    this._onComplete = null
    this._onError = null
    cb?.(error)
  }

  stop() {
    this.isRunning = false
  }
  dispose() {
    this.isRunning = false
  }
}

/**
 * Helper: create an AgentManager with a pre-registered ControllableAdapter,
 * bypassing the normal adapter factory.
 */
function createManagerWithControllable() {
  const sentMessages: any[] = []
  const mockWsClient = { send(msg: unknown) { sentMessages.push(msg) } }
  const manager = new AgentManager(mockWsClient as any)

  // Use addAgent to register, then swap the adapter internally
  const agentId = manager.addAgent({ type: 'generic', name: 'QueueTest' })
  sentMessages.length = 0

  // Replace the real adapter with our controllable one
  const adapter = new ControllableAdapter({ agentId, agentName: 'QueueTest' })
  const adaptersMap = (manager as any).adapters as Map<string, BaseAgentAdapter>
  adaptersMap.get(agentId)?.dispose()
  adaptersMap.set(agentId, adapter)

  const makeSendMsg = (messageId: string) => ({
    type: 'server:send_to_agent' as const,
    agentId,
    roomId: 'room1',
    content: `msg-${messageId}`,
    senderName: 'user1',
    senderType: 'user' as const,
    routingMode: 'direct' as const,
    conversationId: 'conv-1',
    depth: 0,
    messageId,
  })

  return { manager, adapter, agentId, sentMessages, makeSendMsg }
}

describe('AgentManager message queue', () => {
  it('first message is processed immediately', () => {
    const { manager, adapter, sentMessages, makeSendMsg } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m1'))

    assert.equal(adapter.messageCount, 1, 'adapter should have received 1 message')
    assert.ok(adapter.running, 'adapter should be running')
    // Should have sent busy status
    const busyMsgs = sentMessages.filter((m: any) => m.type === 'gateway:agent_status' && m.status === 'busy')
    assert.equal(busyMsgs.length, 1)
  })

  it('second message while busy is queued, then processed on completion', () => {
    const { manager, adapter, sentMessages, makeSendMsg } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m1'))
    assert.equal(adapter.messageCount, 1)

    // Send second message while adapter is busy
    manager.handleServerMessage(makeSendMsg('m2'))
    assert.equal(adapter.messageCount, 1, 'second message should be queued, not sent')

    sentMessages.length = 0
    // Complete first message — should trigger processing of queued m2
    adapter.complete('response1')

    // m2 should now be processed
    assert.equal(adapter.messageCount, 2, 'queued message should have been processed')
    assert.ok(adapter.running, 'adapter should be running the queued message')
  })

  it('queue drains in FIFO order', () => {
    const { manager, adapter, makeSendMsg } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m1'))

    // Queue 3 more messages
    manager.handleServerMessage(makeSendMsg('m2'))
    manager.handleServerMessage(makeSendMsg('m3'))
    manager.handleServerMessage(makeSendMsg('m4'))
    assert.equal(adapter.messageCount, 1)

    // Complete m1 → m2 processed
    adapter.complete()
    assert.equal(adapter.messageCount, 2)

    // Complete m2 → m3 processed
    adapter.complete()
    assert.equal(adapter.messageCount, 3)

    // Complete m3 → m4 processed
    adapter.complete()
    assert.equal(adapter.messageCount, 4)
  })

  it('sets status to online when queue is drained', () => {
    const { manager, adapter, sentMessages, makeSendMsg } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m1'))
    manager.handleServerMessage(makeSendMsg('m2'))

    sentMessages.length = 0
    adapter.complete()
    // m2 is now processing, not yet online
    const onlineAfterM1 = sentMessages.filter((m: any) => m.type === 'gateway:agent_status' && m.status === 'online')
    assert.equal(onlineAfterM1.length, 0, 'should not be online while queue has items')

    sentMessages.length = 0
    adapter.complete()
    // Queue empty now — should be online
    const onlineAfterM2 = sentMessages.filter((m: any) => m.type === 'gateway:agent_status' && m.status === 'online')
    assert.equal(onlineAfterM2.length, 1, 'should be online after queue drains')
  })

  it('adapter error does not stop queue processing', () => {
    const { manager, adapter, makeSendMsg } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m1'))
    manager.handleServerMessage(makeSendMsg('m2'))
    assert.equal(adapter.messageCount, 1)

    // Fail first message — should still process m2
    adapter.fail('some error')
    assert.equal(adapter.messageCount, 2, 'should process next after error')
  })

  it('rejects message when queue is full (50)', () => {
    const { manager, adapter, sentMessages, makeSendMsg } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m0'))

    // Fill queue to MAX_AGENT_QUEUE_SIZE (50)
    for (let i = 1; i <= 50; i++) {
      manager.handleServerMessage(makeSendMsg(`m${i}`))
    }

    sentMessages.length = 0
    // 51st queued message should be rejected
    manager.handleServerMessage(makeSendMsg('overflow'))

    const errorMsgs = sentMessages.filter(
      (m: any) => m.type === 'gateway:message_complete' && m.fullContent.includes('queue is full'),
    )
    assert.equal(errorMsgs.length, 1, 'should reject with queue-full error')
    assert.equal(adapter.messageCount, 1, 'adapter should not receive overflow message')
  })

  it('stop_agent clears the queue', () => {
    const { manager, adapter, sentMessages, makeSendMsg, agentId } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m1'))
    manager.handleServerMessage(makeSendMsg('m2'))
    manager.handleServerMessage(makeSendMsg('m3'))

    // Stop the agent — should clear queue
    manager.handleServerMessage({ type: 'server:stop_agent', agentId })

    sentMessages.length = 0
    // Complete current message — should go online (no queued m2/m3)
    adapter.complete()

    const onlineMsgs = sentMessages.filter((m: any) => m.type === 'gateway:agent_status' && m.status === 'online')
    assert.equal(onlineMsgs.length, 1, 'should go online, not process cleared queue')
    assert.equal(adapter.messageCount, 1, 'only the first message should have been processed')
  })

  it('reports queueDepth in agent_status messages', () => {
    const { manager, sentMessages, makeSendMsg } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m1'))

    sentMessages.length = 0
    // Queue a second message — should report queueDepth=1
    manager.handleServerMessage(makeSendMsg('m2'))

    const statusMsgs = sentMessages.filter(
      (m: any) => m.type === 'gateway:agent_status' && typeof m.queueDepth === 'number',
    )
    assert.equal(statusMsgs.length, 1, 'should send status with queueDepth')
    assert.equal((statusMsgs[0] as any).queueDepth, 1)

    sentMessages.length = 0
    // Queue a third — queueDepth=2
    manager.handleServerMessage(makeSendMsg('m3'))
    const statusMsgs2 = sentMessages.filter(
      (m: any) => m.type === 'gateway:agent_status' && typeof m.queueDepth === 'number',
    )
    assert.equal((statusMsgs2[0] as any).queueDepth, 2)
  })

  it('reports queueDepth=0 when queue drains', () => {
    const { manager, adapter, sentMessages, makeSendMsg } = createManagerWithControllable()
    manager.handleServerMessage(makeSendMsg('m1'))
    manager.handleServerMessage(makeSendMsg('m2'))

    // Complete m1 → m2 processed
    adapter.complete()
    sentMessages.length = 0
    // Complete m2 → queue empty, agent goes online with queueDepth=0
    adapter.complete()

    const onlineMsgs = sentMessages.filter(
      (m: any) => m.type === 'gateway:agent_status' && m.status === 'online',
    )
    assert.equal(onlineMsgs.length, 1)
    assert.equal((onlineMsgs[0] as any).queueDepth, 0)
  })
})
