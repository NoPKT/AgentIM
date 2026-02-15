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
  wsCollect,
  WS_CLIENT_URL,
  WS_GATEWAY_URL,
} from './helpers.js'

describe('Message Routing', () => {
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

  /** Setup a gateway with an authenticated agent */
  async function setupGatewayAgent(
    user: { accessToken: string },
    gatewayId: string,
    agentId: string,
    agentName: string,
    opts?: { capabilities?: string[] },
  ) {
    const gw = track(await connectWs(WS_GATEWAY_URL))
    await wsSendAndWait(
      gw,
      {
        type: 'gateway:auth',
        token: user.accessToken,
        gatewayId,
        deviceInfo: { hostname: 'test', platform: 'test', arch: 'x64', nodeVersion: 'v20' },
      },
      'server:gateway_auth_result',
    )

    gw.send(
      JSON.stringify({
        type: 'gateway:register_agent',
        agent: {
          id: agentId,
          name: agentName,
          type: 'generic',
          ...(opts?.capabilities ? { capabilities: opts.capabilities } : {}),
        },
      }),
    )
    await new Promise((r) => setTimeout(r, 300))
    return gw
  }

  /** Setup an authenticated client joined to a room */
  async function setupClient(user: { accessToken: string }, roomId: string) {
    const client = track(await connectWs(WS_CLIENT_URL))
    await wsSendAndWait(
      client,
      { type: 'client:auth', token: user.accessToken },
      'server:auth_result',
    )
    client.send(JSON.stringify({ type: 'client:join_room', roomId }))
    await new Promise((r) => setTimeout(r, 100))
    return client
  }

  // ─── Three-Mode Routing ───

  describe('Three-Mode Routing', () => {
    it('broadcast mode: all agents receive with routingMode=broadcast when no @mention', async () => {
      const user = await registerUser('route_bc1')

      // Create broadcast room
      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Broadcast Room', broadcastMode: true },
        user.accessToken,
      )
      const roomId = room.data.data.id

      // Setup two agents
      const gw1 = await setupGatewayAgent(user, 'rt-gw-bc1', 'rt-agent-bc1', 'AgentA')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-bc2', 'rt-agent-bc2', 'AgentB')

      // Add both to room
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-bc1', memberType: 'agent' }, user.accessToken)
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-bc2', memberType: 'agent' }, user.accessToken)

      // Setup client
      const client = await setupClient(user, roomId)

      // Collect messages from both gateways
      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)
      const collect2 = wsCollect(gw2, 'server:send_to_agent', 1500)

      // Send message without @mention
      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: 'Hello everyone',
          mentions: [],
        }),
      )

      const [msgs1, msgs2] = await Promise.all([collect1, collect2])

      // Both agents should receive
      assert.equal(msgs1.length, 1)
      assert.equal(msgs2.length, 1)
      assert.equal(msgs1[0].routingMode, 'broadcast')
      assert.equal(msgs1[0].isMentioned, false)
      assert.equal(msgs1[0].senderType, 'user')
      assert.equal(msgs2[0].routingMode, 'broadcast')
    })

    it('mention_assign mode: all agents receive, only mentioned has isMentioned=true', async () => {
      const user = await registerUser('route_ma1')

      // Create broadcast room
      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'MentionAssign Room', broadcastMode: true },
        user.accessToken,
      )
      const roomId = room.data.data.id

      // Setup two agents
      const gw1 = await setupGatewayAgent(user, 'rt-gw-ma1', 'rt-agent-ma1', 'AlphaBot')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-ma2', 'rt-agent-ma2', 'BetaBot')

      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-ma1', memberType: 'agent' }, user.accessToken)
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-ma2', memberType: 'agent' }, user.accessToken)

      const client = await setupClient(user, roomId)

      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)
      const collect2 = wsCollect(gw2, 'server:send_to_agent', 1500)

      // Send message with @AlphaBot mention
      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: '@AlphaBot do something',
          mentions: ['AlphaBot'],
        }),
      )

      const [msgs1, msgs2] = await Promise.all([collect1, collect2])

      // Both agents should receive (broadcast room)
      assert.equal(msgs1.length, 1)
      assert.equal(msgs2.length, 1)

      // AlphaBot is mentioned
      assert.equal(msgs1[0].routingMode, 'mention_assign')
      assert.equal(msgs1[0].isMentioned, true)
      assert.equal(msgs1[0].agentId, 'rt-agent-ma1')

      // BetaBot is NOT mentioned
      assert.equal(msgs2[0].routingMode, 'mention_assign')
      assert.equal(msgs2[0].isMentioned, false)
      assert.equal(msgs2[0].agentId, 'rt-agent-ma2')
    })

    it('direct mode: only mentioned agent receives in non-broadcast room', async () => {
      const user = await registerUser('route_dir1')

      // Create non-broadcast room
      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Direct Room', broadcastMode: false },
        user.accessToken,
      )
      const roomId = room.data.data.id

      // Setup two agents
      const gw1 = await setupGatewayAgent(user, 'rt-gw-dir1', 'rt-agent-dir1', 'DirAgentA')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-dir2', 'rt-agent-dir2', 'DirAgentB')

      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-dir1', memberType: 'agent' }, user.accessToken)
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-dir2', memberType: 'agent' }, user.accessToken)

      const client = await setupClient(user, roomId)

      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)
      const collect2 = wsCollect(gw2, 'server:send_to_agent', 1500)

      // Send message with @DirAgentA mention only
      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: '@DirAgentA fix the bug',
          mentions: ['DirAgentA'],
        }),
      )

      const [msgs1, msgs2] = await Promise.all([collect1, collect2])

      // Only DirAgentA should receive
      assert.equal(msgs1.length, 1)
      assert.equal(msgs1[0].routingMode, 'direct')
      assert.equal(msgs1[0].isMentioned, true)

      // DirAgentB should NOT receive
      assert.equal(msgs2.length, 0)
    })

    it('no routing: non-broadcast room without mentions sends to no agents', async () => {
      const user = await registerUser('route_none1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'NoRoute Room', broadcastMode: false },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-none1', 'rt-agent-none1', 'SilentAgent')
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-none1', memberType: 'agent' }, user.accessToken)

      const client = await setupClient(user, roomId)
      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)

      // Send without mention in non-broadcast room
      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: 'Hello no one',
          mentions: [],
        }),
      )

      const msgs = await collect1
      assert.equal(msgs.length, 0)
    })
  })

  // ─── Agent-to-Agent Routing ───

  describe('Agent-to-Agent Routing', () => {
    it('agent mentioning another agent triggers direct routing', async () => {
      const user = await registerUser('route_a2a1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'A2A Room', broadcastMode: false },
        user.accessToken,
      )
      const roomId = room.data.data.id

      // Setup two agents on separate gateways
      const gw1 = await setupGatewayAgent(user, 'rt-gw-a2a1', 'rt-agent-a2a1', 'SenderBot')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-a2a2', 'rt-agent-a2a2', 'ReceiverBot')

      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-a2a1', memberType: 'agent' }, user.accessToken)
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-a2a2', memberType: 'agent' }, user.accessToken)

      // Setup client to receive the message_complete broadcast
      const client = await setupClient(user, roomId)

      // Start collecting on gw2 BEFORE sending the complete
      const collectReceiver = wsCollect(gw2, 'server:send_to_agent', 2000)

      // SenderBot completes a message that mentions @ReceiverBot
      gw1.send(
        JSON.stringify({
          type: 'gateway:message_complete',
          roomId,
          agentId: 'rt-agent-a2a1',
          messageId: 'a2a-msg-1',
          fullContent: 'I need @ReceiverBot to help with this',
        }),
      )

      const msgs = await collectReceiver

      // ReceiverBot should receive a direct message from SenderBot
      assert.equal(msgs.length, 1)
      assert.equal(msgs[0].agentId, 'rt-agent-a2a2')
      assert.equal(msgs[0].senderType, 'agent')
      assert.equal(msgs[0].senderName, 'SenderBot')
      assert.equal(msgs[0].routingMode, 'direct')
      assert.equal(msgs[0].isMentioned, true)
      assert.ok(msgs[0].content.includes('@ReceiverBot'))
    })

    it('agent does not route to itself', async () => {
      const user = await registerUser('route_a2a_self')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'A2A Self Room', broadcastMode: false },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw = await setupGatewayAgent(user, 'rt-gw-a2a-self', 'rt-agent-selfref', 'SelfBot')
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-selfref', memberType: 'agent' }, user.accessToken)

      const client = await setupClient(user, roomId)
      const collect = wsCollect(gw, 'server:send_to_agent', 1500)

      // Agent mentions itself
      gw.send(
        JSON.stringify({
          type: 'gateway:message_complete',
          roomId,
          agentId: 'rt-agent-selfref',
          messageId: 'self-msg-1',
          fullContent: 'I @SelfBot should not loop',
        }),
      )

      const msgs = await collect
      // Should NOT receive a message routed to itself
      assert.equal(msgs.length, 0)
    })
  })

  // ─── Room Context ───

  describe('Room Context', () => {
    it('agent receives room context on registration', async () => {
      const user = await registerUser('route_ctx1')

      // Create room with systemPrompt
      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Context Room', broadcastMode: true, systemPrompt: 'You are a coding assistant' },
        user.accessToken,
      )
      const roomId = room.data.data.id

      // Pre-add agent as member (before gateway registers)
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-ctx1', memberType: 'agent' },
        user.accessToken,
      )

      // Setup gateway — agent registration should trigger room context
      const gw = track(await connectWs(WS_GATEWAY_URL))
      await wsSendAndWait(
        gw,
        {
          type: 'gateway:auth',
          token: user.accessToken,
          gatewayId: 'rt-gw-ctx1',
          deviceInfo: { hostname: 'test', platform: 'test', arch: 'x64', nodeVersion: 'v20' },
        },
        'server:gateway_auth_result',
      )

      // Start collecting room context before registering
      const contextPromise = wsWaitFor(gw, 'server:room_context', 5000)

      gw.send(
        JSON.stringify({
          type: 'gateway:register_agent',
          agent: {
            id: 'rt-agent-ctx1',
            name: 'ContextBot',
            type: 'generic',
            capabilities: ['code', 'debug'],
          },
        }),
      )

      const ctx = await contextPromise
      assert.equal(ctx.agentId, 'rt-agent-ctx1')
      assert.equal(ctx.context.roomId, roomId)
      assert.equal(ctx.context.roomName, 'Context Room')
      assert.equal(ctx.context.systemPrompt, 'You are a coding assistant')
      assert.ok(ctx.context.members.length >= 1)
    })

    it('agents receive room context when member is added', async () => {
      const user = await registerUser('route_ctx2')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Ctx Add Room' },
        user.accessToken,
      )
      const roomId = room.data.data.id

      // Setup agent already in room
      const gw = await setupGatewayAgent(user, 'rt-gw-ctx2', 'rt-agent-ctx2', 'WatcherBot')
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-ctx2', memberType: 'agent' }, user.accessToken)

      // Wait for initial room context from member add
      await new Promise((r) => setTimeout(r, 500))

      // Now add another member — agent should receive updated room context
      const contextPromise = wsWaitFor(gw, 'server:room_context', 5000)

      // Register and add second agent
      const gw2 = await setupGatewayAgent(user, 'rt-gw-ctx2b', 'rt-agent-ctx2b', 'NewBot')
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-ctx2b', memberType: 'agent' }, user.accessToken)

      const ctx = await contextPromise
      assert.equal(ctx.context.roomId, roomId)
      // Should have at least the creator user + both agents
      assert.ok(ctx.context.members.length >= 3)
    })

    it('agents receive room context when room is updated', async () => {
      const user = await registerUser('route_ctx3')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Ctx Update Room' },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw = await setupGatewayAgent(user, 'rt-gw-ctx3', 'rt-agent-ctx3', 'UpdateWatcher')
      await api('POST', `/api/rooms/${roomId}/members`, { memberId: 'rt-agent-ctx3', memberType: 'agent' }, user.accessToken)
      await new Promise((r) => setTimeout(r, 500))

      // Update room systemPrompt
      const contextPromise = wsWaitFor(gw, 'server:room_context', 5000)
      await api('PUT', `/api/rooms/${roomId}`, { systemPrompt: 'New system prompt' }, user.accessToken)

      const ctx = await contextPromise
      assert.equal(ctx.context.systemPrompt, 'New system prompt')
    })
  })

  // ─── Capabilities & systemPrompt in API ───

  describe('Capabilities & SystemPrompt', () => {
    it('agent capabilities stored and returned in API', async () => {
      const user = await registerUser('route_cap1')

      const gw = await setupGatewayAgent(user, 'rt-gw-cap1', 'rt-agent-cap1', 'CapBot', {
        capabilities: ['code', 'review', 'test'],
      })

      const res = await api('GET', `/api/agents/rt-agent-cap1`, undefined, user.accessToken)
      assert.ok(res.data.ok)
      assert.deepEqual(res.data.data.capabilities, ['code', 'review', 'test'])
      assert.equal(res.data.data.connectionType, 'cli')
    })

    it('room systemPrompt stored and returned in API', async () => {
      const user = await registerUser('route_sp1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'SP Room', systemPrompt: 'Build a web app' },
        user.accessToken,
      )
      assert.equal(room.data.data.systemPrompt, 'Build a web app')

      // Update systemPrompt
      await api('PUT', `/api/rooms/${room.data.data.id}`, { systemPrompt: 'Updated prompt' }, user.accessToken)
      const updated = await api('GET', `/api/rooms/${room.data.data.id}`, undefined, user.accessToken)
      assert.equal(updated.data.data.systemPrompt, 'Updated prompt')

      // Clear systemPrompt
      await api('PUT', `/api/rooms/${room.data.data.id}`, { systemPrompt: null }, user.accessToken)
      const cleared = await api('GET', `/api/rooms/${room.data.data.id}`, undefined, user.accessToken)
      assert.equal(cleared.data.data.systemPrompt, null)
    })
  })
})
