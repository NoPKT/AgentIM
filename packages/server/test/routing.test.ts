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

  const AGENT_REGISTRATION_DELAY_MS = 300
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
    await new Promise((r) => setTimeout(r, AGENT_REGISTRATION_DELAY_MS))
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

  // ─── Two-Mode Routing ───

  describe('Two-Mode Routing', () => {
    it('broadcast mode without @mention and without AI Router: message NOT routed to agents', async () => {
      const user = await registerUser('route_bc1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Broadcast Room', broadcastMode: true },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-bc1', 'rt-agent-bc1', 'AgentA')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-bc2', 'rt-agent-bc2', 'AgentB')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-bc1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-bc2', memberType: 'agent' },
        user.accessToken,
      )

      const client = await setupClient(user, roomId)

      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)
      const collect2 = wsCollect(gw2, 'server:send_to_agent', 1500)

      // Send message without @mention — no AI Router configured
      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: 'Hello everyone',
          mentions: [],
        }),
      )

      const [msgs1, msgs2] = await Promise.all([collect1, collect2])

      // No agents should receive (no AI Router configured, no @mention)
      assert.equal(msgs1.length, 0)
      assert.equal(msgs2.length, 0)
    })

    it('direct mode: only mentioned agent receives with routingMode=direct', async () => {
      const user = await registerUser('route_dir1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Direct Room', broadcastMode: false },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-dir1', 'rt-agent-dir1', 'DirAgentA')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-dir2', 'rt-agent-dir2', 'DirAgentB')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-dir1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-dir2', memberType: 'agent' },
        user.accessToken,
      )

      const client = await setupClient(user, roomId)

      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)
      const collect2 = wsCollect(gw2, 'server:send_to_agent', 1500)

      // Send message with @DirAgentA mention
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
      assert.equal(msgs1[0].senderType, 'user')
      assert.ok(typeof msgs1[0].conversationId === 'string')
      assert.equal(msgs1[0].depth, 0)

      // DirAgentB should NOT receive
      assert.equal(msgs2.length, 0)
    })

    it('@mention in broadcast room routes as direct to only mentioned agent', async () => {
      const user = await registerUser('route_bcd1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'BC Direct Room', broadcastMode: true },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-bcd1', 'rt-agent-bcd1', 'AlphaBot')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-bcd2', 'rt-agent-bcd2', 'BetaBot')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-bcd1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-bcd2', memberType: 'agent' },
        user.accessToken,
      )

      const client = await setupClient(user, roomId)

      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)
      const collect2 = wsCollect(gw2, 'server:send_to_agent', 1500)

      // Send message with @AlphaBot in broadcast room
      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: '@AlphaBot do something',
          mentions: ['AlphaBot'],
        }),
      )

      const [msgs1, msgs2] = await Promise.all([collect1, collect2])

      // Only AlphaBot receives (direct mode, not broadcast)
      assert.equal(msgs1.length, 1)
      assert.equal(msgs1[0].routingMode, 'direct')
      assert.equal(msgs1[0].agentId, 'rt-agent-bcd1')

      // BetaBot should NOT receive
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
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-none1', memberType: 'agent' },
        user.accessToken,
      )

      const client = await setupClient(user, roomId)
      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)

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

    it('server-side mention parsing: routing uses server-parsed mentions not client-provided', async () => {
      const user = await registerUser('route_smp1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'ServerMentions Room', broadcastMode: false },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-smp1', 'rt-agent-smp1', 'RealAgent')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-smp2', 'rt-agent-smp2', 'FakeAgent')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-smp1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-smp2', memberType: 'agent' },
        user.accessToken,
      )

      const client = await setupClient(user, roomId)

      const collect1 = wsCollect(gw1, 'server:send_to_agent', 1500)
      const collect2 = wsCollect(gw2, 'server:send_to_agent', 1500)

      // Content mentions @RealAgent, but client provides spoofed mentions for FakeAgent
      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: '@RealAgent help me',
          mentions: ['FakeAgent'],
        }),
      )

      const [msgs1, msgs2] = await Promise.all([collect1, collect2])

      // RealAgent should receive (server parsed from content)
      assert.equal(msgs1.length, 1)
      assert.equal(msgs1[0].agentId, 'rt-agent-smp1')

      // FakeAgent should NOT receive (client mention is ignored for routing)
      assert.equal(msgs2.length, 0)
    })
  })

  // ─── Agent-to-Agent Routing ───

  describe('Agent-to-Agent Routing', () => {
    it('agent mentioning another agent triggers direct routing with conversationId and depth', async () => {
      const user = await registerUser('route_a2a1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'A2A Room', broadcastMode: false },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-a2a1', 'rt-agent-a2a1', 'SenderBot')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-a2a2', 'rt-agent-a2a2', 'ReceiverBot')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-a2a1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-a2a2', memberType: 'agent' },
        user.accessToken,
      )

      const client = await setupClient(user, roomId)

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

      assert.equal(msgs.length, 1)
      assert.equal(msgs[0].agentId, 'rt-agent-a2a2')
      assert.equal(msgs[0].senderType, 'agent')
      assert.equal(msgs[0].senderName, 'SenderBot')
      assert.equal(msgs[0].routingMode, 'direct')
      assert.ok(typeof msgs[0].conversationId === 'string')
      assert.equal(msgs[0].depth, 1) // depth incremented from 0 (default)
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
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-selfref', memberType: 'agent' },
        user.accessToken,
      )

      await setupClient(user, roomId)
      const collect = wsCollect(gw, 'server:send_to_agent', 1500)

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
      assert.equal(msgs.length, 0)
    })

    it('conversation chain passes conversationId and depth through agent relay', async () => {
      const user = await registerUser('route_chain1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Chain Room', broadcastMode: false },
        user.accessToken,
      )
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-chain1', 'rt-agent-chain1', 'ChainA')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-chain2', 'rt-agent-chain2', 'ChainB')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-chain1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-chain2', memberType: 'agent' },
        user.accessToken,
      )

      const client = await setupClient(user, roomId)

      // User sends to ChainA
      const collectA = wsCollect(gw1, 'server:send_to_agent', 1500)

      client.send(
        JSON.stringify({
          type: 'client:send_message',
          roomId,
          content: '@ChainA start the chain',
          mentions: ['ChainA'],
        }),
      )

      const msgsA = await collectA
      assert.equal(msgsA.length, 1)
      const convId = msgsA[0].conversationId
      assert.equal(msgsA[0].depth, 0)

      // ChainA responds mentioning ChainB, passing the conversation chain
      const collectB = wsCollect(gw2, 'server:send_to_agent', 2000)

      gw1.send(
        JSON.stringify({
          type: 'gateway:message_complete',
          roomId,
          agentId: 'rt-agent-chain1',
          messageId: 'chain-msg-1',
          fullContent: '@ChainB continue this',
          conversationId: convId,
          depth: 0,
        }),
      )

      const msgsB = await collectB
      assert.equal(msgsB.length, 1)
      assert.equal(msgsB[0].conversationId, convId)
      assert.equal(msgsB[0].depth, 1)
    })
  })

  // ─── Room Context ───

  describe('Room Context', () => {
    it('agent receives room context on registration', async () => {
      const user = await registerUser('route_ctx1')

      const room = await api(
        'POST',
        '/api/rooms',
        { name: 'Context Room', broadcastMode: true, systemPrompt: 'You are a coding assistant' },
        user.accessToken,
      )
      const roomId = room.data.data.id

      // Register agent first (agent must exist in DB before adding to room)
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
      await new Promise((r) => setTimeout(r, 300))

      // Add agent to room — agent should receive room context
      const contextPromise = wsWaitFor(gw, 'server:room_context', 5000)

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-ctx1', memberType: 'agent' },
        user.accessToken,
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

      const room = await api('POST', '/api/rooms', { name: 'Ctx Add Room' }, user.accessToken)
      const roomId = room.data.data.id

      const gw = await setupGatewayAgent(user, 'rt-gw-ctx2', 'rt-agent-ctx2', 'WatcherBot')
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-ctx2', memberType: 'agent' },
        user.accessToken,
      )

      await new Promise((r) => setTimeout(r, 500))

      const contextPromise = wsWaitFor(gw, 'server:room_context', 5000)

      await setupGatewayAgent(user, 'rt-gw-ctx2b', 'rt-agent-ctx2b', 'NewBot')
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-ctx2b', memberType: 'agent' },
        user.accessToken,
      )

      const ctx = await contextPromise
      assert.equal(ctx.context.roomId, roomId)
      assert.ok(ctx.context.members.length >= 3)
    })

    it('agents receive room context when room is updated', async () => {
      const user = await registerUser('route_ctx3')

      const room = await api('POST', '/api/rooms', { name: 'Ctx Update Room' }, user.accessToken)
      const roomId = room.data.data.id

      const gw = await setupGatewayAgent(user, 'rt-gw-ctx3', 'rt-agent-ctx3', 'UpdateWatcher')
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-ctx3', memberType: 'agent' },
        user.accessToken,
      )
      await new Promise((r) => setTimeout(r, 500))

      const contextPromise = wsWaitFor(gw, 'server:room_context', 5000)
      await api(
        'PUT',
        `/api/rooms/${roomId}`,
        { systemPrompt: 'New system prompt' },
        user.accessToken,
      )

      const ctx = await contextPromise
      assert.equal(ctx.context.systemPrompt, 'New system prompt')
    })
  })

  // ─── Routing Protection ───

  describe('Routing Protection', () => {
    it('depth limit: stops routing when chain depth reaches maxAgentChainDepth', async () => {
      const user = await registerUser('route_depth1')

      const room = await api('POST', '/api/rooms', { name: 'Depth Room' }, user.accessToken)
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-depth1', 'rt-agent-depth1', 'DeepA')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-depth2', 'rt-agent-depth2', 'DeepB')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-depth1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-depth2', memberType: 'agent' },
        user.accessToken,
      )

      await setupClient(user, roomId)

      // Case 1: depth under limit (default maxAgentChainDepth=5) — should route
      const collectOk = wsCollect(gw2, 'server:send_to_agent', 2000)
      gw1.send(
        JSON.stringify({
          type: 'gateway:message_complete',
          roomId,
          agentId: 'rt-agent-depth1',
          messageId: 'depth-ok-msg',
          fullContent: '@DeepB continue',
          conversationId: 'depth-conv-ok',
          depth: 3,
        }),
      )
      const msgsOk = await collectOk
      assert.equal(msgsOk.length, 1)
      assert.equal(msgsOk[0].depth, 4)

      // Case 2: depth at limit — should NOT route
      const collectBlocked = wsCollect(gw2, 'server:send_to_agent', 1500)
      gw1.send(
        JSON.stringify({
          type: 'gateway:message_complete',
          roomId,
          agentId: 'rt-agent-depth1',
          messageId: 'depth-blocked-msg',
          fullContent: '@DeepB too deep',
          conversationId: 'depth-conv-blocked',
          depth: 5,
        }),
      )
      const msgsBlocked = await collectBlocked
      assert.equal(msgsBlocked.length, 0)
    })

    it('visited dedup: prevents A→B→A loop via conversation visited set', async () => {
      const user = await registerUser('route_visited1')

      const room = await api('POST', '/api/rooms', { name: 'Visited Room' }, user.accessToken)
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-vis1', 'rt-agent-vis1', 'VisA')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-vis2', 'rt-agent-vis2', 'VisB')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-vis1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-vis2', memberType: 'agent' },
        user.accessToken,
      )

      await setupClient(user, roomId)
      const convId = 'visited-test-conv'

      // Step 1: A mentions B → B should receive
      const collectB = wsCollect(gw2, 'server:send_to_agent', 2000)
      gw1.send(
        JSON.stringify({
          type: 'gateway:message_complete',
          roomId,
          agentId: 'rt-agent-vis1',
          messageId: 'vis-msg-1',
          fullContent: '@VisB help me',
          conversationId: convId,
          depth: 0,
        }),
      )
      const msgsB = await collectB
      assert.equal(msgsB.length, 1)
      assert.equal(msgsB[0].depth, 1)

      // Step 2: B mentions A (same conversation) → A should NOT receive (A in visited set)
      const collectA = wsCollect(gw1, 'server:send_to_agent', 1500)
      gw2.send(
        JSON.stringify({
          type: 'gateway:message_complete',
          roomId,
          agentId: 'rt-agent-vis2',
          messageId: 'vis-msg-2',
          fullContent: '@VisA here is the answer',
          conversationId: convId,
          depth: 1,
        }),
      )
      const msgsA = await collectA
      assert.equal(msgsA.length, 0)
    })

    it('rate limit: agent messages saved but not routed after exceeding limit', async () => {
      const user = await registerUser('route_rl1')

      const room = await api('POST', '/api/rooms', { name: 'RateLimit Room' }, user.accessToken)
      const roomId = room.data.data.id

      const gw1 = await setupGatewayAgent(user, 'rt-gw-rl1', 'rt-agent-rl1', 'SpammerBot')
      const gw2 = await setupGatewayAgent(user, 'rt-gw-rl2', 'rt-agent-rl2', 'VictimBot')

      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-rl1', memberType: 'agent' },
        user.accessToken,
      )
      await api(
        'POST',
        `/api/rooms/${roomId}/members`,
        { memberId: 'rt-agent-rl2', memberType: 'agent' },
        user.accessToken,
      )

      await setupClient(user, roomId)

      // AGENT_RATE_LIMIT_MAX=5 in test env — send 8 messages to exceed it
      const totalMessages = 8
      const collectTarget = wsCollect(gw2, 'server:send_to_agent', 4000)

      for (let i = 0; i < totalMessages; i++) {
        gw1.send(
          JSON.stringify({
            type: 'gateway:message_complete',
            roomId,
            agentId: 'rt-agent-rl1',
            messageId: `rl-msg-${i}`,
            fullContent: `@VictimBot message ${i}`,
          }),
        )
      }

      const msgs = await collectTarget

      // Only first 5 should be routed (count 1-5 not limited; count 6+ limited)
      assert.equal(msgs.length, 5)
    })
  })

  // ─── Capabilities & systemPrompt in API ───

  describe('Capabilities & SystemPrompt', () => {
    it('agent capabilities stored and returned in API', async () => {
      const user = await registerUser('route_cap1')

      await setupGatewayAgent(user, 'rt-gw-cap1', 'rt-agent-cap1', 'CapBot', {
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

      await api(
        'PUT',
        `/api/rooms/${room.data.data.id}`,
        { systemPrompt: 'Updated prompt' },
        user.accessToken,
      )
      const updated = await api(
        'GET',
        `/api/rooms/${room.data.data.id}`,
        undefined,
        user.accessToken,
      )
      assert.equal(updated.data.data.systemPrompt, 'Updated prompt')

      await api('PUT', `/api/rooms/${room.data.data.id}`, { systemPrompt: null }, user.accessToken)
      const cleared = await api(
        'GET',
        `/api/rooms/${room.data.data.id}`,
        undefined,
        user.accessToken,
      )
      assert.equal(cleared.data.data.systemPrompt, null)
    })
  })
})
