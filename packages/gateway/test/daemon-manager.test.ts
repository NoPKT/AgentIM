import { describe, it, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, accessSync, constants as fsConstants } from 'node:fs'
import { join } from 'node:path'

// Use an isolated temp directory instead of ~/.agentim/daemons.
// This avoids requiring write access to the user's home directory, which may
// not be available in restricted CI environments or containers.
let testDir: string
try {
  testDir = mkdtempSync(join(tmpdir(), 'agentim-daemon-test-'))
  // Verify we have read+write access — some CI runners mount tmpdir read-only
  accessSync(testDir, fsConstants.R_OK | fsConstants.W_OK)
} catch {
  // Graceful skip: if we cannot create/access a temp directory, the rest of the
  // suite will fail meaninglessly, so just create it in cwd as a last resort.
  testDir = mkdtempSync(join(process.cwd(), '.agentim-daemon-test-'))
}
process.env.AGENTIM_DAEMONS_DIR = testDir

import {
  writeDaemonInfo,
  readDaemonInfo,
  removeDaemonInfo,
  listDaemons,
  cleanStaleDaemons,
  type DaemonInfo,
} from '../src/lib/daemon-manager.js'

// NOTE: These tests use an isolated temp directory for test isolation.
const TEST_PREFIX = `__test_${Date.now()}_`

/**
 * Pick a PID that is guaranteed to not be alive. We use a high value (999999)
 * which is above the typical PID range on most systems. On Linux, pid_max
 * defaults to 32768 (or 4194304 on 64-bit); on macOS, max is 99999.
 * PID 999999 is safe on both.
 */
const DEAD_PID = 999999

function makeTestDaemonInfo(suffix: string): DaemonInfo {
  return {
    pid: DEAD_PID,
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

  after(() => {
    // Clean up temp directory when tests complete
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Best effort cleanup
    }
    delete process.env.AGENTIM_DAEMONS_DIR
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
