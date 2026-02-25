import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { encryptToken, decryptToken, getMachineKey } from '../src/lib/crypto.js'

describe('crypto', () => {
  describe('getMachineKey', () => {
    it('returns a 32-byte Buffer', () => {
      const key = getMachineKey()
      assert.ok(Buffer.isBuffer(key))
      assert.equal(key.length, 32)
    })

    it('returns the same key on repeated calls', () => {
      const k1 = getMachineKey()
      const k2 = getMachineKey()
      assert.ok(k1.equals(k2))
    })
  })

  describe('encryptToken / decryptToken', () => {
    it('round-trips a simple string', () => {
      const original = 'my-secret-token-12345'
      const encrypted = encryptToken(original)
      assert.ok(typeof encrypted === 'string')
      assert.notEqual(encrypted, original)

      const decrypted = decryptToken(encrypted)
      assert.equal(decrypted, original)
    })

    it('round-trips an empty string', () => {
      const encrypted = encryptToken('')
      const decrypted = decryptToken(encrypted)
      assert.equal(decrypted, '')
    })

    it('round-trips a long token', () => {
      const original = 'a'.repeat(10_000)
      const encrypted = encryptToken(original)
      const decrypted = decryptToken(encrypted)
      assert.equal(decrypted, original)
    })

    it('round-trips unicode content', () => {
      const original = '日本語テスト 🎉 emoji token'
      const encrypted = encryptToken(original)
      const decrypted = decryptToken(encrypted)
      assert.equal(decrypted, original)
    })

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const original = 'same-token'
      const e1 = encryptToken(original)
      const e2 = encryptToken(original)
      assert.notEqual(e1, e2)
    })

    it('returns null for corrupted ciphertext', () => {
      const encrypted = encryptToken('valid-token')
      const corrupted = encrypted.slice(0, -4) + 'XXXX'
      assert.equal(decryptToken(corrupted), null)
    })

    it('returns null for empty string input', () => {
      assert.equal(decryptToken(''), null)
    })

    it('returns null for non-base64 input', () => {
      assert.equal(decryptToken('not-valid-base64!!!'), null)
    })

    it('returns null for too-short input', () => {
      // iv(12) + tag(16) = 28 bytes minimum
      const tooShort = Buffer.alloc(20).toString('base64')
      assert.equal(decryptToken(tooShort), null)
    })
  })
})
