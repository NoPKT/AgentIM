import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  writeDaemonInfo,
  readDaemonInfo,
  removeDaemonInfo,
  listDaemons,
  cleanStaleDaemons,
  type DaemonInfo,
} from '../src/lib/daemon-manager.js'

// NOTE: These tests use the real ~/.agentim/daemons directory.
// We use a unique daemon name prefix to avoid collision with real daemons.
const TEST_PREFIX = `__test_${Date.now()}_`

function makeTestDaemonInfo(suffix: string): DaemonInfo {
  return {
    pid: 999999, // Non-existent PID
    name: `${TEST_PREFIX}${suffix}`,
    type: 'claude-code',
    workDir: tmpdir(),
    startedAt: new Date().toISOString(),
    gatewayId: 'test-gateway-id',
  }
}

describe('DaemonManager', () => {
  const testNames: string[] = []

  afterEach(() => {
    // Clean up test daemon files
    for (const name of testNames) {
      try {
        removeDaemonInfo(name)
      } catch {
        // ignore
      }
    }
    testNames.length = 0
  })

  describe('writeDaemonInfo / readDaemonInfo', () => {
    it('writes and reads back daemon info', () => {
      const info = makeTestDaemonInfo('write-read')
      testNames.push(info.name)

      writeDaemonInfo(info)
      const read = readDaemonInfo(info.name)

      assert.ok(read !== null)
      assert.equal(read!.pid, info.pid)
      assert.equal(read!.name, info.name)
      assert.equal(read!.type, info.type)
      assert.equal(read!.workDir, info.workDir)
      assert.equal(read!.gatewayId, info.gatewayId)
    })

    it('returns null for non-existent daemon', () => {
      const result = readDaemonInfo(`${TEST_PREFIX}nonexistent`)
      assert.equal(result, null)
    })
  })

  describe('removeDaemonInfo', () => {
    it('removes a daemon PID file', () => {
      const info = makeTestDaemonInfo('remove')
      testNames.push(info.name)

      writeDaemonInfo(info)
      assert.ok(readDaemonInfo(info.name) !== null)

      removeDaemonInfo(info.name)
      assert.equal(readDaemonInfo(info.name), null)
    })

    it('does not throw when removing non-existent file', () => {
      // Should not throw
      removeDaemonInfo(`${TEST_PREFIX}ghost`)
    })
  })

  describe('listDaemons', () => {
    it('returns an array', () => {
      const list = listDaemons()
      assert.ok(Array.isArray(list))
    })

    it('includes test daemon after writing', () => {
      const info = makeTestDaemonInfo('list')
      testNames.push(info.name)
      writeDaemonInfo(info)

      const list = listDaemons()
      const found = list.find((d) => d.name === info.name)
      assert.ok(found !== undefined)
      // PID 999999 should not be alive
      assert.equal(found!.alive, false)
    })
  })

  describe('cleanStaleDaemons', () => {
    it('removes stale (dead) daemon entries', () => {
      const info1 = makeTestDaemonInfo('stale1')
      const info2 = makeTestDaemonInfo('stale2')
      testNames.push(info1.name, info2.name)

      writeDaemonInfo(info1)
      writeDaemonInfo(info2)

      // Both use PID 999999, should be dead
      const cleaned = cleanStaleDaemons()
      assert.ok(cleaned >= 2, `Expected at least 2 cleaned, got ${cleaned}`)

      // Files should be removed
      assert.equal(readDaemonInfo(info1.name), null)
      assert.equal(readDaemonInfo(info2.name), null)
    })

    it('returns 0 when no stale daemons', () => {
      // Clean everything first
      cleanStaleDaemons()
      // Now there should be nothing stale
      const cleaned = cleanStaleDaemons()
      assert.equal(cleaned, 0)
    })
  })
})
