import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  addPendingPermission,
  getPendingPermission,
  clearPendingPermission,
  getPendingCount,
  stopPermissionCleanup,
} from '../../src/lib/permission-store.js'

describe('permission-store', () => {
  // Stop the background cleanup interval so it doesn't keep the test process alive
  after(() => {
    stopPermissionCleanup()
  })

  describe('addPendingPermission', () => {
    it('adds a permission to the queue and returns true', () => {
      const timer = setTimeout(() => {}, 100)
      timer.unref()
      const result = addPendingPermission('test-req-1', {
        agentId: 'agent-1',
        roomId: 'room-1',
        timer,
      })
      assert.equal(result, true)

      const p = getPendingPermission('test-req-1')
      assert.ok(p)
      assert.equal(p.agentId, 'agent-1')
      assert.equal(p.roomId, 'room-1')
      assert.ok(p.createdAt > 0)

      clearPendingPermission('test-req-1')
    })

    it('updates existing requestId without incrementing count', () => {
      const timer1 = setTimeout(() => {}, 100)
      timer1.unref()
      addPendingPermission('test-req-2', {
        agentId: 'agent-1',
        roomId: 'room-1',
        timer: timer1,
      })
      const countBefore = getPendingCount()

      const timer2 = setTimeout(() => {}, 100)
      timer2.unref()
      const result = addPendingPermission('test-req-2', {
        agentId: 'agent-2',
        roomId: 'room-2',
        timer: timer2,
      })
      assert.equal(result, true)
      assert.equal(getPendingCount(), countBefore) // count unchanged

      const p = getPendingPermission('test-req-2')
      assert.ok(p)
      assert.equal(p.agentId, 'agent-2') // updated

      clearPendingPermission('test-req-2')
    })

    it('clears old timer when overwriting duplicate requestId', () => {
      let timer1Fired = false
      const timer1 = setTimeout(() => {
        timer1Fired = true
      }, 50)
      timer1.unref()
      addPendingPermission('test-req-dup', {
        agentId: 'agent-1',
        roomId: 'room-1',
        timer: timer1,
      })

      // Overwrite with a new entry — old timer should be cleared
      const timer2 = setTimeout(() => {}, 100)
      timer2.unref()
      addPendingPermission('test-req-dup', {
        agentId: 'agent-2',
        roomId: 'room-2',
        timer: timer2,
      })

      // Verify the old timer was cleared (should not fire)
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          assert.equal(timer1Fired, false, 'Old timer should have been cleared')
          clearPendingPermission('test-req-dup')
          resolve()
        }, 100).unref()
      })
    })

    it('records createdAt timestamp', () => {
      const before = Date.now()
      const timer = setTimeout(() => {}, 100)
      timer.unref()
      addPendingPermission('test-req-ts', {
        agentId: 'a',
        roomId: 'r',
        timer,
      })
      const after = Date.now()

      const p = getPendingPermission('test-req-ts')
      assert.ok(p)
      assert.ok(p.createdAt >= before)
      assert.ok(p.createdAt <= after)

      clearPendingPermission('test-req-ts')
    })
  })

  describe('addPendingPermission capacity limit', () => {
    it('rejects new requests when queue is at capacity (1000)', () => {
      const ids: string[] = []
      // Fill to capacity — use short timers with .unref() to avoid blocking
      for (let i = 0; i < 1000; i++) {
        const id = `cap-test-${i}`
        ids.push(id)
        const timer = setTimeout(() => {}, 100)
        timer.unref()
        const ok = addPendingPermission(id, {
          agentId: 'a',
          roomId: 'r',
          timer,
        })
        assert.equal(ok, true)
      }

      assert.equal(getPendingCount(), 1000)

      // New request should be rejected
      const timer = setTimeout(() => {}, 100)
      timer.unref()
      const result = addPendingPermission('cap-test-overflow', {
        agentId: 'a',
        roomId: 'r',
        timer,
      })
      assert.equal(result, false)
      assert.equal(getPendingPermission('cap-test-overflow'), undefined)

      // Clean up
      for (const id of ids) {
        clearPendingPermission(id)
      }
    })

    it('allows re-adding existing requestId when at capacity', () => {
      const ids: string[] = []
      for (let i = 0; i < 1000; i++) {
        const id = `cap-reuse-${i}`
        ids.push(id)
        const timer = setTimeout(() => {}, 100)
        timer.unref()
        addPendingPermission(id, { agentId: 'a', roomId: 'r', timer })
      }

      // Re-adding an existing ID should succeed
      const timer = setTimeout(() => {}, 100)
      timer.unref()
      const result = addPendingPermission('cap-reuse-0', {
        agentId: 'updated',
        roomId: 'r',
        timer,
      })
      assert.equal(result, true)

      const p = getPendingPermission('cap-reuse-0')
      assert.ok(p)
      assert.equal(p.agentId, 'updated')

      // Clean up
      for (const id of ids) {
        clearPendingPermission(id)
      }
    })
  })

  describe('clearPendingPermission', () => {
    it('removes an existing permission', () => {
      const timer = setTimeout(() => {}, 100)
      timer.unref()
      addPendingPermission('clear-test-1', {
        agentId: 'a',
        roomId: 'r',
        timer,
      })
      assert.ok(getPendingPermission('clear-test-1'))

      clearPendingPermission('clear-test-1')
      assert.equal(getPendingPermission('clear-test-1'), undefined)
    })

    it('does not throw when clearing a non-existent permission', () => {
      assert.doesNotThrow(() => {
        clearPendingPermission('nonexistent-id')
      })
    })

    it('double-clear does not throw', () => {
      const timer = setTimeout(() => {}, 100)
      timer.unref()
      addPendingPermission('double-clear', {
        agentId: 'a',
        roomId: 'r',
        timer,
      })
      clearPendingPermission('double-clear')
      assert.doesNotThrow(() => {
        clearPendingPermission('double-clear')
      })
    })
  })

  describe('getPendingPermission', () => {
    it('returns undefined for non-existent requestId', () => {
      assert.equal(getPendingPermission('does-not-exist'), undefined)
    })
  })

  describe('getPendingCount', () => {
    it('returns 0 when queue is empty (after cleanup)', () => {
      // Note: this test relies on no other test leaving stale entries
      // If it fails, previous tests may have leaked entries
      const startCount = getPendingCount()
      const timer = setTimeout(() => {}, 100)
      timer.unref()
      addPendingPermission('count-test', { agentId: 'a', roomId: 'r', timer })
      assert.equal(getPendingCount(), startCount + 1)
      clearPendingPermission('count-test')
      assert.equal(getPendingCount(), startCount)
    })
  })

  describe('stopPermissionCleanup', () => {
    it('does not throw when called', () => {
      assert.doesNotThrow(() => {
        stopPermissionCleanup()
      })
    })
  })
})
