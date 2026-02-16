import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  startServer,
  stopServer,
  api,
  registerUser,
  connectWs,
  wsSendAndWait,
  WS_GATEWAY_URL,
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
    it('admin user is seeded and can login', async () => {
      const res = await api('POST', '/api/auth/login', {
        username: 'admin',
        password: 'AdminPass123',
      })
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.user.username, 'admin')
      assert.equal(res.data.data.user.role, 'admin')
      assert.ok(res.data.data.accessToken)
      assert.ok(res.data.data.refreshToken)
    })

    it('admin can create a user', async () => {
      const adminLogin = await api('POST', '/api/auth/login', {
        username: 'admin',
        password: 'AdminPass123',
      })
      const adminToken = adminLogin.data.data.accessToken

      const res = await api(
        'POST',
        '/api/users',
        {
          username: 'alice',
          password: 'Password123',
        },
        adminToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.username, 'alice')
      assert.equal(res.data.data.role, 'user')
    })

    it('rejects duplicate username', async () => {
      const adminLogin = await api('POST', '/api/auth/login', {
        username: 'admin',
        password: 'AdminPass123',
      })
      const adminToken = adminLogin.data.data.accessToken

      const res = await api(
        'POST',
        '/api/users',
        {
          username: 'alice',
          password: 'Password123',
        },
        adminToken,
      )
      assert.equal(res.status, 409)
      assert.equal(res.data.ok, false)
    })

    it('non-admin cannot create users', async () => {
      const user = await registerUser('nonadmin1')
      const res = await api(
        'POST',
        '/api/users',
        {
          username: 'shouldfail',
          password: 'Password123',
        },
        user.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('logs in with valid credentials', async () => {
      const res = await api('POST', '/api/auth/login', {
        username: 'alice',
        password: 'Password123',
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
        password: 'Password123',
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

    it('user can change password', async () => {
      const user = await registerUser('pwchange1')
      const res = await api(
        'PUT',
        '/api/users/me/password',
        {
          currentPassword: 'TestPass123',
          newPassword: 'NewPass12345',
        },
        user.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)

      // Can login with new password
      const login = await api('POST', '/api/auth/login', {
        username: 'pwchange1',
        password: 'NewPass12345',
      })
      assert.equal(login.status, 200)
      assert.equal(login.data.ok, true)
    })

    it('rejects wrong current password on change', async () => {
      const user = await registerUser('pwchange2')
      const res = await api(
        'PUT',
        '/api/users/me/password',
        {
          currentPassword: 'wrongpassword',
          newPassword: 'NewPass12345',
        },
        user.accessToken,
      )
      assert.equal(res.status, 400)
    })

    it('logout invalidates refresh token', async () => {
      const user = await registerUser('logouttest')
      // Logout
      await api('POST', '/api/auth/logout', undefined, user.accessToken)
      // Try to refresh with the old token — should fail
      const res = await api('POST', '/api/auth/refresh', { refreshToken: user.refreshToken })
      assert.equal(res.status, 401)
    })

    it('refresh token rotation invalidates old token', async () => {
      const user = await registerUser('rotatetest')

      // Wait so new JWT has different iat
      await new Promise((r) => setTimeout(r, 1100))

      // Refresh to rotate the token
      const refresh1 = await api('POST', '/api/auth/refresh', { refreshToken: user.refreshToken })
      assert.equal(refresh1.status, 200)

      // Old refresh token should no longer work
      const res = await api('POST', '/api/auth/refresh', { refreshToken: user.refreshToken })
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
      assert.equal(res.data.data.role, 'user')
    })

    it('updates display name', async () => {
      const res = await api('PUT', '/api/users/me', { displayName: 'Profile User' }, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.displayName, 'Profile User')
    })

    it('admin can list all users', async () => {
      const adminLogin = await api('POST', '/api/auth/login', {
        username: 'admin',
        password: 'AdminPass123',
      })
      const res = await api('GET', '/api/users', undefined, adminLogin.data.data.accessToken)
      assert.equal(res.status, 200)
      assert.ok(res.data.data.length >= 2) // admin + created users
    })

    it('admin can delete a user', async () => {
      const adminLogin = await api('POST', '/api/auth/login', {
        username: 'admin',
        password: 'AdminPass123',
      })
      const adminToken = adminLogin.data.data.accessToken

      // Create user to delete
      const create = await api(
        'POST',
        '/api/users',
        {
          username: 'todelete',
          password: 'Password123',
        },
        adminToken,
      )
      const deleteId = create.data.data.id

      const res = await api('DELETE', `/api/users/${deleteId}`, undefined, adminToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })
  })

  // ─── Room Permissions ───

  describe('Room Permissions', () => {
    let ownerToken: string
    let memberToken: string
    let outsiderToken: string
    let memberId: string
    let outsiderId: string
    let roomId: string

    before(async () => {
      const owner = await registerUser('rperm_owner')
      ownerToken = owner.accessToken

      const member = await registerUser('rperm_member')
      memberToken = member.accessToken
      memberId = member.userId

      const outsider = await registerUser('rperm_outsider')
      outsiderToken = outsider.accessToken
      outsiderId = outsider.userId

      // Create room and add member
      const room = await api('POST', '/api/rooms', { name: 'Perm Room' }, ownerToken)
      roomId = room.data.data.id

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        {
          memberId,
          memberType: 'user',
        },
        ownerToken,
      )
    })

    it('non-admin member cannot update room settings', async () => {
      const res = await api('PUT', `/api/rooms/${roomId}`, { name: 'Hacked' }, memberToken)
      assert.equal(res.status, 403)
    })

    it('non-admin member cannot add members', async () => {
      const res = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        {
          memberId: outsiderId,
          memberType: 'user',
        },
        memberToken,
      )
      assert.equal(res.status, 403)
    })

    it('non-admin member cannot remove other members', async () => {
      // Add outsider first (as owner)
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        {
          memberId: outsiderId,
          memberType: 'user',
        },
        ownerToken,
      )

      // Member tries to remove outsider
      const res = await api(
        'DELETE',
        `/api/rooms/${roomId}/members/${outsiderId}`,
        undefined,
        memberToken,
      )
      assert.equal(res.status, 403)
    })

    it('member can self-leave', async () => {
      const res = await api(
        'DELETE',
        `/api/rooms/${roomId}/members/${memberId}`,
        undefined,
        memberToken,
      )
      assert.equal(res.status, 200)
    })

    it('outsider cannot access room', async () => {
      // Re-register outsider for fresh token (outsider was added above but let's get a room they're NOT in)
      const newOutsider = await registerUser('rperm_out2')
      const createRes = await api('POST', '/api/rooms', { name: 'Private' }, ownerToken)
      const privateRoomId = createRes.data.data.id

      const res = await api(
        'GET',
        `/api/rooms/${privateRoomId}`,
        undefined,
        newOutsider.accessToken,
      )
      assert.equal(res.status, 403)
    })
  })

  // ─── Task Permissions ───

  describe('Task Permissions', () => {
    let ownerToken: string
    let memberToken: string
    let memberId: string
    let roomId: string
    let taskId: string

    before(async () => {
      const owner = await registerUser('tperm_owner')
      ownerToken = owner.accessToken

      const member = await registerUser('tperm_member')
      memberToken = member.accessToken
      memberId = member.userId

      // Create room and add member
      const room = await api('POST', '/api/rooms', { name: 'Task Perm Room' }, ownerToken)
      roomId = room.data.data.id

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        {
          memberId,
          memberType: 'user',
        },
        ownerToken,
      )

      // Owner creates a task
      const task = await api(
        'POST',
        `/api/tasks/rooms/${roomId}`,
        {
          title: 'Owner Task',
          description: 'Test',
        },
        ownerToken,
      )
      taskId = task.data.data.id
    })

    it('member can update task status', async () => {
      const res = await api('PUT', `/api/tasks/${taskId}`, { status: 'in_progress' }, memberToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.status, 'in_progress')
    })

    it('member cannot modify task title (non-status field)', async () => {
      const res = await api('PUT', `/api/tasks/${taskId}`, { title: 'Hacked Title' }, memberToken)
      assert.equal(res.status, 403)
    })

    it('member cannot delete task created by owner', async () => {
      const res = await api('DELETE', `/api/tasks/${taskId}`, undefined, memberToken)
      assert.equal(res.status, 403)
    })

    it('owner can delete their own task', async () => {
      const res = await api('DELETE', `/api/tasks/${taskId}`, undefined, ownerToken)
      assert.equal(res.status, 200)
    })
  })

  // ─── Agent Ownership & Sharing ───

  describe('Agent Ownership & Sharing', () => {
    let userAToken: string
    let userBToken: string
    let agentId: string
    let gwA: import('ws').default

    before(async () => {
      const userA = await registerUser('agent_owner')
      userAToken = userA.accessToken

      const userB = await registerUser('agent_other')
      userBToken = userB.accessToken

      // User A registers a gateway + agent via WebSocket
      gwA = await connectWs(WS_GATEWAY_URL)
      await wsSendAndWait(
        gwA,
        {
          type: 'gateway:auth',
          token: userAToken,
          gatewayId: 'ownership-gw',
          deviceInfo: { hostname: 'test', platform: 'test', arch: 'x64', nodeVersion: 'v20' },
        },
        'server:gateway_auth_result',
      )

      agentId = 'ownership-agent-1'
      gwA.send(
        JSON.stringify({
          type: 'gateway:register_agent',
          agent: { id: agentId, name: 'OwnerBot', type: 'generic' },
        }),
      )
      // Wait for agent registration
      await new Promise((r) => setTimeout(r, 300))
    })

    after(() => {
      gwA?.close()
    })

    it("rejects adding another user's private agent to room", async () => {
      // User B creates a room and tries to add User A's private agent
      const room = await api('POST', '/api/rooms', { name: 'B Room' }, userBToken)
      const roomId = room.data.data.id

      const res = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: agentId, memberType: 'agent' },
        userBToken,
      )
      assert.equal(res.status, 403)
      assert.ok(res.data.error.includes('not shared'))
    })

    it('allows owner to add their own agent to room', async () => {
      const room = await api('POST', '/api/rooms', { name: 'A Room' }, userAToken)
      const roomId = room.data.data.id

      const res = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: agentId, memberType: 'agent' },
        userAToken,
      )
      assert.equal(res.status, 201)
    })

    it('only owner can change agent visibility', async () => {
      // User B tries to change visibility of User A's agent
      const res = await api('PUT', `/api/agents/${agentId}`, { visibility: 'shared' }, userBToken)
      assert.equal(res.status, 403)
    })

    it('owner can set agent to shared', async () => {
      const res = await api('PUT', `/api/agents/${agentId}`, { visibility: 'shared' }, userAToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.visibility, 'shared')
    })

    it("allows adding shared agent to another user's room", async () => {
      // Agent is now shared, User B should be able to add it
      const room = await api('POST', '/api/rooms', { name: 'B Room Shared' }, userBToken)
      const roomId = room.data.data.id

      const res = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: agentId, memberType: 'agent' },
        userBToken,
      )
      assert.equal(res.status, 201)
    })

    it("GET /agents/shared only returns other users' shared agents", async () => {
      // User B should see User A's shared agent
      const res = await api('GET', '/api/agents/shared', undefined, userBToken)
      assert.equal(res.status, 200)
      const found = res.data.data.find((a: any) => a.id === agentId)
      assert.ok(found, 'Shared agent should be visible to other users')
      assert.ok(found.ownerName, 'Should include owner name')

      // User A should NOT see their own agent in shared list
      const resA = await api('GET', '/api/agents/shared', undefined, userAToken)
      assert.equal(resA.status, 200)
      const foundA = resA.data.data.find((a: any) => a.id === agentId)
      assert.ok(!foundA, 'Own shared agent should not appear in shared list')
    })

    it('returns 404 for non-existent agent when adding to room', async () => {
      const room = await api('POST', '/api/rooms', { name: 'Ghost Room' }, userAToken)
      const roomId = room.data.data.id

      const res = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'non-existent-agent', memberType: 'agent' },
        userAToken,
      )
      assert.equal(res.status, 404)
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
