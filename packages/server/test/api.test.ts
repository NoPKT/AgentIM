import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  startServer,
  stopServer,
  api,
  registerUser,
} from './helpers.js'

describe('AgentIM Server API', () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    await stopServer()
  })

  // ─── Health ───

  describe('GET /api/health', () => {
    it('returns ok', async () => {
      const res = await api('GET', '/api/health')
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.timestamp)
    })
  })

  // ─── Auth ───

  describe('Auth', () => {
    it('registers a new user', async () => {
      const res = await api('POST', '/api/auth/register', {
        username: 'alice',
        password: 'password123',
      })
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.user.username, 'alice')
      assert.ok(res.data.data.accessToken)
      assert.ok(res.data.data.refreshToken)
    })

    it('rejects duplicate username', async () => {
      const res = await api('POST', '/api/auth/register', {
        username: 'alice',
        password: 'password123',
      })
      assert.equal(res.status, 409)
      assert.equal(res.data.ok, false)
    })

    it('rejects short password', async () => {
      const res = await api('POST', '/api/auth/register', {
        username: 'bob',
        password: 'short',
      })
      assert.equal(res.status, 400)
    })

    it('logs in with valid credentials', async () => {
      const res = await api('POST', '/api/auth/login', {
        username: 'alice',
        password: 'password123',
      })
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.data.accessToken)
      assert.ok(res.data.data.refreshToken)
    })

    it('rejects wrong password', async () => {
      const res = await api('POST', '/api/auth/login', {
        username: 'alice',
        password: 'wrongpass',
      })
      assert.equal(res.status, 401)
    })

    it('refreshes tokens', async () => {
      const login = await api('POST', '/api/auth/login', {
        username: 'alice',
        password: 'password123',
      })
      const refreshToken = login.data.data.refreshToken

      // Wait 1.1s so JWT `iat` (seconds precision) differs
      await new Promise((r) => setTimeout(r, 1100))

      const res = await api('POST', '/api/auth/refresh', { refreshToken })
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.data.accessToken)
      assert.ok(res.data.data.refreshToken)
      // New tokens should be different (different iat)
      assert.notEqual(res.data.data.accessToken, login.data.data.accessToken)
    })

    it('rejects requests without token', async () => {
      const res = await api('GET', '/api/users/me')
      assert.equal(res.status, 401)
    })
  })

  // ─── Rooms ───

  describe('Rooms', () => {
    let token: string
    let userId: string
    let roomId: string

    before(async () => {
      const user = await registerUser('roomuser')
      token = user.accessToken
      userId = user.userId
    })

    it('creates a room', async () => {
      const res = await api('POST', '/api/rooms', { name: 'Test Room' }, token)
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.name, 'Test Room')
      assert.equal(res.data.data.type, 'group')
      roomId = res.data.data.id
    })

    it('lists rooms', async () => {
      const res = await api('GET', '/api/rooms', undefined, token)
      assert.equal(res.status, 200)
      assert.ok(res.data.data.length >= 1)
    })

    it('gets room by id', async () => {
      const res = await api('GET', `/api/rooms/${roomId}`, undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.name, 'Test Room')
    })

    it('updates room name', async () => {
      const res = await api('PUT', `/api/rooms/${roomId}`, { name: 'Renamed' }, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.name, 'Renamed')
    })

    it('updates broadcast mode', async () => {
      const res = await api('PUT', `/api/rooms/${roomId}`, { broadcastMode: true }, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.broadcastMode, true)
    })

    it('gets room members', async () => {
      const res = await api('GET', `/api/rooms/${roomId}/members`, undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.length, 1) // creator is auto-added
      assert.equal(res.data.data[0].memberType, 'user')
      assert.equal(res.data.data[0].role, 'owner')
    })

    it('adds a member', async () => {
      const user2 = await registerUser('roomuser2')
      const res = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: user2.userId, memberType: 'user' },
        token,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)

      // Verify member count
      const members = await api('GET', `/api/rooms/${roomId}/members`, undefined, token)
      assert.equal(members.data.data.length, 2)
    })

    it('removes a member', async () => {
      const members = await api('GET', `/api/rooms/${roomId}/members`, undefined, token)
      const nonOwner = members.data.data.find((m: any) => m.role !== 'owner')

      const res = await api(
        'DELETE',
        `/api/rooms/${roomId}/members/${nonOwner.memberId}`,
        undefined,
        token,
      )
      assert.equal(res.status, 200)
    })

    it('deletes a room', async () => {
      // Create a room to delete
      const createRes = await api('POST', '/api/rooms', { name: 'ToDelete' }, token)
      const delId = createRes.data.data.id

      const res = await api('DELETE', `/api/rooms/${delId}`, undefined, token)
      assert.equal(res.status, 200)

      // Verify it's gone
      const getRes = await api('GET', `/api/rooms/${delId}`, undefined, token)
      assert.equal(getRes.status, 404)
    })
  })

  // ─── Tasks ───

  describe('Tasks', () => {
    let token: string
    let roomId: string
    let taskId: string

    before(async () => {
      const user = await registerUser('taskuser')
      token = user.accessToken

      const room = await api('POST', '/api/rooms', { name: 'Task Room' }, token)
      roomId = room.data.data.id
    })

    it('creates a task', async () => {
      const res = await api(
        'POST',
        `/api/tasks/rooms/${roomId}`,
        { title: 'Fix bug', description: 'Fix the login bug' },
        token,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.title, 'Fix bug')
      assert.equal(res.data.data.status, 'pending')
      taskId = res.data.data.id
    })

    it('lists tasks in room', async () => {
      const res = await api('GET', `/api/tasks/rooms/${roomId}`, undefined, token)
      assert.equal(res.status, 200)
      assert.ok(res.data.data.length >= 1)
    })

    it('updates task status', async () => {
      const res = await api('PUT', `/api/tasks/${taskId}`, { status: 'in_progress' }, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.status, 'in_progress')
    })

    it('deletes a task', async () => {
      const res = await api('DELETE', `/api/tasks/${taskId}`, undefined, token)
      assert.equal(res.status, 200)
    })
  })

  // ─── Users ───

  describe('Users', () => {
    let token: string

    before(async () => {
      const user = await registerUser('profileuser')
      token = user.accessToken
    })

    it('gets current user profile', async () => {
      const res = await api('GET', '/api/users/me', undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.username, 'profileuser')
    })

    it('updates display name', async () => {
      const res = await api('PUT', '/api/users/me', { displayName: 'Profile User' }, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.displayName, 'Profile User')
    })
  })

  // ─── Security ───

  describe('Security', () => {
    it('returns secure headers', async () => {
      const res = await fetch(`http://localhost:3999/api/health`)
      assert.ok(res.headers.get('x-content-type-options'))
      assert.ok(res.headers.get('x-frame-options'))
    })

    it('sanitizes XSS in room names', async () => {
      const user = await registerUser('xssuser')
      const res = await api(
        'POST',
        '/api/rooms',
        { name: '<script>alert(1)</script>Test' },
        user.accessToken,
      )
      assert.equal(res.data.ok, true)
      assert.ok(!res.data.data.name.includes('<script>'))
    })
  })
})
