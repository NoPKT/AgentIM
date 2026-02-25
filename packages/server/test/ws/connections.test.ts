import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionManager } from '../../src/ws/connections.js'

// ─── deletedAgentIds FIFO cap ───────────────────────────────────────────────

describe('ConnectionManager.deletedAgentIds', () => {
  it('markAgentDeleted adds agent to deleted set', () => {
    const mgr = new ConnectionManager()
    mgr.markAgentDeleted('agent-1')
    assert.equal(mgr.isAgentDeleted('agent-1'), true)
  })

  it('isAgentDeleted returns false for non-deleted agent', () => {
    const mgr = new ConnectionManager()
    assert.equal(mgr.isAgentDeleted('never-deleted'), false)
  })

  it('clearAgentDeleted removes the deletion flag', () => {
    const mgr = new ConnectionManager()
    mgr.markAgentDeleted('agent-2')
    assert.equal(mgr.isAgentDeleted('agent-2'), true)
    mgr.clearAgentDeleted('agent-2')
    assert.equal(mgr.isAgentDeleted('agent-2'), false)
  })

  it('clearAgentDeleted does not throw for non-existent agent', () => {
    const mgr = new ConnectionManager()
    assert.doesNotThrow(() => {
      mgr.clearAgentDeleted('nonexistent')
    })
  })

  it('caps the deletedAgentIds set with FIFO eviction behavior', () => {
    const mgr = new ConnectionManager()

    // Fill to a representative capacity
    for (let i = 0; i < 100; i++) {
      mgr.markAgentDeleted(`agent-${i}`)
    }

    // All should be present
    assert.equal(mgr.isAgentDeleted('agent-0'), true)
    assert.equal(mgr.isAgentDeleted('agent-99'), true)

    // Adding one more should evict the oldest (agent-0)
    mgr.markAgentDeleted('agent-100')
    assert.equal(mgr.isAgentDeleted('agent-0'), false) // evicted
    assert.equal(mgr.isAgentDeleted('agent-1'), true) // still present
    assert.equal(mgr.isAgentDeleted('agent-100'), true) // newly added
  })

  it('FIFO eviction preserves correct order', () => {
    const mgr = new ConnectionManager()

    // Fill to capacity
    for (let i = 0; i < 10_000; i++) {
      mgr.markAgentDeleted(`order-${i}`)
    }

    // Add 5 more — first 5 should be evicted
    for (let i = 10_000; i < 10_005; i++) {
      mgr.markAgentDeleted(`order-${i}`)
    }

    // First 5 should be gone
    for (let i = 0; i < 5; i++) {
      assert.equal(mgr.isAgentDeleted(`order-${i}`), false, `order-${i} should have been evicted`)
    }

    // 6th original entry should still be present
    assert.equal(mgr.isAgentDeleted('order-5'), true)

    // All new entries should be present
    for (let i = 10_000; i < 10_005; i++) {
      assert.equal(mgr.isAgentDeleted(`order-${i}`), true, `order-${i} should be present`)
    }
  })

  it('re-adding an existing agent does not cause double-count', () => {
    const mgr = new ConnectionManager()
    mgr.markAgentDeleted('dup-agent')
    mgr.markAgentDeleted('dup-agent')

    // Should still be marked as deleted
    assert.equal(mgr.isAgentDeleted('dup-agent'), true)

    // Clear once should remove it
    mgr.clearAgentDeleted('dup-agent')
    assert.equal(mgr.isAgentDeleted('dup-agent'), false)
  })
})
