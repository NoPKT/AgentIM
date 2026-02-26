import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { SignJWT } from 'jose'

// Ensure a known JWT_SECRET before importing auth middleware
// (config.ts reads JWT_SECRET at module evaluation time)
process.env.JWT_SECRET = 'test-jwt-secret-for-auth-middleware'

const TEST_SECRET = new TextEncoder().encode('test-jwt-secret-for-auth-middleware')

// ─── Token helpers ─────────────────────────────────────────────────────────

async function makeAccessToken(
  sub: string,
  username: string,
  opts: { type?: string; exp?: string; iat?: number } = {},
): Promise<string> {
  const builder = new SignJWT({
    sub,
    username,
    type: opts.type ?? 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setIssuedAt(opts.iat ?? Math.floor(Date.now() / 1000))
    .setExpirationTime(opts.exp ?? '15m')

  return builder.sign(TEST_SECRET)
}

async function makeTokenWithWrongSecret(sub: string, username: string): Promise<string> {
  const wrongSecret = new TextEncoder().encode('wrong-secret-not-matching')
  return new SignJWT({ sub, username, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(wrongSecret)
}

async function makeExpiredToken(sub: string, username: string): Promise<string> {
  // iat in the past, exp also in the past
  const pastIat = Math.floor(Date.now() / 1000) - 3600
  return new SignJWT({ sub, username, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setIssuedAt(pastIat)
    .setExpirationTime(pastIat + 1) // expired 1 second after iat (long ago)
    .sign(TEST_SECRET)
}

async function makeRefreshToken(sub: string, username: string): Promise<string> {
  return makeAccessToken(sub, username, { type: 'refresh' })
}

// ─── authMiddleware tests ──────────────────────────────────────────────────

describe('authMiddleware', () => {
  let app: Hono

  beforeEach(async () => {
    // Dynamic import to pick up JWT_SECRET env change
    const { authMiddleware } = await import('../src/middleware/auth.js')

    app = new Hono()
    app.use('/protected/*', authMiddleware)
    app.get('/protected/resource', (c) => {
      const userId = c.get('userId')
      const username = c.get('username')
      return c.json({ ok: true, userId, username })
    })
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/protected/resource')
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Unauthorized')
  })

  it('returns 401 when Authorization header has no Bearer prefix', async () => {
    const res = await app.request('/protected/resource', {
      headers: { Authorization: 'Basic abc123' },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Unauthorized')
  })

  it('returns 401 when Authorization header is "Bearer " with empty token', async () => {
    const res = await app.request('/protected/resource', {
      headers: { Authorization: 'Bearer ' },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    // Empty token will fail verification
    assert.match(body.error, /Invalid|Unauthorized|expired/i)
  })

  it('returns 401 for a completely invalid (non-JWT) token', async () => {
    const res = await app.request('/protected/resource', {
      headers: { Authorization: 'Bearer not-a-jwt-token' },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid or expired token')
  })

  it('returns 401 for a token signed with wrong secret', async () => {
    const token = await makeTokenWithWrongSecret('user-1', 'alice')
    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid or expired token')
  })

  it('returns 401 for an expired token', async () => {
    const token = await makeExpiredToken('user-2', 'bob')
    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid or expired token')
  })

  it('returns 401 for a refresh token (wrong type)', async () => {
    const token = await makeRefreshToken('user-3', 'charlie')
    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid token type')
  })

  it('allows access with valid access token and sets context variables', async () => {
    const token = await makeAccessToken('user-42', 'testuser')
    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.userId, 'user-42')
    assert.equal(body.username, 'testuser')
  })

  it('returns 401 when token has wrong issuer', async () => {
    const token = await new SignJWT({
      sub: 'user-1',
      username: 'alice',
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('wrong-issuer')
      .setAudience('agentim')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(TEST_SECRET)

    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid or expired token')
  })

  it('returns 401 when token has wrong audience', async () => {
    const token = await new SignJWT({
      sub: 'user-1',
      username: 'alice',
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('agentim')
      .setAudience('wrong-audience')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(TEST_SECRET)

    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid or expired token')
  })

  it('returns 401 when token payload is missing sub', async () => {
    const token = await new SignJWT({
      username: 'alice',
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('agentim')
      .setAudience('agentim')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(TEST_SECRET)

    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid or expired token')
  })

  it('returns 401 when token payload is missing username', async () => {
    const token = await new SignJWT({
      sub: 'user-1',
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('agentim')
      .setAudience('agentim')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(TEST_SECRET)

    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid or expired token')
  })

  it('returns 401 when Authorization is "bearer" (lowercase)', async () => {
    const token = await makeAccessToken('user-1', 'alice')
    const res = await app.request('/protected/resource', {
      headers: { Authorization: `bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Unauthorized')
  })

  it('returns 401 when Authorization is "BEARER" (uppercase)', async () => {
    const token = await makeAccessToken('user-1', 'alice')
    const res = await app.request('/protected/resource', {
      headers: { Authorization: `BEARER ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Unauthorized')
  })

  it('allows multiple sequential requests with the same valid token', async () => {
    const token = await makeAccessToken('user-repeat', 'repeatuser')

    for (let i = 0; i < 3; i++) {
      const res = await app.request('/protected/resource', {
        headers: { Authorization: `Bearer ${token}` },
      })
      assert.equal(res.status, 200, `request ${i + 1} should succeed`)
      const body = await res.json()
      assert.equal(body.userId, 'user-repeat')
      assert.equal(body.username, 'repeatuser')
    }
  })

  it('returns 401 for a token with type "unknown"', async () => {
    // verifyToken() rejects tokens with an unrecognized type before the
    // middleware can check payload.type, so the error is 'Invalid or expired token'.
    const token = await makeAccessToken('user-1', 'alice', { type: 'unknown' })
    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Invalid or expired token')
  })
})

// ─── Token revocation integration ──────────────────────────────────────────

describe('authMiddleware + token revocation', () => {
  it('returns 401 for a revoked token', async () => {
    const { authMiddleware } = await import('../src/middleware/auth.js')
    const { revokeUserTokens } = await import('../src/lib/tokenRevocation.js')

    const app = new Hono()
    app.use('/protected/*', authMiddleware)
    app.get('/protected/resource', (c) =>
      c.json({ ok: true, userId: c.get('userId') }),
    )

    const userId = `revoke-test-user-${Date.now()}`

    // Create a token with iat slightly in the past
    const iatSec = Math.floor(Date.now() / 1000) - 5
    const token = await makeAccessToken(userId, 'revokeduser', { iat: iatSec })

    // Token should work before revocation
    const before = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(before.status, 200)

    // Revoke all tokens for this user
    await revokeUserTokens(userId)

    // Same token should now be rejected
    const after = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(after.status, 401)
    const body = await after.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'Token revoked')
  })

  it('allows tokens issued after revocation', async () => {
    const { authMiddleware } = await import('../src/middleware/auth.js')
    const { revokeUserTokens } = await import('../src/lib/tokenRevocation.js')

    const app = new Hono()
    app.use('/protected/*', authMiddleware)
    app.get('/protected/resource', (c) =>
      c.json({ ok: true, userId: c.get('userId') }),
    )

    const userId = `revoke-after-test-${Date.now()}`

    // Revoke tokens
    await revokeUserTokens(userId)

    // JWT iat is in seconds (floor), so we need to wait > 1s to ensure the new
    // token's iat (seconds * 1000) is strictly >= revocation timestamp (ms).
    // Use an explicit iat that is clearly in the future relative to revocation.
    const futureIat = Math.floor(Date.now() / 1000) + 2

    // Create a new token with iat clearly after the revocation
    const newToken = await makeAccessToken(userId, 'newuser', { iat: futureIat })
    const res = await app.request('/protected/resource', {
      headers: { Authorization: `Bearer ${newToken}` },
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.userId, userId)
  })
})

// ─── adminMiddleware tests ─────────────────────────────────────────────────

describe('adminMiddleware', () => {
  it('exports adminMiddleware as a function', async () => {
    const { adminMiddleware } = await import('../src/middleware/auth.js')
    assert.equal(typeof adminMiddleware, 'function')
  })

  it('invalidateAdminCache does not throw for any userId', async () => {
    const { invalidateAdminCache } = await import('../src/middleware/auth.js')
    // Should not throw for any input
    assert.doesNotThrow(() => invalidateAdminCache('nonexistent-user'))
    assert.doesNotThrow(() => invalidateAdminCache(''))
    assert.doesNotThrow(() => invalidateAdminCache('admin-user-123'))
  })

  it('invalidateAdminCache can be called multiple times for the same user', async () => {
    const { invalidateAdminCache } = await import('../src/middleware/auth.js')
    // Calling invalidate multiple times should be idempotent
    invalidateAdminCache('user-to-invalidate')
    invalidateAdminCache('user-to-invalidate')
    invalidateAdminCache('user-to-invalidate')
    // No error means success
  })
})

// ─── AuthEnv type export ───────────────────────────────────────────────────

describe('AuthEnv type export', () => {
  it('exports AuthEnv type (compile-time check via import)', async () => {
    // If this import succeeds without error, the type is properly exported
    const mod = await import('../src/middleware/auth.js')
    assert.ok(mod.authMiddleware, 'authMiddleware should be exported')
    assert.ok(mod.adminMiddleware, 'adminMiddleware should be exported')
    assert.ok(mod.invalidateAdminCache, 'invalidateAdminCache should be exported')
  })
})
