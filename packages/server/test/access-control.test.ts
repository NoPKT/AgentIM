import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  startServer,
  stopServer,
  api,
  registerUser,
  connectWs,
  wsSendAndWait,
  WS_CLIENT_URL,
} from './helpers.js'

describe('Access Control', () => {
  before(async () => {
    await startServer()
  })

  after(async () => {
    await stopServer()
  })

  // ─── Room Access Control ───

  describe('Room Access Control', () => {
    let userA: { userId: string; accessToken: string }
    let userB: { userId: string; accessToken: string }
    let roomId: string

    before(async () => {
      userA = await registerUser('acl_userA')
      userB = await registerUser('acl_userB')

      // User A creates a room (auto-added as owner)
      const res = await api('POST', '/api/rooms', { name: 'ACL Room' }, userA.accessToken)
      assert.equal(res.status, 201)
      roomId = res.data.data.id
    })

    it('non-member cannot GET /api/rooms/:id', async () => {
      const res = await api('GET', `/api/rooms/${roomId}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('non-member cannot GET /api/rooms/:id/members', async () => {
      const res = await api('GET', `/api/rooms/${roomId}/members`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('non-member cannot PUT /api/rooms/:id', async () => {
      const res = await api('PUT', `/api/rooms/${roomId}`, { name: 'Hacked' }, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('non-member cannot POST /api/rooms/:id/members', async () => {
      const res = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: userB.userId, memberType: 'user' },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('non-member cannot DELETE /api/rooms/:id/members/:memberId', async () => {
      const res = await api(
        'DELETE',
        `/api/rooms/${roomId}/members/${userA.userId}`,
        undefined,
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('member can GET /api/rooms/:id', async () => {
      const res = await api('GET', `/api/rooms/${roomId}`, undefined, userA.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.name, 'ACL Room')
    })

    it('member can GET /api/rooms/:id/members', async () => {
      const res = await api('GET', `/api/rooms/${roomId}/members`, undefined, userA.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.data.length >= 1)
    })

    it('GET /api/rooms/:id returns totalMembers count', async () => {
      const res = await api('GET', `/api/rooms/${roomId}`, undefined, userA.accessToken)
      assert.equal(res.status, 200)
      assert.equal(typeof res.data.data.totalMembers, 'number')
      assert.ok(res.data.data.totalMembers >= 1)
    })

    it('member can PUT /api/rooms/:id', async () => {
      const res = await api(
        'PUT',
        `/api/rooms/${roomId}`,
        { name: 'ACL Room Updated' },
        userA.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.name, 'ACL Room Updated')
    })

    it('member can POST /api/rooms/:id/members', async () => {
      const userC = await registerUser('acl_userC')
      const res = await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: userC.userId, memberType: 'user' },
        userA.accessToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)
    })

    it('member can DELETE /api/rooms/:id/members/:memberId', async () => {
      // Find the non-owner member added in the previous test
      const members = await api('GET', `/api/rooms/${roomId}/members`, undefined, userA.accessToken)
      const nonOwner = members.data.data.find((m: any) => m.role !== 'owner')
      assert.ok(nonOwner, 'Expected a non-owner member to exist')

      const res = await api(
        'DELETE',
        `/api/rooms/${roomId}/members/${nonOwner.memberId}`,
        undefined,
        userA.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })
  })

  // ─── Message Access Control ───

  describe('Message Access Control', () => {
    let userA: { userId: string; accessToken: string }
    let userB: { userId: string; accessToken: string }
    let roomId: string
    let messageId: string

    before(async () => {
      userA = await registerUser('acl_msg_userA')
      userB = await registerUser('acl_msg_userB')

      const res = await api('POST', '/api/rooms', { name: 'ACL Message Room' }, userA.accessToken)
      assert.equal(res.status, 201)
      roomId = res.data.data.id

      // User A sends a message via WebSocket (messages are sent over WS, not REST)
      const ws = await connectWs(WS_CLIENT_URL)
      ws.send(JSON.stringify({ type: 'client:auth', token: userA.accessToken }))
      await new Promise((r) => setTimeout(r, 200))
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 200))

      const msgResult = await wsSendAndWait(
        ws,
        {
          type: 'client:send_message',
          roomId,
          content: 'test message for ACL',
          mentions: [],
        },
        'server:new_message',
      )
      messageId = msgResult.message.id
      ws.close()
    })

    it('non-member cannot GET /api/messages/rooms/:roomId', async () => {
      const res = await api('GET', `/api/messages/rooms/${roomId}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('member can GET /api/messages/rooms/:roomId', async () => {
      const res = await api('GET', `/api/messages/rooms/${roomId}`, undefined, userA.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.data.items)
    })

    it('non-member cannot GET /api/messages/:messageId/thread', async () => {
      const res = await api(
        'GET',
        `/api/messages/${messageId}/thread`,
        undefined,
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('member can GET /api/messages/:messageId/thread', async () => {
      const res = await api(
        'GET',
        `/api/messages/${messageId}/thread`,
        undefined,
        userA.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('non-member cannot GET /api/messages/:messageId/replies/count', async () => {
      const res = await api(
        'GET',
        `/api/messages/${messageId}/replies/count`,
        undefined,
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('member can GET /api/messages/:messageId/replies/count', async () => {
      const res = await api(
        'GET',
        `/api/messages/${messageId}/replies/count`,
        undefined,
        userA.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.count, 0)
    })

    it('non-member cannot GET /api/messages/:id/history', async () => {
      const res = await api(
        'GET',
        `/api/messages/${messageId}/history`,
        undefined,
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('member can GET /api/messages/:id/history', async () => {
      const res = await api(
        'GET',
        `/api/messages/${messageId}/history`,
        undefined,
        userA.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('non-member cannot POST /api/messages/:id/reactions', async () => {
      const res = await api(
        'POST',
        `/api/messages/${messageId}/reactions`,
        { emoji: '👍' },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('member can POST /api/messages/:id/reactions', async () => {
      const res = await api(
        'POST',
        `/api/messages/${messageId}/reactions`,
        { emoji: '👍' },
        userA.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('non-member cannot PUT /api/messages/:id (edit)', async () => {
      const res = await api(
        'PUT',
        `/api/messages/${messageId}`,
        { content: 'hacked content' },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('member can PUT /api/messages/:id (edit own message)', async () => {
      const res = await api(
        'PUT',
        `/api/messages/${messageId}`,
        { content: 'edited content' },
        userA.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.content, 'edited content')
    })

    it('non-member cannot POST /api/messages/:id/forward', async () => {
      // User B creates their own room as forward target
      const roomRes = await api(
        'POST',
        '/api/rooms',
        { name: 'B Forward Target' },
        userB.accessToken,
      )
      const targetRoomId = roomRes.data.data.id

      const res = await api(
        'POST',
        `/api/messages/${messageId}/forward`,
        { targetRoomId },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('non-member cannot DELETE /api/messages/:id', async () => {
      const res = await api('DELETE', `/api/messages/${messageId}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('member can search messages in their rooms', async () => {
      const res = await api('GET', `/api/messages/search?q=edited`, undefined, userA.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('search does not return messages from rooms user is not a member of', async () => {
      const res = await api(
        'GET',
        `/api/messages/search?q=edited&roomId=${roomId}`,
        undefined,
        userB.accessToken,
      )
      // Non-member searching in a specific room they don't belong to
      assert.equal(res.status, 404)
    })
  })

  // ─── Task Access Control ───

  describe('Task Access Control', () => {
    let userA: { userId: string; accessToken: string }
    let userB: { userId: string; accessToken: string }
    let roomId: string
    let taskId: string

    before(async () => {
      userA = await registerUser('acl_task_userA')
      userB = await registerUser('acl_task_userB')

      const res = await api('POST', '/api/rooms', { name: 'ACL Task Room' }, userA.accessToken)
      assert.equal(res.status, 201)
      roomId = res.data.data.id

      // User A creates a task in the room
      const taskRes = await api(
        'POST',
        `/api/tasks/rooms/${roomId}`,
        { title: 'ACL Task', description: 'Test task for access control' },
        userA.accessToken,
      )
      assert.equal(taskRes.status, 201)
      taskId = taskRes.data.data.id
    })

    it('non-member cannot GET /api/tasks/rooms/:roomId', async () => {
      const res = await api('GET', `/api/tasks/rooms/${roomId}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('non-member cannot POST /api/tasks/rooms/:roomId', async () => {
      const res = await api(
        'POST',
        `/api/tasks/rooms/${roomId}`,
        { title: 'Unauthorized Task' },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('non-member cannot PUT /api/tasks/:taskId', async () => {
      const res = await api(
        'PUT',
        `/api/tasks/${taskId}`,
        { status: 'in_progress' },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('non-member cannot DELETE /api/tasks/:taskId', async () => {
      const res = await api('DELETE', `/api/tasks/${taskId}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('member can GET /api/tasks/rooms/:roomId', async () => {
      const res = await api('GET', `/api/tasks/rooms/${roomId}`, undefined, userA.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.data.length >= 1)
    })

    it('member can POST /api/tasks/rooms/:roomId', async () => {
      const res = await api(
        'POST',
        `/api/tasks/rooms/${roomId}`,
        { title: 'Another Task', description: 'Created by member' },
        userA.accessToken,
      )
      assert.equal(res.status, 201)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.title, 'Another Task')
    })

    it('member can PUT /api/tasks/:taskId', async () => {
      const res = await api(
        'PUT',
        `/api/tasks/${taskId}`,
        { status: 'in_progress' },
        userA.accessToken,
      )
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.status, 'in_progress')
    })

    it('member can DELETE /api/tasks/:taskId', async () => {
      // Create a disposable task so we don't break other tests
      const createRes = await api(
        'POST',
        `/api/tasks/rooms/${roomId}`,
        { title: 'To Delete' },
        userA.accessToken,
      )
      const disposableId = createRes.data.data.id

      const res = await api('DELETE', `/api/tasks/${disposableId}`, undefined, userA.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })
  })

  // ─── Cross-Room Isolation ───

  describe('Cross-room isolation', () => {
    let userA: { userId: string; accessToken: string }
    let userB: { userId: string; accessToken: string }
    let room1Id: string
    let room2Id: string
    let task1Id: string
    let task2Id: string

    before(async () => {
      userA = await registerUser('acl_iso_userA')
      userB = await registerUser('acl_iso_userB')

      // User A creates room1
      const room1Res = await api(
        'POST',
        '/api/rooms',
        { name: 'Isolation Room 1' },
        userA.accessToken,
      )
      assert.equal(room1Res.status, 201)
      room1Id = room1Res.data.data.id

      // User B creates room2
      const room2Res = await api(
        'POST',
        '/api/rooms',
        { name: 'Isolation Room 2' },
        userB.accessToken,
      )
      assert.equal(room2Res.status, 201)
      room2Id = room2Res.data.data.id

      // User A creates a task in room1
      const task1Res = await api(
        'POST',
        `/api/tasks/rooms/${room1Id}`,
        { title: 'Task in Room 1' },
        userA.accessToken,
      )
      assert.equal(task1Res.status, 201)
      task1Id = task1Res.data.data.id

      // User B creates a task in room2
      const task2Res = await api(
        'POST',
        `/api/tasks/rooms/${room2Id}`,
        { title: 'Task in Room 2' },
        userB.accessToken,
      )
      assert.equal(task2Res.status, 201)
      task2Id = task2Res.data.data.id
    })

    // ─── User A cannot access room2 ───

    it('User A cannot GET room2 details', async () => {
      const res = await api('GET', `/api/rooms/${room2Id}`, undefined, userA.accessToken)
      assert.equal(res.status, 403)
    })

    it('User A cannot GET room2 members', async () => {
      const res = await api('GET', `/api/rooms/${room2Id}/members`, undefined, userA.accessToken)
      assert.equal(res.status, 403)
    })

    it('User A cannot PUT room2', async () => {
      const res = await api('PUT', `/api/rooms/${room2Id}`, { name: 'Hijacked' }, userA.accessToken)
      assert.equal(res.status, 403)
    })

    it('User A cannot GET room2 messages', async () => {
      const res = await api('GET', `/api/messages/rooms/${room2Id}`, undefined, userA.accessToken)
      assert.equal(res.status, 403)
    })

    it('User A cannot GET room2 tasks', async () => {
      const res = await api('GET', `/api/tasks/rooms/${room2Id}`, undefined, userA.accessToken)
      assert.equal(res.status, 403)
    })

    it('User A cannot POST tasks to room2', async () => {
      const res = await api(
        'POST',
        `/api/tasks/rooms/${room2Id}`,
        { title: 'Sneaky Task' },
        userA.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('User A cannot PUT task in room2', async () => {
      const res = await api(
        'PUT',
        `/api/tasks/${task2Id}`,
        { status: 'in_progress' },
        userA.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('User A cannot DELETE task in room2', async () => {
      const res = await api('DELETE', `/api/tasks/${task2Id}`, undefined, userA.accessToken)
      assert.equal(res.status, 403)
    })

    it('User A cannot add members to room2', async () => {
      const res = await api(
        'POST',
        `/api/rooms/${room2Id}/members`,
        { memberId: userA.userId, memberType: 'user' },
        userA.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('User A cannot remove members from room2', async () => {
      const res = await api(
        'DELETE',
        `/api/rooms/${room2Id}/members/${userB.userId}`,
        undefined,
        userA.accessToken,
      )
      assert.equal(res.status, 403)
    })

    // ─── User B cannot access room1 ───

    it('User B cannot GET room1 details', async () => {
      const res = await api('GET', `/api/rooms/${room1Id}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('User B cannot GET room1 members', async () => {
      const res = await api('GET', `/api/rooms/${room1Id}/members`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('User B cannot PUT room1', async () => {
      const res = await api('PUT', `/api/rooms/${room1Id}`, { name: 'Hijacked' }, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('User B cannot GET room1 messages', async () => {
      const res = await api('GET', `/api/messages/rooms/${room1Id}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('User B cannot GET room1 tasks', async () => {
      const res = await api('GET', `/api/tasks/rooms/${room1Id}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('User B cannot POST tasks to room1', async () => {
      const res = await api(
        'POST',
        `/api/tasks/rooms/${room1Id}`,
        { title: 'Sneaky Task' },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('User B cannot PUT task in room1', async () => {
      const res = await api(
        'PUT',
        `/api/tasks/${task1Id}`,
        { status: 'in_progress' },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('User B cannot DELETE task in room1', async () => {
      const res = await api('DELETE', `/api/tasks/${task1Id}`, undefined, userB.accessToken)
      assert.equal(res.status, 403)
    })

    it('User B cannot add members to room1', async () => {
      const res = await api(
        'POST',
        `/api/rooms/${room1Id}/members`,
        { memberId: userB.userId, memberType: 'user' },
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    it('User B cannot remove members from room1', async () => {
      const res = await api(
        'DELETE',
        `/api/rooms/${room1Id}/members/${userA.userId}`,
        undefined,
        userB.accessToken,
      )
      assert.equal(res.status, 403)
    })

    // ─── Each user CAN access their own room ───

    it('User A can access room1 details', async () => {
      const res = await api('GET', `/api/rooms/${room1Id}`, undefined, userA.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('User B can access room2 details', async () => {
      const res = await api('GET', `/api/rooms/${room2Id}`, undefined, userB.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('User A room list only contains their rooms', async () => {
      const res = await api('GET', '/api/rooms', undefined, userA.accessToken)
      assert.equal(res.status, 200)
      const roomIds = res.data.data.map((r: any) => r.id)
      assert.ok(roomIds.includes(room1Id), 'User A should see room1')
      assert.ok(!roomIds.includes(room2Id), 'User A should NOT see room2')
    })

    it('User B room list only contains their rooms', async () => {
      const res = await api('GET', '/api/rooms', undefined, userB.accessToken)
      assert.equal(res.status, 200)
      const roomIds = res.data.data.map((r: any) => r.id)
      assert.ok(roomIds.includes(room2Id), 'User B should see room2')
      assert.ok(!roomIds.includes(room1Id), 'User B should NOT see room1')
    })
  })
})
