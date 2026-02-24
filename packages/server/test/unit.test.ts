import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ─── crypto.ts ─────────────────────────────────────────────────────────────

describe('crypto', () => {
  it('encrypts and decrypts a secret round-trip', async () => {
    // Set a test encryption key (32 bytes base64)
    process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleTE='
    // Clear module cache to pick up new env
    const { encryptSecret, decryptSecret } = await import('../src/lib/crypto.js')

    const plaintext = 'my-secret-api-key-123'
    const encrypted = encryptSecret(plaintext)
    assert.ok(encrypted.startsWith('enc:'), 'encrypted value should start with enc: prefix')
    assert.notEqual(encrypted, plaintext, 'encrypted should differ from plaintext')

    const decrypted = decryptSecret(encrypted)
    assert.equal(decrypted, plaintext, 'decrypted should match original plaintext')
  })

  it('decrypts plaintext (non-encrypted) values as-is', async () => {
    const { decryptSecret } = await import('../src/lib/crypto.js')
    assert.equal(decryptSecret('plain-value'), 'plain-value')
  })

  it('returns null for malformed encrypted values', async () => {
    const { decryptSecret } = await import('../src/lib/crypto.js')
    assert.equal(decryptSecret('enc:bad'), null)
    assert.equal(decryptSecret('enc:aa:bb'), null)
  })

  it('returns null for encrypted value with wrong key', async () => {
    process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleTE='
    const { encryptSecret, decryptSecret } = await import('../src/lib/crypto.js')

    const encrypted = encryptSecret('test-secret')

    // Change the key
    process.env.ENCRYPTION_KEY = 'YW5vdGhlcmtleWFub3RoZXJrZXlhbm90aGVya2V5MQ=='
    // Force re-import to pick up new key - decryptSecret reads env at call time
    const result = decryptSecret(encrypted)
    // With wrong key, GCM auth tag verification fails → null
    assert.equal(result, null)
  })
})

// ─── sanitize.ts ───────────────────────────────────────────────────────────

describe('sanitize', () => {
  it('strips script tags from content', async () => {
    const { sanitizeContent } = await import('../src/lib/sanitize.js')
    const input = 'Hello <script>alert("xss")</script> world'
    const result = sanitizeContent(input)
    assert.ok(!result.includes('<script'), 'should strip script tags')
    assert.ok(result.includes('Hello'), 'should preserve surrounding text')
    assert.ok(result.includes('world'), 'should preserve surrounding text')
  })

  it('strips iframe tags', async () => {
    const { sanitizeContent } = await import('../src/lib/sanitize.js')
    const result = sanitizeContent('<iframe src="https://evil.com"></iframe>')
    assert.ok(!result.includes('<iframe'), 'should strip iframe tags')
  })

  it('strips object/embed tags', async () => {
    const { sanitizeContent } = await import('../src/lib/sanitize.js')
    const result = sanitizeContent('<object data="x"></object><embed src="y">')
    assert.ok(!result.includes('<object'), 'should strip object tags')
    assert.ok(!result.includes('<embed'), 'should strip embed tags')
  })

  it('strips form tags', async () => {
    const { sanitizeContent } = await import('../src/lib/sanitize.js')
    const result = sanitizeContent('<form action="/steal"><input></form>')
    assert.ok(!result.includes('<form'), 'should strip form tags')
  })

  it('strips inline event handlers from tags', async () => {
    const { sanitizeContent } = await import('../src/lib/sanitize.js')
    const result = sanitizeContent('<img src="x" onerror="alert(1)">')
    assert.ok(!result.includes('onerror'), 'should strip event handler')
    assert.ok(result.includes('src="x"'), 'should preserve safe attributes')
  })

  it('neutralizes javascript: URLs in href/src attributes', async () => {
    const { sanitizeContent } = await import('../src/lib/sanitize.js')
    const result = sanitizeContent('<a href="javascript:alert(1)">click</a>')
    assert.ok(!result.includes('javascript:'), 'should strip javascript: URL')
  })

  it('preserves legitimate markdown content', async () => {
    const { sanitizeContent } = await import('../src/lib/sanitize.js')
    const markdown = 'Use `Array<string>` for typed arrays. Also `a < b` is valid.'
    const result = sanitizeContent(markdown)
    assert.equal(result, markdown, 'should not modify legitimate content')
  })

  it('stripHtml removes all HTML and decodes entities', async () => {
    const { stripHtml } = await import('../src/lib/sanitize.js')
    assert.equal(stripHtml('&lt;b&gt;bold&lt;/b&gt;'), 'bold')
    assert.equal(stripHtml('<b>text</b>'), 'text')
    assert.equal(stripHtml('no tags'), 'no tags')
  })

  it('sanitizeText strips HTML and trims', async () => {
    const { sanitizeText } = await import('../src/lib/sanitize.js')
    assert.equal(sanitizeText('  <b>Hello</b>  '), 'Hello')
  })
})

// ─── tokenRevocation (parseDurationToSeconds logic) ────────────────────────

describe('tokenRevocation duration parsing', () => {
  // We test parseDurationToSeconds indirectly — it's not exported, but we can
  // verify its behaviour through the module's ACCESS_TOKEN_TTL constant.
  // Instead, we test the public API contract of revokeUserTokens / isTokenRevoked.

  it('revokeUserTokens stores revocation in memory when Redis is unavailable', async () => {
    // Ensure Redis is not configured for this test
    const origRedisUrl = process.env.REDIS_URL
    delete process.env.REDIS_URL

    const { revokeUserTokens, isTokenRevoked } = await import('../src/lib/tokenRevocation.js')

    const userId = 'test-user-' + Date.now()
    const beforeRevoke = Date.now()

    await revokeUserTokens(userId)

    // Token issued before revocation should be revoked
    const revoked = await isTokenRevoked(userId, beforeRevoke - 1000)
    assert.equal(revoked, true, 'token issued before revocation should be marked as revoked')

    // Token issued after revocation should not be revoked
    const notRevoked = await isTokenRevoked(userId, Date.now() + 1000)
    assert.equal(notRevoked, false, 'token issued after revocation should not be revoked')

    // Restore env
    if (origRedisUrl) process.env.REDIS_URL = origRedisUrl
  })

  it('isTokenRevoked returns false for unknown user', async () => {
    const { isTokenRevoked } = await import('../src/lib/tokenRevocation.js')
    const result = await isTokenRevoked('nonexistent-user-' + Date.now(), Date.now())
    assert.equal(result, false)
  })
})

// ─── logger (sensitive key redaction) ──────────────────────────────────────

describe('logger', () => {
  it('exports createLogger that returns all log methods', async () => {
    const { createLogger } = await import('../src/lib/logger.js')
    const logger = createLogger('TestCtx')
    assert.equal(typeof logger.debug, 'function')
    assert.equal(typeof logger.info, 'function')
    assert.equal(typeof logger.warn, 'function')
    assert.equal(typeof logger.error, 'function')
    assert.equal(typeof logger.fatal, 'function')
  })
})
