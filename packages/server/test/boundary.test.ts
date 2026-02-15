import { describe, it, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import {
  startServer,
  stopServer,
  api,
  registerUser,
  connectWs,
  wsSendAndWait,
  wsWaitFor,
  WS_CLIENT_URL,
} from './helpers.js'

describe('Boundary Tests', () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    await stopServer()
  })

  const openSockets: WebSocket[] = []
  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) ws.close()
    }
    openSockets.length = 0
  })

  function track(ws: WebSocket): WebSocket {
    openSockets.push(ws)
    return ws
  }

  // ─── Message Edit / Delete Permissions ───

  describe('Message Edit & Delete Permissions', () => {
    let ownerToken: string
    let memberToken: string
    let memberId: string
    let roomId: string

    before(async () => {
      const owner = await registerUser('bedit_owner')
      ownerToken = owner.accessToken

      const member = await registerUser('bedit_member')
      memberToken = member.accessToken
      memberId = member.userId

      // Create room with both users
      const room = await api('POST', '/api/rooms', { name: 'Edit Room' }, ownerToken)
      roomId = room.data.data.id
      await api('POST', `/api/rooms/${roomId}/members`, {
        memberId, memberType: 'user',
      }, ownerToken)
    })

    it('sender can edit their own message', async () => {
      // Owner sends a message via WebSocket
      const ws = track(await connectWs(WS_CLIENT_URL))
      await wsSendAndWait(ws, { type: 'client:auth', token: ownerToken }, 'server:auth_result')
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 100))

      const msgResult = await wsSendAndWait(ws, {
        type: 'client:send_message', roomId, content: 'Original', mentions: [],
      }, 'server:new_message')
      const messageId = msgResult.message.id

      // Owner edits their own message
      const res = await api('PUT', `/api/messages/${messageId}`, { content: 'Edited' }, ownerToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.data.content, 'Edited')
    })

    it('non-sender cannot edit another user message', async () => {
      // Owner sends a message
      const ws = track(await connectWs(WS_CLIENT_URL))
      await wsSendAndWait(ws, { type: 'client:auth', token: ownerToken }, 'server:auth_result')
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 100))

      const msgResult = await wsSendAndWait(ws, {
        type: 'client:send_message', roomId, content: 'Private', mentions: [],
      }, 'server:new_message')
      const messageId = msgResult.message.id

      // Member tries to edit owner's message
      const res = await api('PUT', `/api/messages/${messageId}`, { content: 'Hacked' }, memberToken)
      assert.equal(res.status, 403)
    })

    it('non-sender cannot delete another user message', async () => {
      const ws = track(await connectWs(WS_CLIENT_URL))
      await wsSendAndWait(ws, { type: 'client:auth', token: ownerToken }, 'server:auth_result')
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 100))

      const msgResult = await wsSendAndWait(ws, {
        type: 'client:send_message', roomId, content: 'Keep this', mentions: [],
      }, 'server:new_message')
      const messageId = msgResult.message.id

      // Member tries to delete owner's message
      const res = await api('DELETE', `/api/messages/${messageId}`, undefined, memberToken)
      assert.equal(res.status, 403)
    })

    it('returns 404 for editing non-existent message', async () => {
      const res = await api('PUT', '/api/messages/nonexistent-id', { content: 'test' }, ownerToken)
      assert.equal(res.status, 404)
    })

    it('returns 404 for deleting non-existent message', async () => {
      const res = await api('DELETE', '/api/messages/nonexistent-id', undefined, ownerToken)
      assert.equal(res.status, 404)
    })

    it('edit history is preserved', async () => {
      const ws = track(await connectWs(WS_CLIENT_URL))
      await wsSendAndWait(ws, { type: 'client:auth', token: ownerToken }, 'server:auth_result')
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 100))

      const msgResult = await wsSendAndWait(ws, {
        type: 'client:send_message', roomId, content: 'Version 1', mentions: [],
      }, 'server:new_message')
      const messageId = msgResult.message.id

      // Edit the message
      await api('PUT', `/api/messages/${messageId}`, { content: 'Version 2' }, ownerToken)

      // Check edit history
      const history = await api('GET', `/api/messages/${messageId}/history`, undefined, ownerToken)
      assert.equal(history.status, 200)
      assert.equal(history.data.data.length, 1)
      assert.equal(history.data.data[0].previousContent, 'Version 1')
    })
  })

  // ─── Room Pin / Archive / Notification ───

  describe('Room Pin, Archive & Notification Prefs', () => {
    let token: string
    let roomId: string

    before(async () => {
      const user = await registerUser('bpin_user')
      token = user.accessToken

      const room = await api('POST', '/api/rooms', { name: 'Pin Room' }, token)
      roomId = room.data.data.id
    })

    it('toggles room pin on and off', async () => {
      // Pin
      const pin1 = await api('PUT', `/api/rooms/${roomId}/pin`, undefined, token)
      assert.equal(pin1.status, 200)
      assert.equal(pin1.data.data.pinned, true)

      // Unpin
      const pin2 = await api('PUT', `/api/rooms/${roomId}/pin`, undefined, token)
      assert.equal(pin2.status, 200)
      assert.equal(pin2.data.data.pinned, false)
    })

    it('toggles room archive on and off', async () => {
      // Archive
      const arch1 = await api('PUT', `/api/rooms/${roomId}/archive`, undefined, token)
      assert.equal(arch1.status, 200)
      assert.equal(arch1.data.data.archived, true)

      // Unarchive
      const arch2 = await api('PUT', `/api/rooms/${roomId}/archive`, undefined, token)
      assert.equal(arch2.status, 200)
      assert.equal(arch2.data.data.archived, false)
    })

    it('rejects invalid notification preference', async () => {
      const res = await api('PUT', `/api/rooms/${roomId}/notification-pref`, { pref: 'invalid' }, token)
      assert.equal(res.status, 400)
    })

    it('rejects empty notification preference', async () => {
      const res = await api('PUT', `/api/rooms/${roomId}/notification-pref`, {}, token)
      assert.equal(res.status, 400)
    })

    it('pin/archive returns 404 for non-member', async () => {
      const outsider = await registerUser('bpin_outsider')
      const res = await api('PUT', `/api/rooms/${roomId}/pin`, undefined, outsider.accessToken)
      assert.equal(res.status, 404)
    })
  })

  // ─── WebSocket Edge Cases ───

  describe('WebSocket Edge Cases', () => {
    it('invalid JSON returns error', async () => {
      const ws = track(await connectWs(WS_CLIENT_URL))

      const errorPromise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 3000)
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'server:error') {
            clearTimeout(timeout)
            resolve(msg)
          }
        })
      })

      ws.send('this is not json {{{')
      const result = await errorPromise
      assert.equal(result.code, 'INVALID_JSON')
    })

    it('invalid message format returns error', async () => {
      const ws = track(await connectWs(WS_CLIENT_URL))

      const errorPromise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 3000)
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'server:error') {
            clearTimeout(timeout)
            resolve(msg)
          }
        })
      })

      ws.send(JSON.stringify({ type: 'client:unknown_type', data: 123 }))
      const result = await errorPromise
      assert.equal(result.code, 'INVALID_MESSAGE')
    })

    it('ping without auth still works', async () => {
      const ws = track(await connectWs(WS_CLIENT_URL))
      const ts = Date.now()

      const result = await wsSendAndWait(
        ws,
        { type: 'client:ping', ts },
        'server:pong',
      )

      assert.equal(result.ts, ts)
    })
  })

  // ─── Validation Edge Cases ───

  describe('Validation Edge Cases', () => {
    it('rejects room creation with empty name', async () => {
      const user = await registerUser('bval_user')
      const res = await api('POST', '/api/rooms', { name: '' }, user.accessToken)
      assert.equal(res.status, 400)
    })

    it('rejects task creation with overly long title', async () => {
      const user = await registerUser('bval_task')
      const room = await api('POST', '/api/rooms', { name: 'Val Room' }, user.accessToken)
      const roomId = room.data.data.id

      const res = await api('POST', `/api/tasks/rooms/${roomId}`, {
        title: 'x'.repeat(201),
      }, user.accessToken)
      assert.equal(res.status, 400)
    })

    it('rejects registration with weak password', async () => {
      const adminLogin = await api('POST', '/api/auth/login', {
        username: 'admin', password: 'AdminPass123',
      })
      const adminToken = adminLogin.data.data.accessToken

      const res = await api('POST', '/api/users', {
        username: 'weakpw', password: 'weak',
      }, adminToken)
      assert.equal(res.status, 400)
    })

    it('rejects duplicate room member', async () => {
      const owner = await registerUser('bdup_owner')
      const member = await registerUser('bdup_member')
      const room = await api('POST', '/api/rooms', { name: 'Dup Room' }, owner.accessToken)
      const roomId = room.data.data.id

      // Add member
      await api('POST', `/api/rooms/${roomId}/members`, {
        memberId: member.userId, memberType: 'user',
      }, owner.accessToken)

      // Try to add again
      const res = await api('POST', `/api/rooms/${roomId}/members`, {
        memberId: member.userId, memberType: 'user',
      }, owner.accessToken)
      assert.equal(res.status, 409)
    })
  })
})
