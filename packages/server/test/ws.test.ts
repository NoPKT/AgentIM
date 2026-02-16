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
  WS_CLIENT_URL,
  WS_GATEWAY_URL,
} from './helpers.js'

describe('WebSocket Protocol', () => {
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

  // ─── Client WebSocket ───

  describe('Client WebSocket', () => {
    it('authenticates with valid token', async () => {
      const user = await registerUser('wsclient1')
      const ws = track(await connectWs(WS_CLIENT_URL))

      const result = await wsSendAndWait(
        ws,
        { type: 'client:auth', token: user.accessToken },
        'server:auth_result',
      )

      assert.equal(result.ok, true)
      assert.equal(result.userId, user.userId)
    })

    it('rejects invalid token', async () => {
      const ws = track(await connectWs(WS_CLIENT_URL))

      const result = await wsSendAndWait(
        ws,
        { type: 'client:auth', token: 'invalid-token' },
        'server:auth_result',
      )

      assert.equal(result.ok, false)
    })

    it('sends and receives messages in a room', async () => {
      const user = await registerUser('wsclient2')
      const room = await api('POST', '/api/rooms', { name: 'WS Room' }, user.accessToken)
      const roomId = room.data.data.id

      // Connect and auth
      const ws = track(await connectWs(WS_CLIENT_URL))
      await wsSendAndWait(
        ws,
        { type: 'client:auth', token: user.accessToken },
        'server:auth_result',
      )

      // Join room and wait for async processing
      ws.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 200))

      // Send message and wait for broadcast
      const result = await wsSendAndWait(
        ws,
        {
          type: 'client:send_message',
          roomId,
          content: 'Hello from test',
          mentions: [],
        },
        'server:new_message',
      )

      assert.equal(result.message.content, 'Hello from test')
      assert.equal(result.message.senderType, 'user')
      assert.equal(result.message.roomId, roomId)
    })

    it('broadcasts messages to multiple clients', async () => {
      const user1 = await registerUser('wsmulti1')
      const user2 = await registerUser('wsmulti2')
      const room = await api('POST', '/api/rooms', { name: 'Multi Room' }, user1.accessToken)
      const roomId = room.data.data.id

      // Add user2 to room
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: user2.userId, memberType: 'user' },
        user1.accessToken,
      )

      // Connect both clients
      const ws1 = track(await connectWs(WS_CLIENT_URL))
      const ws2 = track(await connectWs(WS_CLIENT_URL))

      await wsSendAndWait(
        ws1,
        { type: 'client:auth', token: user1.accessToken },
        'server:auth_result',
      )
      await wsSendAndWait(
        ws2,
        { type: 'client:auth', token: user2.accessToken },
        'server:auth_result',
      )

      ws1.send(JSON.stringify({ type: 'client:join_room', roomId }))
      ws2.send(JSON.stringify({ type: 'client:join_room', roomId }))

      // Small delay for join to process
      await new Promise((r) => setTimeout(r, 100))

      // User1 sends a message, user2 should receive it
      const receivedPromise = new Promise<any>((resolve) => {
        ws2.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'server:new_message') resolve(msg)
        })
      })

      ws1.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: 'Broadcast test',
          mentions: [],
        }),
      )

      const received = await receivedPromise
      assert.equal(received.message.content, 'Broadcast test')
      assert.equal(received.message.senderName, 'wsmulti1')
    })

    it('rejects oversized messages', async () => {
      const user = await registerUser('wsoversize')
      const ws = track(await connectWs(WS_CLIENT_URL))

      await wsSendAndWait(
        ws,
        { type: 'client:auth', token: user.accessToken },
        'server:auth_result',
      )

      // Send a message larger than 64KB
      const bigContent = 'x'.repeat(70000)
      const result = await wsSendAndWait(
        ws,
        {
          type: 'client:send_message',
          roomId: 'fake',
          content: bigContent,
          mentions: [],
        },
        'server:error',
      )

      assert.equal(result.code, 'MESSAGE_TOO_LARGE')
    })
  })

  // ─── Gateway WebSocket ───

  describe('Gateway WebSocket', () => {
    it('authenticates gateway', async () => {
      const user = await registerUser('gwuser1')
      const ws = track(await connectWs(WS_GATEWAY_URL))

      const result = await wsSendAndWait(
        ws,
        {
          type: 'gateway:auth',
          token: user.accessToken,
          gatewayId: 'test-gw-1',
          deviceInfo: {
            hostname: 'test',
            platform: 'test',
            arch: 'x64',
            nodeVersion: 'v20',
          },
        },
        'server:gateway_auth_result',
      )

      assert.equal(result.ok, true)
    })

    it('registers agent and routes messages', async () => {
      const user = await registerUser('gwuser2')

      // Setup gateway
      const gw = track(await connectWs(WS_GATEWAY_URL))
      await wsSendAndWait(
        gw,
        {
          type: 'gateway:auth',
          token: user.accessToken,
          gatewayId: 'test-gw-2',
          deviceInfo: { hostname: 'test', platform: 'test', arch: 'x64', nodeVersion: 'v20' },
        },
        'server:gateway_auth_result',
      )

      // Register agent
      const agentId = 'test-agent-1'
      gw.send(
        JSON.stringify({
          type: 'gateway:register_agent',
          agent: { id: agentId, name: 'TestBot', type: 'generic' },
        }),
      )
      await new Promise((r) => setTimeout(r, 200))

      // Verify agent appears in API
      const agentsRes = await api('GET', '/api/agents', undefined, user.accessToken)
      const agent = agentsRes.data.data.find((a: any) => a.id === agentId)
      assert.ok(agent)
      assert.equal(agent.name, 'TestBot')
      assert.equal(agent.status, 'online')

      // Create room and add agent
      const room = await api('POST', '/api/rooms', { name: 'Agent Room' }, user.accessToken)
      const roomId = room.data.data.id
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: agentId, memberType: 'agent' },
        user.accessToken,
      )

      // Setup client
      const client = track(await connectWs(WS_CLIENT_URL))
      await wsSendAndWait(
        client,
        { type: 'client:auth', token: user.accessToken },
        'server:auth_result',
      )
      client.send(JSON.stringify({ type: 'client:join_room', roomId }))
      await new Promise((r) => setTimeout(r, 100))

      // Gateway should receive message when client @mentions the agent
      const gwReceivePromise = new Promise<any>((resolve) => {
        gw.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'server:send_to_agent') resolve(msg)
        })
      })

      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: '@TestBot Hello agent',
          mentions: ['TestBot'],
        }),
      )

      const gwMsg = await gwReceivePromise
      assert.equal(gwMsg.agentId, agentId)
      assert.equal(gwMsg.content, '@TestBot Hello agent')

      // Gateway sends reply back
      const clientReplyPromise = new Promise<any>((resolve) => {
        client.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'server:message_complete' && msg.message?.senderType === 'agent') {
            resolve(msg)
          }
        })
      })

      // Send chunk
      gw.send(
        JSON.stringify({
          type: 'gateway:message_chunk',
          roomId,
          agentId,
          messageId: 'msg-1',
          chunk: { type: 'text', content: 'Hello human!' },
        }),
      )

      // Send complete
      gw.send(
        JSON.stringify({
          type: 'gateway:message_complete',
          roomId,
          agentId,
          messageId: 'msg-1',
          fullContent: 'Hello human!',
        }),
      )

      const reply = await clientReplyPromise
      assert.equal(reply.message.content, 'Hello human!')
      assert.equal(reply.message.senderType, 'agent')
      assert.equal(reply.message.senderName, 'TestBot')
    })

    it('handles agent status updates', async () => {
      const user = await registerUser('gwuser3')
      const gw = track(await connectWs(WS_GATEWAY_URL))

      await wsSendAndWait(
        gw,
        {
          type: 'gateway:auth',
          token: user.accessToken,
          gatewayId: 'test-gw-3',
          deviceInfo: { hostname: 'test', platform: 'test', arch: 'x64', nodeVersion: 'v20' },
        },
        'server:gateway_auth_result',
      )

      const agentId = 'test-agent-3'
      gw.send(
        JSON.stringify({
          type: 'gateway:register_agent',
          agent: { id: agentId, name: 'StatusBot', type: 'generic' },
        }),
      )
      await new Promise((r) => setTimeout(r, 200))

      // Update status to busy
      gw.send(JSON.stringify({ type: 'gateway:agent_status', agentId, status: 'busy' }))
      await new Promise((r) => setTimeout(r, 200))

      const agent = await api('GET', `/api/agents/${agentId}`, undefined, user.accessToken)
      assert.equal(agent.data.data.status, 'busy')

      // Update back to online
      gw.send(JSON.stringify({ type: 'gateway:agent_status', agentId, status: 'online' }))
      await new Promise((r) => setTimeout(r, 200))

      const agent2 = await api('GET', `/api/agents/${agentId}`, undefined, user.accessToken)
      assert.equal(agent2.data.data.status, 'online')
    })

    it('marks agents offline on disconnect', async () => {
      const user = await registerUser('gwuser4')
      const gw = await connectWs(WS_GATEWAY_URL)

      await wsSendAndWait(
        gw,
        {
          type: 'gateway:auth',
          token: user.accessToken,
          gatewayId: 'test-gw-4',
          deviceInfo: { hostname: 'test', platform: 'test', arch: 'x64', nodeVersion: 'v20' },
        },
        'server:gateway_auth_result',
      )

      const agentId = 'test-agent-4'
      gw.send(
        JSON.stringify({
          type: 'gateway:register_agent',
          agent: { id: agentId, name: 'DisconnectBot', type: 'generic' },
        }),
      )
      await new Promise((r) => setTimeout(r, 200))

      // Verify online
      let agent = await api('GET', `/api/agents/${agentId}`, undefined, user.accessToken)
      assert.equal(agent.data.data.status, 'online')

      // Disconnect gateway
      gw.close()
      await new Promise((r) => setTimeout(r, 500))

      // Verify offline
      agent = await api('GET', `/api/agents/${agentId}`, undefined, user.accessToken)
      assert.equal(agent.data.data.status, 'offline')
    })
  })
})
