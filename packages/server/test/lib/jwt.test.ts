import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT, decodeProtectedHeader, jwtVerify } from 'jose'
import { config } from '../../src/config.js'
import {
  signAccessToken,
  signRefreshToken,
  signTotpChallengeToken,
  verifyToken,
} from '../../src/lib/jwt.js'

describe('jwt', () => {
  const originalPrevious = config.jwtSecretPrevious

  afterEach(() => {
    // Restore the original jwtSecretPrevious after key rotation tests
    config.jwtSecretPrevious = originalPrevious
  })

  it('sign and verify round-trip for access token', async () => {
    const token = await signAccessToken({ sub: 'user123', username: 'alice' })
    assert.ok(typeof token === 'string')
    assert.ok(token.length > 0)

    const payload = await verifyToken(token)
    assert.equal(payload.sub, 'user123')
    assert.equal(payload.username, 'alice')
    assert.equal(payload.type, 'access')
  })

  it('sign and verify round-trip for refresh token', async () => {
    const token = await signRefreshToken({ sub: 'user456', username: 'bob' })
    assert.ok(typeof token === 'string')

    const payload = await verifyToken(token)
    assert.equal(payload.sub, 'user456')
    assert.equal(payload.username, 'bob')
    assert.equal(payload.type, 'refresh')
  })

  it('sign and verify round-trip for TOTP challenge token', async () => {
    const token = await signTotpChallengeToken({ sub: 'user789', username: 'charlie' })
    assert.ok(typeof token === 'string')

    const payload = await verifyToken(token)
    assert.equal(payload.sub, 'user789')
    assert.equal(payload.username, 'charlie')
    assert.equal(payload.type, 'totp_challenge')
  })

  it('signed token contains kid in protected header', async () => {
    const token = await signAccessToken({ sub: 'user1', username: 'test' })
    const header = decodeProtectedHeader(token)
    assert.equal(header.alg, 'HS256')
    assert.ok(typeof header.kid === 'string', 'header should contain kid')
    assert.ok(header.kid.length > 0, 'kid should be non-empty')
  })

  it('access and refresh tokens have different jti values', async () => {
    const t1 = await signAccessToken({ sub: 'u', username: 'a' })
    const t2 = await signAccessToken({ sub: 'u', username: 'a' })
    // Decode the payloads to compare jti
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'dev-secret-change-me',
    )
    const p1 = (await jwtVerify(t1, secret, { issuer: 'agentim', audience: 'agentim' })).payload
    const p2 = (await jwtVerify(t2, secret, { issuer: 'agentim', audience: 'agentim' })).payload
    assert.notEqual(p1.jti, p2.jti, 'each token should have a unique jti')
  })

  it('access token has issuer and audience set to agentim', async () => {
    const token = await signAccessToken({ sub: 'u', username: 'a' })
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'dev-secret-change-me',
    )
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'agentim',
      audience: 'agentim',
    })
    assert.equal(payload.iss, 'agentim')
    assert.equal(payload.aud, 'agentim')
  })

  it('rejects a token signed with a completely different secret', async () => {
    // Create a token manually with a different secret but correct structure
    const wrongSecret = new TextEncoder().encode('wrong-secret-not-the-real-one-at-all')
    const forgedToken = await new SignJWT({
      sub: 'hacker',
      username: 'evil',
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256', kid: 'fakekid' })
      .setIssuer('agentim')
      .setAudience('agentim')
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(wrongSecret)

    await assert.rejects(async () => {
      await verifyToken(forgedToken)
    }, 'should reject token signed with wrong secret')
  })

  it('rejects a garbage/malformed token', async () => {
    await assert.rejects(async () => {
      await verifyToken('this.is.not.a.valid.jwt')
    })
  })

  it('rejects a token with invalid payload (missing required fields)', async () => {
    // Sign a token with the correct secret but wrong payload shape
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'dev-secret-change-me',
    )
    const badToken = await new SignJWT({
      sub: 'user1',
      // Missing: username and type
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('agentim')
      .setAudience('agentim')
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(secret)

    await assert.rejects(
      async () => {
        await verifyToken(badToken)
      },
      (err: Error) => {
        assert.ok(
          err.message.includes('Invalid token payload'),
          `expected "Invalid token payload" but got "${err.message}"`,
        )
        return true
      },
    )
  })

  it('rejects a token with wrong issuer', async () => {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'dev-secret-change-me',
    )
    const badToken = await new SignJWT({
      sub: 'user1',
      username: 'test',
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('wrong-issuer')
      .setAudience('agentim')
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(secret)

    await assert.rejects(async () => {
      await verifyToken(badToken)
    }, 'should reject token with wrong issuer')
  })

  it('rejects a token with wrong audience', async () => {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'dev-secret-change-me',
    )
    const badToken = await new SignJWT({
      sub: 'user1',
      username: 'test',
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('agentim')
      .setAudience('wrong-audience')
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(secret)

    await assert.rejects(async () => {
      await verifyToken(badToken)
    }, 'should reject token with wrong audience')
  })

  it('key rotation fallback: verifies token signed with previous secret', async () => {
    // Sign a token with a key that differs from config.jwtSecret
    const previousSecret = 'previous-secret-key-for-rotation-test!'
    const previousSecretBytes = new TextEncoder().encode(previousSecret)
    const oldToken = await new SignJWT({
      sub: 'rotuser',
      username: 'rotate',
      type: 'access' as const,
    })
      .setProtectedHeader({ alg: 'HS256', kid: 'oldkid' })
      .setIssuer('agentim')
      .setAudience('agentim')
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(previousSecretBytes)

    // Without the previous secret configured, verification should fail
    config.jwtSecretPrevious = ''
    await assert.rejects(async () => {
      // Use a fresh module to reset the cached previous secret
      const mod = await import(`../../src/lib/jwt.js?rot-fail-${Date.now()}`)
      await mod.verifyToken(oldToken)
    }, 'should reject without previous secret configured')

    // Now configure the previous secret and get a fresh module
    config.jwtSecretPrevious = previousSecret
    const freshMod = await import(`../../src/lib/jwt.js?rot-pass-${Date.now()}`)
    const payload = await freshMod.verifyToken(oldToken)
    assert.equal(payload.sub, 'rotuser')
    assert.equal(payload.username, 'rotate')
    assert.equal(payload.type, 'access')
  })

  it('rejects token when neither current nor previous key matches', async () => {
    // Sign a token with a key that matches neither current nor previous
    const unknownSecret = new TextEncoder().encode('totally-unknown-secret-key-here!!')
    const unknownToken = await new SignJWT({
      sub: 'baduser',
      username: 'bad',
      type: 'access' as const,
    })
      .setProtectedHeader({ alg: 'HS256', kid: 'unknownkid' })
      .setIssuer('agentim')
      .setAudience('agentim')
      .setExpirationTime('15m')
      .setIssuedAt()
      .sign(unknownSecret)

    // Configure a previous secret that ALSO does not match
    config.jwtSecretPrevious = 'also-not-the-right-key-for-this!!!'
    const freshMod = await import(`../../src/lib/jwt.js?rot-neither-${Date.now()}`)
    await assert.rejects(async () => {
      await freshMod.verifyToken(unknownToken)
    }, 'should reject when neither current nor previous key matches')
  })
})
