import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  startServer,
  stopServer,
  api,
  registerUser,
  connectWs,
  wsSendAndWait,
  wsWaitFor,
  BASE_URL,
  WS_CLIENT_URL,
  WS_GATEWAY_URL,
} from './helpers.js'

describe('Endpoint Coverage', () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    await stopServer()
  })

  // ─── Mark all read ───

  describe('POST /api/messages/mark-all-read', () => {
    it('marks all rooms as read', async () => {
      const user = await registerUser('markall_user')
      const room = await api('POST', '/api/rooms', { name: 'MarkAll Room' }, user.accessToken)
      const roomId = room.data.data.id

      const res = await api('POST', '/api/messages/mark-all-read', undefined, user.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('rejects unauthenticated requests', async () => {
      const res = await api('POST', '/api/messages/mark-all-read')
      assert.equal(res.status, 401)
    })
  })

  // ─── Search ───

  describe('GET /api/messages/search', () => {
    let token: string
    let roomId: string

    before(async () => {
      const user = await registerUser('search_user')
      token = user.accessToken

      const room = await api('POST', '/api/rooms', { name: 'Search Room' }, token)
      roomId = room.data.data.id

      const ws = await connectWs(WS_CLIENT_URL)
      await wsSendAndWait(ws, { type: 'client:auth', token }, 'server:auth_result')
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 200))

      ws.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: 'Searchable unicorn message',
          mentions: [],
        }),
      )
      await wsWaitFor(ws, 'server:new_message')
      ws.close()
      await new Promise((r) => setTimeout(r, 200))
    })

    it('searches messages by keyword', async () => {
      const res = await api('GET', '/api/messages/search?q=unicorn', undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(Array.isArray(res.data.data))
    })

    it('rejects query shorter than 2 chars', async () => {
      const res = await api('GET', '/api/messages/search?q=a', undefined, token)
      assert.equal(res.status, 400)
    })

    it('rejects missing query', async () => {
      const res = await api('GET', '/api/messages/search', undefined, token)
      assert.equal(res.status, 400)
    })

    it('rejects unauthenticated requests', async () => {
      const res = await api('GET', '/api/messages/search?q=test')
      assert.equal(res.status, 401)
    })
  })

  // ─── Reactions ───

  describe('POST /api/messages/:id/reactions', () => {
    let token: string
    let roomId: string
    let messageId: string

    before(async () => {
      const user = await registerUser('reaction_user')
      token = user.accessToken

      const room = await api('POST', '/api/rooms', { name: 'Reaction Room' }, token)
      roomId = room.data.data.id

      const ws = await connectWs(WS_CLIENT_URL)
      await wsSendAndWait(ws, { type: 'client:auth', token }, 'server:auth_result')
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 200))

      ws.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: 'React to this',
          mentions: [],
        }),
      )
      const msg = await wsWaitFor(ws, 'server:new_message')
      messageId = msg.message.id
      ws.close()
    })

    it('adds a reaction', async () => {
      const res = await api('POST', `/api/messages/${messageId}/reactions`, { emoji: '👍' }, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('toggles reaction off', async () => {
      const res = await api('POST', `/api/messages/${messageId}/reactions`, { emoji: '👍' }, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('returns 404 for non-existent message', async () => {
      const res = await api('POST', '/api/messages/nonexistent/reactions', { emoji: '👍' }, token)
      assert.equal(res.status, 404)
    })

    it('rejects unauthenticated requests', async () => {
      const res = await api('POST', `/api/messages/${messageId}/reactions`, { emoji: '👍' })
      assert.equal(res.status, 401)
    })
  })

  // ─── Edit history ───

  describe('GET /api/messages/:id/history', () => {
    let token: string
    let roomId: string
    let messageId: string

    before(async () => {
      const user = await registerUser('history_user')
      token = user.accessToken

      const room = await api('POST', '/api/rooms', { name: 'History Room' }, token)
      roomId = room.data.data.id

      const ws = await connectWs(WS_CLIENT_URL)
      await wsSendAndWait(ws, { type: 'client:auth', token }, 'server:auth_result')
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 200))

      ws.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: 'Original content',
          mentions: [],
        }),
      )
      const msg = await wsWaitFor(ws, 'server:new_message')
      messageId = msg.message.id
      ws.close()

      await api('PUT', `/api/messages/${messageId}`, { content: 'First edit' }, token)
      await new Promise((r) => setTimeout(r, 100))
      await api('PUT', `/api/messages/${messageId}`, { content: 'Second edit' }, token)
      await new Promise((r) => setTimeout(r, 100))
    })

    it('returns edit history', async () => {
      const res = await api('GET', `/api/messages/${messageId}/history`, undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(Array.isArray(res.data.data))
      assert.ok(res.data.data.length >= 2)
    })

    it('returns 404 for non-existent message', async () => {
      const res = await api('GET', '/api/messages/nonexistent/history', undefined, token)
      assert.equal(res.status, 404)
    })

    it('rejects unauthenticated requests', async () => {
      const res = await api('GET', `/api/messages/${messageId}/history`)
      assert.equal(res.status, 401)
    })
  })

  // ─── Agents: shared ───

  describe('GET /api/agents/shared', () => {
    it('returns shared agents list', async () => {
      const user = await registerUser('shared_user')
      const res = await api('GET', '/api/agents/shared', undefined, user.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(Array.isArray(res.data.data))
    })

    it('rejects unauthenticated requests', async () => {
      const res = await api('GET', '/api/agents/shared')
      assert.equal(res.status, 401)
    })
  })

  // ─── Agents: get by id ───

  describe('GET /api/agents/:id', () => {
    let token: string
    let agentId: string
    let gw: import('ws').default

    before(async () => {
      const user = await registerUser('getagent_user')
      token = user.accessToken

      gw = await connectWs(WS_GATEWAY_URL)
      await wsSendAndWait(
        gw,
        {
          type: 'gateway:auth',
          token,
          gatewayId: 'getagent-gw',
          deviceInfo: { hostname: 'test', platform: 'test', arch: 'x64', nodeVersion: 'v20' },
        },
        'server:gateway_auth_result',
      )

      agentId = 'getagent-agent-1'
      gw.send(
        JSON.stringify({
          type: 'gateway:register_agent',
          agent: { id: agentId, name: 'GetBot', type: 'generic' },
        }),
      )
      await new Promise((r) => setTimeout(r, 300))
    })

    after(() => {
      gw?.close()
    })

    it('returns agent by id', async () => {
      const res = await api('GET', `/api/agents/${agentId}`, undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.id, agentId)
    })

    it('returns 404 for non-existent agent', async () => {
      const res = await api('GET', '/api/agents/nonexistent', undefined, token)
      assert.equal(res.status, 404)
    })
  })

  // ─── Agents: gateways ───

  describe('GET /api/agents/gateways/list', () => {
    let token: string
    let gw: import('ws').default

    before(async () => {
      const user = await registerUser('gwlist_user')
      token = user.accessToken

      gw = await connectWs(WS_GATEWAY_URL)
      await wsSendAndWait(
        gw,
        {
          type: 'gateway:auth',
          token,
          gatewayId: 'gwlist-gw-1',
          deviceInfo: { hostname: 'testhost', platform: 'linux', arch: 'x64', nodeVersion: 'v20' },
        },
        'server:gateway_auth_result',
      )
      await new Promise((r) => setTimeout(r, 200))
    })

    after(() => {
      gw?.close()
    })

    it('lists gateways for current user', async () => {
      const res = await api('GET', '/api/agents/gateways/list', undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(Array.isArray(res.data.data))
      assert.ok(res.data.data.length >= 1)
    })

    it('returns empty for user with no gateways', async () => {
      const user2 = await registerUser('gwlist_empty')
      const res = await api('GET', '/api/agents/gateways/list', undefined, user2.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.length, 0)
    })
  })

  // ─── Agents: list with pagination ───

  describe('GET /api/agents (pagination)', () => {
    let token: string
    let gw: import('ws').default

    before(async () => {
      const user = await registerUser('listag_user')
      token = user.accessToken

      gw = await connectWs(WS_GATEWAY_URL)
      await wsSendAndWait(
        gw,
        {
          type: 'gateway:auth',
          token,
          gatewayId: 'listag-gw',
          deviceInfo: { hostname: 'test', platform: 'test', arch: 'x64', nodeVersion: 'v20' },
        },
        'server:gateway_auth_result',
      )

      for (let i = 0; i < 3; i++) {
        gw.send(
          JSON.stringify({
            type: 'gateway:register_agent',
            agent: { id: `listag-agent-${i}`, name: `Agent${i}`, type: 'generic' },
          }),
        )
      }
      await new Promise((r) => setTimeout(r, 300))
    })

    after(() => {
      gw?.close()
    })

    it('supports limit and offset', async () => {
      const res = await api('GET', '/api/agents?limit=2&offset=0', undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.length, 2)
    })
  })

  // ─── Tasks: pagination ───

  describe('Tasks pagination', () => {
    let token: string
    let roomId: string

    before(async () => {
      const user = await registerUser('taskpag_user')
      token = user.accessToken

      const room = await api('POST', '/api/rooms', { name: 'TaskPag Room' }, token)
      roomId = room.data.data.id

      for (let i = 0; i < 3; i++) {
        await api(
          'POST',
          `/api/tasks/rooms/${roomId}`,
          {
            title: `Task ${i}`,
            description: `Desc ${i}`,
          },
          token,
        )
      }
    })

    it('supports limit in room tasks', async () => {
      const res = await api('GET', `/api/tasks/rooms/${roomId}?limit=2`, undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.length, 2)
    })

    it('supports limit in global tasks', async () => {
      const res = await api('GET', '/api/tasks?limit=2', undefined, token)
      assert.equal(res.status, 200)
      assert.ok(res.data.data.length <= 2)
    })
  })

  // ─── Room preferences ───

  describe('Room member preferences', () => {
    let token: string
    let roomId: string

    before(async () => {
      const user = await registerUser('prefs_user')
      token = user.accessToken

      const room = await api('POST', '/api/rooms', { name: 'Prefs Room' }, token)
      roomId = room.data.data.id
    })

    it('toggles pin', async () => {
      const res = await api('PUT', `/api/rooms/${roomId}/pin`, undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.pinned, true)

      const res2 = await api('PUT', `/api/rooms/${roomId}/pin`, undefined, token)
      assert.equal(res2.data.data.pinned, false)
    })

    it('toggles archive', async () => {
      const res = await api('PUT', `/api/rooms/${roomId}/archive`, undefined, token)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.archived, true)

      const res2 = await api('PUT', `/api/rooms/${roomId}/archive`, undefined, token)
      assert.equal(res2.data.data.archived, false)
    })

    it('updates notification preference', async () => {
      const res = await api(
        'PUT',
        `/api/rooms/${roomId}/notification-pref`,
        { pref: 'mentions' },
        token,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('rejects invalid notification preference', async () => {
      const res = await api(
        'PUT',
        `/api/rooms/${roomId}/notification-pref`,
        { pref: 'invalid' },
        token,
      )
      assert.equal(res.status, 400)
    })
  })

  // ─── Messages: recent ───

  describe('GET /api/messages/recent', () => {
    it('returns recent messages', async () => {
      const user = await registerUser('recent_user')
      const res = await api('GET', '/api/messages/recent', undefined, user.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('rejects unauthenticated requests', async () => {
      const res = await api('GET', '/api/messages/recent')
      assert.equal(res.status, 401)
    })
  })
})
