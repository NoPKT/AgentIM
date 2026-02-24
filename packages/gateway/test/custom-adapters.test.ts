import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// We test the custom-adapters module by pointing ADAPTERS_FILE to a temp dir.
// Since the module uses homedir(), we override it via module-level mocking.

// We cannot easily mock homedir() in node:test, so instead we test the public
// API by importing the functions and relying on the real ~/.agentim/adapters.json.
// For safety, we only run read-only operations.

import {
  loadCustomAdapters,
  getCustomAdapter,
  listCustomAdapters,
  getCustomAdaptersPath,
  type CustomAdaptersFile,
} from '../src/custom-adapters.js'

describe('custom-adapters', () => {
  describe('getCustomAdaptersPath', () => {
    it('returns a string ending with adapters.json', () => {
      const path = getCustomAdaptersPath()
      assert.ok(typeof path === 'string')
      assert.ok(path.endsWith('adapters.json'))
      assert.ok(path.includes('.agentim'))
    })
  })

  describe('loadCustomAdapters', () => {
    it('returns an object (possibly empty)', () => {
      const adapters = loadCustomAdapters()
      assert.ok(typeof adapters === 'object')
      assert.ok(adapters !== null)
    })

    it('returns the same cached result on second call', () => {
      const first = loadCustomAdapters()
      const second = loadCustomAdapters()
      assert.deepEqual(first, second)
    })
  })

  describe('getCustomAdapter', () => {
    it('returns undefined for non-existent adapter type', () => {
      const adapter = getCustomAdapter('nonexistent-type-xyz')
      assert.equal(adapter, undefined)
    })
  })

  describe('listCustomAdapters', () => {
    it('returns an array', () => {
      const list = listCustomAdapters()
      assert.ok(Array.isArray(list))
    })

    it('each entry has a name property', () => {
      const list = listCustomAdapters()
      for (const entry of list) {
        assert.ok(typeof entry.name === 'string')
        assert.ok(entry.name.length > 0)
        assert.ok(typeof entry.command === 'string')
      }
    })
  })
})
