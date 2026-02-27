import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TOTP, Secret } from 'otpauth'
import {
  generateTotpSecret,
  getTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  verifyBackupCode,
} from '../../src/lib/totp.js'

describe('generateTotpSecret', () => {
  it('returns a base32-encoded string', () => {
    const secret = generateTotpSecret()
    assert.ok(typeof secret === 'string')
    assert.ok(secret.length > 0)
    // Base32 uses A-Z and 2-7 (and optionally = padding)
    assert.match(secret, /^[A-Z2-7=]+$/)
  })

  it('returns different secrets on each call', () => {
    const s1 = generateTotpSecret()
    const s2 = generateTotpSecret()
    assert.notEqual(s1, s2)
  })
})

describe('getTotpUri', () => {
  it('returns a valid otpauth:// URI', () => {
    const secret = generateTotpSecret()
    const uri = getTotpUri(secret, 'alice')
    assert.ok(uri.startsWith('otpauth://totp/'), 'should start with otpauth://totp/')
  })

  it('contains the username in the URI', () => {
    const secret = generateTotpSecret()
    const uri = getTotpUri(secret, 'bob')
    // The label should contain the username
    assert.ok(uri.includes('bob'), 'URI should contain the username')
  })

  it('contains the issuer parameter', () => {
    const secret = generateTotpSecret()
    const uri = getTotpUri(secret, 'charlie')
    // Default issuer is 'AgentIM' from config
    assert.ok(uri.includes('issuer='), 'URI should contain issuer parameter')
  })

  it('contains required TOTP parameters', () => {
    const secret = generateTotpSecret()
    const uri = getTotpUri(secret, 'dave')
    assert.ok(uri.includes('secret='), 'URI should contain secret parameter')
    assert.ok(uri.includes('algorithm='), 'URI should contain algorithm parameter')
    assert.ok(uri.includes('digits='), 'URI should contain digits parameter')
    assert.ok(uri.includes('period='), 'URI should contain period parameter')
  })
})

describe('verifyTotpCode', () => {
  it('accepts a correct TOTP code for the current time', () => {
    const base32Secret = generateTotpSecret()
    // Generate a valid code using the same library
    const totp = new TOTP({
      issuer: 'AgentIM',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(base32Secret),
    })
    const code = totp.generate()
    assert.equal(verifyTotpCode(base32Secret, code), true)
  })

  it('rejects an incorrect TOTP code', () => {
    const base32Secret = generateTotpSecret()
    // Use a clearly invalid code
    assert.equal(verifyTotpCode(base32Secret, '000000'), false)
  })

  it('rejects a code that is too short', () => {
    const base32Secret = generateTotpSecret()
    assert.equal(verifyTotpCode(base32Secret, '123'), false)
  })

  it('rejects a code that is too long', () => {
    const base32Secret = generateTotpSecret()
    assert.equal(verifyTotpCode(base32Secret, '12345678'), false)
  })
})

describe('generateBackupCodes', () => {
  it('returns 10 plain codes and 10 hashed codes', async () => {
    const { plainCodes, hashedCodes } = await generateBackupCodes()
    assert.equal(plainCodes.length, 10)
    assert.equal(hashedCodes.length, 10)
  })

  it('plain codes are 8-character hex strings', async () => {
    const { plainCodes } = await generateBackupCodes()
    for (const code of plainCodes) {
      assert.equal(code.length, 8, `code "${code}" should be 8 chars`)
      assert.match(code, /^[0-9a-f]{8}$/, `code "${code}" should be lowercase hex`)
    }
  })

  it('hashed codes are argon2 hashes', async () => {
    const { hashedCodes } = await generateBackupCodes()
    for (const hash of hashedCodes) {
      assert.ok(hash.startsWith('$argon2'), `hash should start with $argon2, got: ${hash.slice(0, 20)}`)
    }
  })

  it('all plain codes are unique', async () => {
    const { plainCodes } = await generateBackupCodes()
    const unique = new Set(plainCodes)
    assert.equal(unique.size, 10, 'all 10 codes should be unique')
  })
})

describe('verifyBackupCode', () => {
  it('returns valid=true and removes the used code from remaining', async () => {
    const { plainCodes, hashedCodes } = await generateBackupCodes()
    const codeToUse = plainCodes[0]
    const result = await verifyBackupCode(codeToUse, hashedCodes)
    assert.equal(result.valid, true)
    assert.equal(result.remainingCodes.length, 9, 'one code should be consumed')
  })

  it('returns valid=false for an incorrect code', async () => {
    const { hashedCodes } = await generateBackupCodes()
    const result = await verifyBackupCode('00000000', hashedCodes)
    assert.equal(result.valid, false)
    assert.equal(
      result.remainingCodes.length,
      hashedCodes.length,
      'no codes should be consumed on failure',
    )
  })

  it('can verify any of the 10 codes, not just the first', async () => {
    const { plainCodes, hashedCodes } = await generateBackupCodes()
    // Verify the last code
    const codeToUse = plainCodes[9]
    const result = await verifyBackupCode(codeToUse, hashedCodes)
    assert.equal(result.valid, true)
    assert.equal(result.remainingCodes.length, 9)
  })

  it('returns valid=false with empty hashed codes array', async () => {
    const result = await verifyBackupCode('deadbeef', [])
    assert.equal(result.valid, false)
    assert.equal(result.remainingCodes.length, 0)
  })
})
