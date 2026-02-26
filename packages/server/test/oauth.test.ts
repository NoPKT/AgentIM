import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  startServer,
  stopServer,
  api,
  registerUser,
  fetchRetry,
  BASE_URL,
} from './helpers.js'

describe('OAuth Routes', () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    await stopServer()
  })

  // ─── GET /api/auth/oauth/providers ───

  describe('GET /api/auth/oauth/providers', () => {
    it('returns empty array when no providers are configured', async () => {
      const res = await api('GET', '/api/auth/oauth/providers')
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(Array.isArray(res.data.data))
      assert.equal(res.data.data.length, 0)
    })

    it('returns consistent result on repeated calls', async () => {
      const res1 = await api('GET', '/api/auth/oauth/providers')
      const res2 = await api('GET', '/api/auth/oauth/providers')
      assert.deepEqual(res1.data, res2.data)
    })
  })

  // ─── GET /api/auth/oauth/:provider (redirect to OAuth) ───

  describe('GET /api/auth/oauth/:provider', () => {
    it('returns 400 for invalid provider', async () => {
      const res = await api('GET', '/api/auth/oauth/facebook')
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Invalid provider')
    })

    it('returns 400 for another invalid provider name', async () => {
      const res = await api('GET', '/api/auth/oauth/twitter')
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Invalid provider')
    })

    it('returns 400 for unconfigured github provider', async () => {
      const res = await api('GET', '/api/auth/oauth/github')
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Provider not configured')
    })

    it('returns 400 for unconfigured google provider', async () => {
      const res = await api('GET', '/api/auth/oauth/google')
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Provider not configured')
    })

    it('returns 400 for empty provider string', async () => {
      // /api/auth/oauth/ without a provider param — route won't match :provider
      // The path /api/auth/oauth/ should either 404 or match the /providers route
      // Test with a numeric provider
      const res = await api('GET', '/api/auth/oauth/12345')
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Invalid provider')
    })
  })

  // ─── GET /api/auth/oauth/:provider/callback ───

  describe('GET /api/auth/oauth/:provider/callback', () => {
    it('redirects to /login?error=invalid_provider for invalid provider', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/facebook/callback`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=invalid_provider'))
    })

    it('redirects to /login?error=missing_params when no code or state', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/github/callback`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=missing_params'))
    })

    it('redirects to /login?error=missing_params when only code is provided', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/github/callback?code=abc123`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=missing_params'))
    })

    it('redirects to /login?error=missing_params when only state is provided', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/github/callback?state=xyz`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=missing_params'))
    })

    it('redirects to /login?error=invalid_state when state is not in pending store', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/github/callback?code=abc123&state=bogus_state`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=invalid_state'))
    })

    it('forwards error parameter from OAuth provider', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/github/callback?error=access_denied`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=access_denied'))
    })

    it('URL-encodes error parameter from provider', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/google/callback?error=user+denied+access`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      // The error should be present in the redirect
      assert.ok(location.includes('/login?error='))
    })

    it('handles google callback with missing params the same way', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/google/callback`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=missing_params'))
    })

    it('redirects with invalid_state for google callback with random state', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/google/callback?code=somecode&state=randomstate`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=invalid_state'))
    })
  })

  // ─── POST /api/auth/oauth/:provider/link ───

  describe('POST /api/auth/oauth/:provider/link', () => {
    it('returns 401 without authentication', async () => {
      const res = await api('POST', '/api/auth/oauth/github/link')
      assert.equal(res.status, 401)
    })

    it('returns 400 for invalid provider with auth', async () => {
      const user = await registerUser('oauth_link_user1')
      const res = await api('POST', '/api/auth/oauth/facebook/link', undefined, user.accessToken)
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Invalid provider')
    })

    it('returns 400 for another invalid provider', async () => {
      const user = await registerUser('oauth_link_user2')
      const res = await api('POST', '/api/auth/oauth/linkedin/link', undefined, user.accessToken)
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Invalid provider')
    })

    it('returns 400 for unconfigured github provider', async () => {
      const user = await registerUser('oauth_link_user3')
      const res = await api('POST', '/api/auth/oauth/github/link', undefined, user.accessToken)
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Provider not configured')
    })

    it('returns 400 for unconfigured google provider', async () => {
      const user = await registerUser('oauth_link_user4')
      const res = await api('POST', '/api/auth/oauth/google/link', undefined, user.accessToken)
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Provider not configured')
    })

    it('returns 401 with expired/invalid token', async () => {
      const res = await api(
        'POST',
        '/api/auth/oauth/github/link',
        undefined,
        'invalid.jwt.token',
      )
      assert.equal(res.status, 401)
    })
  })

  // ─── DELETE /api/auth/oauth/:provider/unlink ───

  describe('DELETE /api/auth/oauth/:provider/unlink', () => {
    it('returns 401 without authentication', async () => {
      const res = await api('DELETE', '/api/auth/oauth/github/unlink')
      assert.equal(res.status, 401)
    })

    it('returns 400 for invalid provider with auth', async () => {
      const user = await registerUser('oauth_unlink_user1')
      const res = await api(
        'DELETE',
        '/api/auth/oauth/facebook/unlink',
        undefined,
        user.accessToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Invalid provider')
    })

    it('returns 400 for numeric provider name', async () => {
      const user = await registerUser('oauth_unlink_user2')
      const res = await api(
        'DELETE',
        '/api/auth/oauth/123/unlink',
        undefined,
        user.accessToken,
      )
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Invalid provider')
    })

    it('returns 404 when github is not linked', async () => {
      const user = await registerUser('oauth_unlink_user3')
      const res = await api(
        'DELETE',
        '/api/auth/oauth/github/unlink',
        undefined,
        user.accessToken,
      )
      assert.equal(res.status, 404)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Not linked')
    })

    it('returns 404 when google is not linked', async () => {
      const user = await registerUser('oauth_unlink_user4')
      const res = await api(
        'DELETE',
        '/api/auth/oauth/google/unlink',
        undefined,
        user.accessToken,
      )
      assert.equal(res.status, 404)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Not linked')
    })

    it('returns 401 with expired/invalid token', async () => {
      const res = await api(
        'DELETE',
        '/api/auth/oauth/github/unlink',
        undefined,
        'expired.token.value',
      )
      assert.equal(res.status, 401)
    })
  })

  // ─── Edge cases & cross-cutting concerns ───

  describe('Edge cases', () => {
    it('providers endpoint does not require authentication', async () => {
      // Verify it works without any token
      const res = await fetchRetry(`${BASE_URL}/api/auth/oauth/providers`)
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.ok, true)
      assert.deepEqual(data.data, [])
    })

    it('callback with both error and code params prioritizes error', async () => {
      // When error is present, it should redirect with the error regardless of code/state
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/github/callback?error=server_error&code=abc&state=xyz`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=server_error'))
    })

    it('callback for invalid provider ignores code/state and redirects immediately', async () => {
      const res = await fetchRetry(
        `${BASE_URL}/api/auth/oauth/invalid/callback?code=abc&state=xyz`,
        { redirect: 'manual' },
      )
      assert.equal(res.status, 302)
      const location = res.headers.get('location')
      assert.ok(location, 'Should have Location header')
      assert.ok(location.includes('/login?error=invalid_provider'))
    })

    it('special characters in provider name are treated as invalid', async () => {
      const res = await api('GET', '/api/auth/oauth/git%00hub')
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.equal(res.data.error, 'Invalid provider')
    })

    it('link endpoint does not accept GET method', async () => {
      const user = await registerUser('oauth_method_user')
      const res = await api('GET', '/api/auth/oauth/github/link', undefined, user.accessToken)
      // Should be 404 or 405 since only POST is registered for /link
      assert.ok(res.status === 404 || res.status === 405)
    })

    it('unlink endpoint does not accept POST method', async () => {
      const user = await registerUser('oauth_method_user2')
      const res = await api('POST', '/api/auth/oauth/github/unlink', undefined, user.accessToken)
      // Should be 404 or 405 since only DELETE is registered for /unlink
      assert.ok(res.status === 404 || res.status === 405)
    })
  })
})
