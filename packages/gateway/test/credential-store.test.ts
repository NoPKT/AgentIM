import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { encryptToken } from '../src/lib/crypto.js'

import {
  listCredentials,
  listCredentialInfo,
  getCredential,
  addCredential,
  updateCredential,
  removeCredential,
  getDefaultCredential,
  setDefaultCredential,
  resolveCredential,
  findCredentialByNameOrId,
  loadAgentConfig,
  saveAgentConfig,
  deleteAgentConfig,
  credentialToAuthConfig,
  type CredentialEntry,
  type AgentAuthConfig,
} from '../src/agent-config.js'

// Use a unique test agent type to avoid conflicts with real config
const TEST_AGENT_TYPE = `test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`
const TEST_AGENT_TYPE_2 = `test-agent-2-${Date.now()}-${Math.random().toString(36).slice(2)}`
const TEST_AGENT_TYPE_LEGACY = `test-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`

// Path to the config file (matches what agent-config.ts uses internally)
const AGENTS_DIR = join(homedir(), '.agentim', 'agents')

function configPath(agentType: string): string {
  return join(AGENTS_DIR, `${agentType}.json`)
}

// Clean up test files after each test suite
function cleanup(...agentTypes: string[]) {
  for (const t of agentTypes) {
    const p = configPath(t)
    if (existsSync(p)) rmSync(p)
  }
}

