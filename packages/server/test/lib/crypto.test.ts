import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

describe('crypto', () => {
  const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

  beforeEach(() => {
    // Set a known encryption key for deterministic tests
    process.env.ENCRYPTION_KEY = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVz' // base64 of 32-byte key
  })

  afterEach(() => {
    // Restore original env
    if (ORIGINAL_ENCRYPTION_KEY !== undefined) {
      process.env.ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY
    } else {
      delete process.env.ENCRYPTION_KEY
    }
  })

  it('encrypts and decrypts a secret correctly', async () => {
    // Dynamic import to pick up env changes
    const { encryptSecret, decryptSecret } = await import('../../src/lib/crypto.js')
    const plaintext = 'sk-my-secret-api-key-12345'
    const encrypted = encryptSecret(plaintext)

    assert.ok(encrypted.startsWith('enc:'), 'Encrypted value should have enc: prefix')
    assert.notEqual(encrypted, plaintext, 'Encrypted value should differ from plaintext')

    const decrypted = decryptSecret(encrypted)
    assert.equal(decrypted, plaintext, 'Decrypted value should match original')
  })

  it('returns plaintext unchanged when not prefixed with enc:', async () => {
    const { decryptSecret } = await import('../../src/lib/crypto.js')
    const plaintext = 'not-encrypted-value'
    const result = decryptSecret(plaintext)
    assert.equal(result, plaintext)
  })

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const { encryptSecret } = await import('../../src/lib/crypto.js')
    const plaintext = 'same-value'
    const enc1 = encryptSecret(plaintext)
    const enc2 = encryptSecret(plaintext)
    assert.notEqual(enc1, enc2, 'Each encryption should use a unique IV')
  })

  it('returns null for malformed encrypted values', async () => {
    const { decryptSecret } = await import('../../src/lib/crypto.js')
    // Missing parts
    assert.equal(decryptSecret('enc:deadbeef'), null)
    // Wrong number of parts
    assert.equal(decryptSecret('enc:aa:bb'), null)
  })

  it('returns plaintext when ENCRYPTION_KEY is not set', async () => {
    delete process.env.ENCRYPTION_KEY
    // Re-import to pick up env change — use unique query param to bust cache
    const mod = await import(`../../src/lib/crypto.js?nokey=${Date.now()}`)
    const result = mod.encryptSecret('my-secret')
    // Without encryption key, it should return plaintext unchanged
    assert.equal(result, 'my-secret')
  })
})
