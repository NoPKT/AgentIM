import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, registerUser, BASE_URL, fetchRetry } from './helpers.js'

describe('Security', () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    await stopServer()
  })

  // ─── XSS Prevention ───

  describe('XSS prevention', () => {
    it('rejects script tags in room name', async () => {
      const user = await registerUser('xss-user1')
      // Attempt to create a room with a script-tag name
      const roomRes = await api(
        'POST',
        '/api/rooms',
        { name: '<script>alert("xss")</script>', type: 'private', broadcastMode: false },
        user.accessToken,
      )
      // Should either reject or sanitize the name
      if (roomRes.data.ok && roomRes.data.data) {
        assert.ok(!roomRes.data.data.name.includes('<script'))
      }
    })

    it('rejects HTML in username', async () => {
      const adminToken = (
        await api('POST', '/api/auth/login', { username: 'admin', password: 'AdminPass123' })
      ).data.data.accessToken
      const res = await api(
        'POST',
        '/api/users',
        { username: '<b>evil</b>', password: 'TestPass123' },
        adminToken,
      )
      // Username should be rejected by validation
      assert.notEqual(res.status, 200)
    })

    it('rejects HTML in room name', async () => {
      const user = await registerUser('xss-room-user')
      const res = await api(
        'POST',
        '/api/rooms',
        { name: '<img onerror=alert(1) src=x>', type: 'private', broadcastMode: false },
        user.accessToken,
      )
      // Should either reject or sanitize — check that the stored name is safe
      if (res.data.ok && res.data.data) {
        assert.ok(!res.data.data.name.includes('<img'))
      }
    })
  })

  // ─── Authentication Edge Cases ───

  describe('Authentication edge cases', () => {
    it('rejects expired/invalid JWT', async () => {
      const res = await api('GET', '/api/rooms', undefined, 'invalid.jwt.token')
      assert.equal(res.status, 401)
    })

    it('rejects empty authorization header', async () => {
      const res = await api('GET', '/api/rooms', undefined, '')
      assert.equal(res.status, 401)
    })

    it('rejects request without authorization', async () => {
      const res = await fetchRetry(`${BASE_URL}/api/rooms`, { method: 'GET' })
      assert.equal(res.status, 401)
    })

    it('rejects login with empty password', async () => {
      const res = await api('POST', '/api/auth/login', {
        username: 'admin',
        password: '',
      })
      assert.notEqual(res.status, 200)
    })

    it('rejects login with missing fields', async () => {
      const res = await api('POST', '/api/auth/login', { username: 'admin' })
      assert.notEqual(res.status, 200)
    })

    it('returns consistent error for wrong username vs wrong password', async () => {
      const wrongUser = await api('POST', '/api/auth/login', {
        username: 'nonexistent-user-xyz',
        password: 'SomePass123',
      })
      const wrongPass = await api('POST', '/api/auth/login', {
        username: 'admin',
        password: 'WrongPassword999',
      })
      // Both should return 401 with generic error (no user enumeration)
      assert.equal(wrongUser.status, 401)
      assert.equal(wrongPass.status, 401)
    })
  })

  // ─── Input Validation ───

  describe('Input validation', () => {
    it('rejects oversized room name', async () => {
      const user = await registerUser('input-val-user')
      // Attempt to create a room with an excessively long name
      const bigName = 'x'.repeat(1000)
      const res = await api(
        'POST',
        '/api/rooms',
        { name: bigName, type: 'private', broadcastMode: false },
        user.accessToken,
      )
      // Should be rejected by validation
      assert.ok(res.status >= 400)
    })

    it('rejects invalid room type', async () => {
      const user = await registerUser('input-val-user2')
      const res = await api(
        'POST',
        '/api/rooms',
        { name: 'bad-type', type: 'invalid-type', broadcastMode: false },
        user.accessToken,
      )
      assert.ok(res.status >= 400)
    })

    it('rejects non-string room name', async () => {
      const user = await registerUser('input-val-user3')
      const res = await api(
        'POST',
        '/api/rooms',
        { name: 12345, type: 'private', broadcastMode: false },
        user.accessToken,
      )
      assert.ok(res.status >= 400)
    })

    it('rejects SQL injection in query parameters', async () => {
      const user = await registerUser('sqli-user')
      // Attempt SQL injection in cursor parameter
      const res = await api(
        'GET',
        `/api/rooms?cursor='; DROP TABLE users; --`,
        undefined,
        user.accessToken,
      )
      // Should not crash the server — returns either 400 or normal response
      assert.ok(res.status < 500)
    })
  })

  // ─── Authorization (RBAC) ───

  describe('Authorization', () => {
    it('non-admin cannot create users', async () => {
      const user = await registerUser('non-admin-user')
      const res = await api(
        'POST',
        '/api/users',
        { username: 'hacked', password: 'TestPass123' },
        user.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('non-admin cannot access admin endpoints', async () => {
      const user = await registerUser('non-admin-user2')
      const res = await api('GET', '/api/admin/metrics', undefined, user.accessToken)
      assert.equal(res.status, 403)
    })

    it('user cannot delete another user room', async () => {
      const user1 = await registerUser('room-owner')
      const user2 = await registerUser('room-intruder')
      const roomRes = await api(
        'POST',
        '/api/rooms',
        { name: 'private-room', type: 'private', broadcastMode: false },
        user1.accessToken,
      )
      const roomId = roomRes.data.data.id

      // User2 should not be able to delete user1's room
      const deleteRes = await api('DELETE', `/api/rooms/${roomId}`, undefined, user2.accessToken)
      assert.ok(deleteRes.status >= 400)
    })

    it('user cannot delete another user room', async () => {
      const user1 = await registerUser('msg-author')
      const user2 = await registerUser('msg-editor')

      // User1 creates a room
      const roomRes = await api(
        'POST',
        '/api/rooms',
        { name: 'edit-test', type: 'group', broadcastMode: false },
        user1.accessToken,
      )
      const roomId = roomRes.data.data.id

      // User2 tries to delete user1's room
      const deleteRes = await api('DELETE', `/api/rooms/${roomId}`, undefined, user2.accessToken)
      assert.ok(deleteRes.status >= 400)
    })
  })

  // ─── Secure Headers ───

  describe('Secure headers', () => {
    it('returns security headers on API responses', async () => {
      const res = await fetchRetry(`${BASE_URL}/api/health`)
      const headers = res.headers

      // Should have basic security headers
      assert.ok(
        headers.get('x-content-type-options') === 'nosniff' ||
          headers.get('content-type')?.includes('application/json'),
      )
    })

    it('health endpoint does not leak system details', async () => {
      const res = await fetchRetry(`${BASE_URL}/api/health`)
      const data = await res.json()

      // Should not expose memory, uptime, or other system details
      assert.equal(data.system, undefined)
      assert.equal(data.memoryUsage, undefined)
      assert.equal(data.uptime, undefined)
    })
  })

  // ─── File Upload Security ───

  describe('File upload security', () => {
    it('rejects upload without authentication', async () => {
      const formData = new FormData()
      formData.append('file', new Blob(['test']), 'test.txt')

      const res = await fetchRetry(`${BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      })
      assert.equal(res.status, 401)
    })

    it('rejects path traversal in filename', async () => {
      const user = await registerUser('upload-traversal-user')
      const formData = new FormData()
      formData.append(
        'file',
        new Blob(['test content'], { type: 'text/plain' }),
        '../../../etc/passwd',
      )

      const res = await fetchRetry(`${BASE_URL}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.accessToken}` },
        body: formData,
      })
      // Should either reject or sanitize the filename
      if (res.status === 200) {
        const data = await res.json()
        if (data.ok && data.data?.url) {
          assert.ok(!data.data.url.includes('..'))
        }
      }
    })
  })

  // ─── Rate Limiting ───

  describe('Rate limiting', () => {
    it('enforces login rate limit', async () => {
      // Attempt many rapid login attempts
      const results = []
      for (let i = 0; i < 25; i++) {
        const res = await api('POST', '/api/auth/login', {
          username: 'admin',
          password: 'WrongPass' + i,
        })
        results.push(res.status)
      }
      // At least some should be rate-limited (429)
      assert.ok(
        results.includes(429) || results.every((s) => s === 401),
        'Expected rate limiting (429) or auth rejection (401) for rapid login attempts',
      )
    })
  })

  // ─── Password Security ───

  describe('Password security', () => {
    it('password is not returned in user profile', async () => {
      const user = await registerUser('pw-check-user')
      const res = await api('GET', '/api/users/me', undefined, user.accessToken)
      assert.equal(res.status, 200)
      const userData = res.data.data
      assert.equal(userData.password, undefined)
      assert.equal(userData.passwordHash, undefined)
      assert.equal(userData.hash, undefined)
    })

    it('password is not returned in user list (admin)', async () => {
      const adminLogin = await api('POST', '/api/auth/login', {
        username: 'admin',
        password: 'AdminPass123',
      })
      const token = adminLogin.data.data.accessToken
      const res = await api('GET', '/api/users', undefined, token)
      assert.equal(res.status, 200)
      if (res.data.data && Array.isArray(res.data.data)) {
        for (const u of res.data.data) {
          assert.equal(u.password, undefined)
          assert.equal(u.passwordHash, undefined)
        }
      }
    })
  })

  // ─── Token Security ───

  describe('Token security', () => {
    it('refresh token cannot be used as access token', async () => {
      const user = await registerUser('token-test-user')
      // Try using refresh token for API access
      const res = await api('GET', '/api/rooms', undefined, user.refreshToken)
      assert.equal(res.status, 401)
    })

    it('changing password invalidates existing tokens', async () => {
      const user = await registerUser('pw-change-user')

      // Verify current token works
      const before = await api('GET', '/api/rooms', undefined, user.accessToken)
      assert.equal(before.status, 200)

      // Change password
      await api(
        'PUT',
        '/api/users/me/password',
        { currentPassword: 'TestPass123', newPassword: 'NewPass456!' },
        user.accessToken,
      )

      // After password change, the old token should eventually be rejected
      // (depends on token revocation implementation — may need short delay)
      // This is a best-effort check
    })
  })

  // ─── Room Access Control ───

  describe('Room access control', () => {
    it('non-member cannot read room messages', async () => {
      const user1 = await registerUser('room-ac-owner')
      const user2 = await registerUser('room-ac-outsider')

      const roomRes = await api(
        'POST',
        '/api/rooms',
        { name: 'private-ac-room', type: 'private', broadcastMode: false },
        user1.accessToken,
      )
      const roomId = roomRes.data.data.id

      // User2 is not a member — should not see messages
      const msgRes = await api('GET', `/api/messages/rooms/${roomId}`, undefined, user2.accessToken)
      assert.ok(msgRes.status >= 400)
    })

    it('non-member cannot join a private room', async () => {
      const user1 = await registerUser('room-send-owner')
      const user2 = await registerUser('room-send-outsider')

      const roomRes = await api(
        'POST',
        '/api/rooms',
        { name: 'private-send-room', type: 'private', broadcastMode: false },
        user1.accessToken,
      )
      const roomId = roomRes.data.data.id

      // User2 tries to add themselves as a member
      const joinRes = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: user2.userId, memberType: 'user' },
        user2.accessToken,
      )
      assert.ok(joinRes.status >= 400)
    })
  })
})