describe('credential store', () => {
  afterEach(() => {
    cleanup(TEST_AGENT_TYPE, TEST_AGENT_TYPE_2, TEST_AGENT_TYPE_LEGACY)
  })

  describe('empty store', () => {
    it('listCredentials returns empty array for non-existent agent type', () => {
      const creds = listCredentials(TEST_AGENT_TYPE)
      assert.deepEqual(creds, [])
    })

    it('listCredentialInfo returns empty array for non-existent agent type', () => {
      const info = listCredentialInfo(TEST_AGENT_TYPE)
      assert.deepEqual(info, [])
    })

    it('getCredential returns null for non-existent agent type', () => {
      assert.equal(getCredential(TEST_AGENT_TYPE, 'nonexistent'), null)
    })

    it('getDefaultCredential returns null for empty store', () => {
      assert.equal(getDefaultCredential(TEST_AGENT_TYPE), null)
    })

    it('resolveCredential returns null for empty store', () => {
      assert.equal(resolveCredential(TEST_AGENT_TYPE), null)
    })
  })

  describe('addCredential', () => {
    it('adds a credential and returns it with id and createdAt', () => {
      const cred = addCredential(TEST_AGENT_TYPE, {
        name: 'test-api',
        mode: 'api',
        apiKey: 'sk-test-123',
      })

      assert.ok(cred.id, 'should have an id')
      assert.ok(cred.createdAt, 'should have createdAt')
      assert.equal(cred.name, 'test-api')
      assert.equal(cred.mode, 'api')
      assert.equal(cred.apiKey, 'sk-test-123')
    })

    it('first credential is automatically set as default', () => {
      const cred = addCredential(TEST_AGENT_TYPE, {
        name: 'first',
        mode: 'api',
        apiKey: 'sk-first',
      })

      assert.equal(cred.isDefault, true)
    })

    it('second credential is not default by default', () => {
      addCredential(TEST_AGENT_TYPE, {
        name: 'first',
        mode: 'api',
        apiKey: 'sk-first',
      })

      const second = addCredential(TEST_AGENT_TYPE, {
        name: 'second',
        mode: 'api',
        apiKey: 'sk-second',
      })

      // Second credential should not be default unless explicitly set
      assert.ok(!second.isDefault || second.isDefault === undefined)
    })

    it('adding credential with isDefault=true clears other defaults', () => {
      const first = addCredential(TEST_AGENT_TYPE, {
        name: 'first',
        mode: 'api',
        apiKey: 'sk-first',
      })

      addCredential(TEST_AGENT_TYPE, {
        name: 'second',
        mode: 'api',
        apiKey: 'sk-second',
        isDefault: true,
      })

      // First should no longer be default
      const reloaded = getCredential(TEST_AGENT_TYPE, first.id)
      assert.ok(!reloaded?.isDefault)
    })

    it('credential data is encrypted on disk', () => {
      addCredential(TEST_AGENT_TYPE, {
        name: 'encrypted-test',
        mode: 'api',
        apiKey: 'sk-plaintext-secret',
      })

      // Read the file directly
      const raw = readFileSync(configPath(TEST_AGENT_TYPE), 'utf-8')
      // The plaintext key should NOT appear in the file
      assert.ok(!raw.includes('sk-plaintext-secret'), 'API key should be encrypted on disk')
      // But the name should be there in plain text
      assert.ok(raw.includes('encrypted-test'), 'Name should be readable')
    })

    it('subscription mode credential has no apiKey', () => {
      const cred = addCredential(TEST_AGENT_TYPE, {
        name: 'subscription',
        mode: 'subscription',
      })

      assert.equal(cred.mode, 'subscription')
      assert.equal(cred.apiKey, undefined)
    })
  })

  describe('listCredentials', () => {
    it('returns all credentials decrypted', () => {
      addCredential(TEST_AGENT_TYPE, { name: 'cred1', mode: 'api', apiKey: 'key1' })
      addCredential(TEST_AGENT_TYPE, { name: 'cred2', mode: 'api', apiKey: 'key2' })
      addCredential(TEST_AGENT_TYPE, { name: 'cred3', mode: 'subscription' })

      const creds = listCredentials(TEST_AGENT_TYPE)
      assert.equal(creds.length, 3)
      assert.equal(creds[0].apiKey, 'key1')
      assert.equal(creds[1].apiKey, 'key2')
      assert.equal(creds[2].apiKey, undefined)
    })
  })

  describe('listCredentialInfo', () => {
    it('returns metadata without secrets', () => {
      addCredential(TEST_AGENT_TYPE, { name: 'api-cred', mode: 'api', apiKey: 'secret-key' })

      const info = listCredentialInfo(TEST_AGENT_TYPE)
      assert.equal(info.length, 1)
      assert.equal(info[0].name, 'api-cred')
      assert.equal(info[0].hasApiKey, true)
      assert.equal(info[0].isDefault, true)
      // Must NOT have the actual key
      assert.equal((info[0] as Record<string, unknown>).apiKey, undefined)
    })
  })

  describe('getCredential', () => {
    it('returns credential by id', () => {
      const added = addCredential(TEST_AGENT_TYPE, { name: 'findme', mode: 'api', apiKey: 'k1' })
      const found = getCredential(TEST_AGENT_TYPE, added.id)
      assert.ok(found)
      assert.equal(found.name, 'findme')
      assert.equal(found.apiKey, 'k1')
    })

    it('returns null for non-existent id', () => {
      addCredential(TEST_AGENT_TYPE, { name: 'exists', mode: 'api' })
      assert.equal(getCredential(TEST_AGENT_TYPE, 'nonexistent-id'), null)
    })
  })

  describe('updateCredential', () => {
    it('updates name', () => {
      const cred = addCredential(TEST_AGENT_TYPE, { name: 'old-name', mode: 'api' })
      const result = updateCredential(TEST_AGENT_TYPE, cred.id, { name: 'new-name' })
      assert.equal(result, true)

      const updated = getCredential(TEST_AGENT_TYPE, cred.id)
      assert.equal(updated?.name, 'new-name')
    })

    it('updates apiKey', () => {
      const cred = addCredential(TEST_AGENT_TYPE, { name: 'key-test', mode: 'api', apiKey: 'old' })
      updateCredential(TEST_AGENT_TYPE, cred.id, { apiKey: 'new-key' })

      const updated = getCredential(TEST_AGENT_TYPE, cred.id)
      assert.equal(updated?.apiKey, 'new-key')
    })

    it('returns false for non-existent id', () => {
      assert.equal(updateCredential(TEST_AGENT_TYPE, 'nonexistent', { name: 'x' }), false)
    })
  })

  describe('removeCredential', () => {
    it('removes credential by id', () => {
      const cred = addCredential(TEST_AGENT_TYPE, { name: 'removeme', mode: 'api' })
      assert.equal(removeCredential(TEST_AGENT_TYPE, cred.id), true)
      assert.equal(getCredential(TEST_AGENT_TYPE, cred.id), null)
      assert.equal(listCredentials(TEST_AGENT_TYPE).length, 0)
    })

    it('returns false for non-existent id', () => {
      assert.equal(removeCredential(TEST_AGENT_TYPE, 'nonexistent'), false)
    })

    it('promotes first remaining credential to default when default is removed', () => {
      const first = addCredential(TEST_AGENT_TYPE, { name: 'first', mode: 'api' })
      addCredential(TEST_AGENT_TYPE, { name: 'second', mode: 'api' })

      // First is default
      assert.equal(first.isDefault, true)

      // Remove the default
      removeCredential(TEST_AGENT_TYPE, first.id)

      // Second should now be default
      const remaining = listCredentialInfo(TEST_AGENT_TYPE)
      assert.equal(remaining.length, 1)
      assert.equal(remaining[0].isDefault, true)
    })
  })

  describe('setDefaultCredential', () => {
    it('sets credential as default and clears others', () => {
      const first = addCredential(TEST_AGENT_TYPE, { name: 'first', mode: 'api' })
      const second = addCredential(TEST_AGENT_TYPE, { name: 'second', mode: 'api' })

      assert.equal(setDefaultCredential(TEST_AGENT_TYPE, second.id), true)

      const info = listCredentialInfo(TEST_AGENT_TYPE)
      const firstInfo = info.find((i) => i.id === first.id)
      const secondInfo = info.find((i) => i.id === second.id)
      assert.equal(firstInfo?.isDefault, false)
      assert.equal(secondInfo?.isDefault, true)
    })

    it('returns false for non-existent id', () => {
      assert.equal(setDefaultCredential(TEST_AGENT_TYPE, 'nonexistent'), false)
    })
  })

  describe('resolveCredential', () => {
    it('returns null for empty store', () => {
      assert.equal(resolveCredential(TEST_AGENT_TYPE), null)
    })

    it('returns the single credential when there is only one', () => {
      const cred = addCredential(TEST_AGENT_TYPE, { name: 'only', mode: 'api', apiKey: 'k' })
      const resolved = resolveCredential(TEST_AGENT_TYPE)
      assert.ok(resolved)
      assert.equal(resolved.id, cred.id)
    })

    it('returns credential by id when credentialId is provided', () => {
      addCredential(TEST_AGENT_TYPE, { name: 'first', mode: 'api', apiKey: 'k1' })
      const second = addCredential(TEST_AGENT_TYPE, { name: 'second', mode: 'api', apiKey: 'k2' })

      const resolved = resolveCredential(TEST_AGENT_TYPE, second.id)
      assert.ok(resolved)
      assert.equal(resolved.id, second.id)
    })

    it('returns default when multiple credentials exist', () => {
      addCredential(TEST_AGENT_TYPE, { name: 'first', mode: 'api' })
      const second = addCredential(TEST_AGENT_TYPE, { name: 'second', mode: 'api' })
      setDefaultCredential(TEST_AGENT_TYPE, second.id)

      const resolved = resolveCredential(TEST_AGENT_TYPE)
      assert.ok(resolved)
      assert.equal(resolved.id, second.id)
    })

    it('returns null when multiple credentials exist with no default', () => {
      addCredential(TEST_AGENT_TYPE, { name: 'first', mode: 'api' })
      addCredential(TEST_AGENT_TYPE, { name: 'second', mode: 'api' })

      // Clear the auto-default on first
      const store = JSON.parse(readFileSync(configPath(TEST_AGENT_TYPE), 'utf-8'))
      for (const c of store.credentials) c.isDefault = undefined
      writeFileSync(configPath(TEST_AGENT_TYPE), JSON.stringify(store, null, 2))

      const resolved = resolveCredential(TEST_AGENT_TYPE)
      assert.equal(resolved, null)
    })
  })

  describe('findCredentialByNameOrId', () => {
    it('finds by exact name (case-insensitive)', () => {
      const cred = addCredential(TEST_AGENT_TYPE, { name: 'My-Api-Key', mode: 'api' })

      const found = findCredentialByNameOrId(TEST_AGENT_TYPE, 'my-api-key')
      assert.ok(found)
      assert.equal(found.id, cred.id)
    })

    it('finds by id prefix', () => {
      const cred = addCredential(TEST_AGENT_TYPE, { name: 'test', mode: 'api' })
      const prefix = cred.id.slice(0, 6)

      const found = findCredentialByNameOrId(TEST_AGENT_TYPE, prefix)
      assert.ok(found)
      assert.equal(found.id, cred.id)
    })

    it('returns null when not found', () => {
      addCredential(TEST_AGENT_TYPE, { name: 'exists', mode: 'api' })
      assert.equal(findCredentialByNameOrId(TEST_AGENT_TYPE, 'nonexistent'), null)
    })
  })

  describe('v1 → v2 migration', () => {
    it('migrates legacy single-credential file to v2 format', () => {
      // Write a v1 format file directly
      mkdirSync(AGENTS_DIR, { recursive: true })
      const legacyConfig = {
        mode: 'api',
        apiKey: encryptToken('legacy-key'),
        baseUrl: 'https://legacy.api',
        model: 'legacy-model',
      }
      writeFileSync(configPath(TEST_AGENT_TYPE_LEGACY), JSON.stringify(legacyConfig))

      // Reading should trigger migration
      const creds = listCredentials(TEST_AGENT_TYPE_LEGACY)
      assert.equal(creds.length, 1)
      assert.equal(creds[0].name, 'default')
      assert.equal(creds[0].mode, 'api')
      assert.equal(creds[0].apiKey, 'legacy-key')
      assert.equal(creds[0].baseUrl, 'https://legacy.api')
      assert.equal(creds[0].model, 'legacy-model')
      assert.equal(creds[0].isDefault, true)
      assert.ok(creds[0].id, 'should have generated id')
      assert.ok(creds[0].createdAt, 'should have generated createdAt')

      // File should now be v2 format
      const raw = JSON.parse(readFileSync(configPath(TEST_AGENT_TYPE_LEGACY), 'utf-8'))
      assert.equal(raw.version, 2)
      assert.ok(Array.isArray(raw.credentials))
    })

    it('migrates subscription-only legacy config', () => {
      mkdirSync(AGENTS_DIR, { recursive: true })
      writeFileSync(
        configPath(TEST_AGENT_TYPE_LEGACY),
        JSON.stringify({ mode: 'subscription' }),
      )

      const creds = listCredentials(TEST_AGENT_TYPE_LEGACY)
      assert.equal(creds.length, 1)
      assert.equal(creds[0].mode, 'subscription')
      assert.equal(creds[0].apiKey, undefined)
    })
  })

  describe('backward-compatible wrappers', () => {
    it('loadAgentConfig returns null for empty store', () => {
      assert.equal(loadAgentConfig(TEST_AGENT_TYPE), null)
    })

    it('saveAgentConfig creates a default credential', () => {
      const config: AgentAuthConfig = { mode: 'api', apiKey: 'compat-key' }
      saveAgentConfig(TEST_AGENT_TYPE, config)

      const loaded = loadAgentConfig(TEST_AGENT_TYPE)
      assert.ok(loaded)
      assert.equal(loaded.mode, 'api')
      assert.equal(loaded.apiKey, 'compat-key')
    })

    it('saveAgentConfig updates existing default credential', () => {
      saveAgentConfig(TEST_AGENT_TYPE, { mode: 'api', apiKey: 'first' })
      saveAgentConfig(TEST_AGENT_TYPE, { mode: 'api', apiKey: 'second' })

      // Should still have only 1 credential (updated, not duplicated)
      const creds = listCredentials(TEST_AGENT_TYPE)
      assert.equal(creds.length, 1)

      const loaded = loadAgentConfig(TEST_AGENT_TYPE)
      assert.equal(loaded?.apiKey, 'second')
    })

    it('deleteAgentConfig removes the config file', () => {
      saveAgentConfig(TEST_AGENT_TYPE, { mode: 'api' })
      assert.ok(existsSync(configPath(TEST_AGENT_TYPE)))

      deleteAgentConfig(TEST_AGENT_TYPE)
      assert.ok(!existsSync(configPath(TEST_AGENT_TYPE)))
    })
  })

  describe('credentialToAuthConfig', () => {
    it('converts CredentialEntry to AgentAuthConfig', () => {
      const entry: CredentialEntry = {
        id: 'test-id',
        name: 'test',
        mode: 'api',
        apiKey: 'sk-key',
        baseUrl: 'https://api.test',
        model: 'test-model',
        createdAt: new Date().toISOString(),
      }

      const config = credentialToAuthConfig(entry)
      assert.equal(config.mode, 'api')
      assert.equal(config.apiKey, 'sk-key')
      assert.equal(config.baseUrl, 'https://api.test')
      assert.equal(config.model, 'test-model')
    })

    it('converts subscription entry', () => {
      const entry: CredentialEntry = {
        id: 'test-id',
        name: 'sub',
        mode: 'subscription',
        createdAt: new Date().toISOString(),
      }

      const config = credentialToAuthConfig(entry)
      assert.equal(config.mode, 'subscription')
      assert.equal(config.apiKey, undefined)
    })
  })
})
