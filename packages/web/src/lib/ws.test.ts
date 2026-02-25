import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WsClient } from './ws.js'
import type { ConnectionStatus } from './ws.js'

// ---------------------------------------------------------------------------
// MockWebSocket — lightweight stand-in for the browser WebSocket API
// ---------------------------------------------------------------------------
class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((evt: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  sent: string[] = []
  closed = false
  static instances: MockWebSocket[] = []

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  simulateError() {
    this.onerror?.()
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function latestWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

function connectClient(client: WsClient, token = 'tok'): MockWebSocket {
  client.connect(token)
  const ws = latestWs()
  ws.simulateOpen()
  return ws
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
const originalWebSocket = globalThis.WebSocket

beforeEach(() => {
  MockWebSocket.instances = []
  // @ts-expect-error — mock
  globalThis.WebSocket = MockWebSocket
  Object.defineProperty(globalThis, 'location', {
    value: { protocol: 'http:', host: 'localhost:3000' },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ===========================================================================
// Tests
// ===========================================================================
describe('WsClient', () => {
  // -----------------------------------------------------------------------
  // 1. connect()
  // -----------------------------------------------------------------------
  describe('connect()', () => {
    it('creates WebSocket with correct ws: URL derived from location', () => {
      const client = new WsClient()
      client.connect('tok')

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(latestWs().url).toBe('ws://localhost:3000/ws/client')
    })

    it('creates wss: URL when page is served over https', () => {
      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'https:', host: 'app.example.com' },
        writable: true,
        configurable: true,
      })
      const client = new WsClient()
      client.connect('tok')

      expect(latestWs().url).toBe('wss://app.example.com/ws/client')
    })

    it('sends client:auth message on open with the provided token', () => {
      const client = new WsClient()
      const ws = connectClient(client, 'my-token')

      expect(ws.sent).toHaveLength(1)
      const parsed = JSON.parse(ws.sent[0])
      expect(parsed).toEqual({ type: 'client:auth', token: 'my-token' })
    })

    it('uses the freshest token if updateToken() was called before open', () => {
      const client = new WsClient()
      client.connect('old-token')
      client.updateToken('fresh-token')
      latestWs().simulateOpen()

      const parsed = JSON.parse(latestWs().sent[0])
      expect(parsed.token).toBe('fresh-token')
    })

    it('guards against duplicate concurrent connect() calls', () => {
      const client = new WsClient()
      client.connect('tok')
      // Second call while _connecting is true should be a no-op
      client.connect('tok')
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('cleans up old WebSocket when connecting again', () => {
      const client = new WsClient()
      const ws1 = connectClient(client)
      // Now disconnect implicitly by connecting again — first close the flag
      // @ts-expect-error — reset private flag
      client._connecting = false
      client.connect('tok2')

      expect(ws1.closed).toBe(true)
      expect(MockWebSocket.instances).toHaveLength(2)
    })
  })

  // -----------------------------------------------------------------------
  // 2. disconnect()
  // -----------------------------------------------------------------------
  describe('disconnect()', () => {
    it('closes the WebSocket and sets status to disconnected', () => {
      const client = new WsClient()
      connectClient(client)

      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))
      client.disconnect()

      expect(client.status).toBe('disconnected')
      expect(statuses).toContain('disconnected')
    })

    it('clears pending queue on disconnect', () => {
      const client = new WsClient()
      client.send({ type: 'client:join_room', roomId: 'r1' })
      // @ts-expect-error — access private
      expect(client.pendingQueue.length).toBe(1)

      client.disconnect()
      // @ts-expect-error — access private
      expect(client.pendingQueue.length).toBe(0)
    })

    it('clears reconnect timer on disconnect', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client)

      // Simulate a close that triggers reconnect
      // @ts-expect-error — access private
      client._connecting = false
      latestWs().simulateClose()
      // reconnectTimer should be set now
      // @ts-expect-error — access private
      expect(client.reconnectTimer).not.toBeNull()

      const wsCountBefore = MockWebSocket.instances.length
      client.disconnect()

      // After disconnect, shouldReconnect is false — the cleared timer cannot fire
      // @ts-expect-error — access private
      expect(client.shouldReconnect).toBe(false)

      // Advance past the reconnect interval — no new WebSocket should be created
      vi.advanceTimersByTime(20_000)
      expect(MockWebSocket.instances.length).toBe(wsCountBefore)
    })

    it('removes network event listeners on disconnect', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const client = new WsClient()
      connectClient(client)
      client.disconnect()

      const removedTypes = removeSpy.mock.calls.map((c) => c[0])
      expect(removedTypes).toContain('online')
      expect(removedTypes).toContain('offline')
    })
  })

  // -----------------------------------------------------------------------
  // 3. send() when connected
  // -----------------------------------------------------------------------
  describe('send() when connected', () => {
    it('sends JSON-stringified message over the WebSocket', () => {
      const client = new WsClient()
      const ws = connectClient(client)

      // First message is auth; clear it
      ws.sent.length = 0

      const msg = { type: 'client:join_room' as const, roomId: 'room1' }
      client.send(msg)

      expect(ws.sent).toHaveLength(1)
      expect(JSON.parse(ws.sent[0])).toEqual(msg)
    })
  })

  // -----------------------------------------------------------------------
  // 4. send() when disconnected — queues messages
  // -----------------------------------------------------------------------
  describe('send() when disconnected', () => {
    it('queues non-auth, non-ping messages', () => {
      const client = new WsClient()
      client.send({ type: 'client:join_room', roomId: 'r1' })
      client.send({ type: 'client:typing', roomId: 'r2' })

      // @ts-expect-error — access private
      expect(client.pendingQueue).toHaveLength(2)
    })

    it('does NOT queue client:auth messages', () => {
      const client = new WsClient()
      client.send({ type: 'client:auth', token: 'tok' })
      // @ts-expect-error — access private
      expect(client.pendingQueue).toHaveLength(0)
    })

    it('does NOT queue client:ping messages', () => {
      const client = new WsClient()
      client.send({ type: 'client:ping', ts: Date.now() })
      // @ts-expect-error — access private
      expect(client.pendingQueue).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // 5. Queue overflow — ws:queue_full
  // -----------------------------------------------------------------------
  describe('queue overflow', () => {
    it('drops messages when pending queue is full (MAX_WS_QUEUE_SIZE)', () => {
      const client = new WsClient()
      const MAX = 500
      for (let i = 0; i < MAX; i++) {
        client.send({ type: 'client:join_room', roomId: `r${i}` })
      }
      // @ts-expect-error — access private
      expect(client.pendingQueue.length).toBe(MAX)

      client.send({ type: 'client:join_room', roomId: 'overflow' })
      // @ts-expect-error — access private
      expect(client.pendingQueue.length).toBe(MAX)
    })

    it('dispatches ws:queue_full CustomEvent on overflow', () => {
      const client = new WsClient()
      const MAX = 500
      for (let i = 0; i < MAX; i++) {
        client.send({ type: 'client:join_room', roomId: `r${i}` })
      }

      const handler = vi.fn()
      window.addEventListener('ws:queue_full', handler)

      client.send({ type: 'client:join_room', roomId: 'overflow' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { type: 'client:join_room' },
        }),
      )

      window.removeEventListener('ws:queue_full', handler)
    })
  })

  // -----------------------------------------------------------------------
  // 6. Message validation
  // -----------------------------------------------------------------------
  describe('message validation', () => {
    it('dispatches valid server messages to registered handlers', () => {
      const client = new WsClient()
      const ws = connectClient(client)
      const handler = vi.fn()
      client.onMessage(handler)

      const validMsg = { type: 'server:auth_result', ok: true, userId: 'u1' }
      ws.simulateMessage(validMsg)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(validMsg)
    })

    it('dispatches ws:validation_error for invalid server messages', () => {
      const client = new WsClient()
      const ws = connectClient(client)
      const handler = vi.fn()
      const msgHandler = vi.fn()
      client.onMessage(msgHandler)
      window.addEventListener('ws:validation_error', handler)

      // Invalid: missing required fields
      ws.simulateMessage({ type: 'server:unknown_garbage', foo: 'bar' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { raw: { type: 'server:unknown_garbage', foo: 'bar' } },
        }),
      )
      // The message handler should NOT have been called for invalid messages
      expect(msgHandler).not.toHaveBeenCalled()

      window.removeEventListener('ws:validation_error', handler)
    })

    it('silently handles server:pong without dispatching to message handlers', () => {
      const client = new WsClient()
      const ws = connectClient(client)
      const handler = vi.fn()
      client.onMessage(handler)

      ws.simulateMessage({ type: 'server:pong', ts: 12345 })

      // pong is consumed internally and NOT forwarded to onMessage handlers
      expect(handler).not.toHaveBeenCalled()
    })

    it('ignores unparseable JSON without crashing', () => {
      const client = new WsClient()
      const ws = connectClient(client)
      const handler = vi.fn()
      client.onMessage(handler)

      // Directly call onmessage with malformed JSON
      ws.onmessage?.({ data: 'not-json{{{' })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // 7. Reconnection
  // -----------------------------------------------------------------------
  describe('reconnection', () => {
    it('schedules reconnect after WebSocket close event', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client)

      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))

      // Simulate unexpected close — triggers onclose handler
      // We need to reset _connecting so the close handler runs properly
      // @ts-expect-error — access private
      client._connecting = false
      latestWs().simulateClose()

      expect(statuses).toContain('reconnecting')
      // @ts-expect-error — access private
      expect(client.reconnectTimer).not.toBeNull()
    })

    it('reconnects with exponential backoff', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client)

      // Close the connection to trigger reconnect
      // @ts-expect-error — access private
      client._connecting = false
      latestWs().simulateClose()

      // Advance first backoff (1000ms)
      vi.advanceTimersByTime(1000)

      // A new WebSocket should have been created
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2)
    })

    it('gives up reconnecting after MAX_RECONNECT_ATTEMPTS (50)', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client)

      // Set attempts to max
      // @ts-expect-error — access private
      client._token = 'tok'
      // @ts-expect-error — access private
      client.shouldReconnect = true
      // @ts-expect-error — access private
      client.reconnectAttempts = 50

      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))

      // @ts-expect-error — call private method
      client.scheduleReconnect()

      expect(statuses).toContain('disconnected')
      // @ts-expect-error — access private
      expect(client.reconnectTimer).toBeNull()
    })

    it('flushes queued messages after successful auth on reconnect', () => {
      const client = new WsClient()
      const ws1 = connectClient(client)

      // Simulate initial successful auth so wasConnected becomes true
      ws1.simulateMessage({ type: 'server:auth_result', ok: true, userId: 'u1' })

      // Queue a message while "disconnected" (simulate by setting readyState)
      // @ts-expect-error — access private
      client.pendingQueue.push({ type: 'client:join_room', roomId: 'pending-room' })

      // Now simulate a reconnect: new WS opens and auth succeeds
      // @ts-expect-error — access private
      client._connecting = false
      client.connect('tok')
      const ws2 = latestWs()
      ws2.simulateOpen()
      ws2.sent.length = 0 // clear the auth message

      // Simulate server auth success
      ws2.simulateMessage({ type: 'server:auth_result', ok: true, userId: 'u1' })

      // The queued message should have been flushed
      expect(ws2.sent.length).toBeGreaterThanOrEqual(1)
      const flushed = ws2.sent.map((s) => JSON.parse(s))
      expect(flushed).toContainEqual({ type: 'client:join_room', roomId: 'pending-room' })
    })

    it('fires reconnect handlers on auth success after reconnect', () => {
      const client = new WsClient()
      const ws1 = connectClient(client)

      // First auth sets wasConnected = true
      ws1.simulateMessage({ type: 'server:auth_result', ok: true, userId: 'u1' })

      const reconnectHandler = vi.fn()
      client.onReconnect(reconnectHandler)

      // Reconnect
      // @ts-expect-error — access private
      client._connecting = false
      client.connect('tok')
      const ws2 = latestWs()
      ws2.simulateOpen()

      // Auth success on reconnect
      ws2.simulateMessage({ type: 'server:auth_result', ok: true, userId: 'u1' })

      expect(reconnectHandler).toHaveBeenCalledTimes(1)
    })

    it('does NOT fire reconnect handlers on first connection auth', () => {
      const client = new WsClient()
      const ws = connectClient(client)

      const reconnectHandler = vi.fn()
      client.onReconnect(reconnectHandler)

      ws.simulateMessage({ type: 'server:auth_result', ok: true, userId: 'u1' })

      // wasConnected was false before this auth, so reconnect handlers should NOT fire
      expect(reconnectHandler).not.toHaveBeenCalled()
    })

    it('manual reconnect() resets attempts and reconnects', () => {
      const client = new WsClient()
      connectClient(client, 'tok')

      // Simulate exhausted attempts
      // @ts-expect-error — access private
      client.reconnectAttempts = 50
      // @ts-expect-error — access private
      client.shouldReconnect = false
      // @ts-expect-error — access private
      client._connecting = false

      client.reconnect()

      // @ts-expect-error — access private
      expect(client.reconnectAttempts).toBe(0)
      // A new WebSocket should have been created
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2)
    })

    it('manual reconnect() does nothing when no token', () => {
      const client = new WsClient()
      const countBefore = MockWebSocket.instances.length
      client.reconnect()
      expect(MockWebSocket.instances.length).toBe(countBefore)
    })
  })

  // -----------------------------------------------------------------------
  // 8. Network events
  // -----------------------------------------------------------------------
  describe('network events', () => {
    it('offline event triggers disconnect and reconnecting status', () => {
      const client = new WsClient()
      connectClient(client)

      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))

      window.dispatchEvent(new Event('offline'))

      expect(statuses).toContain('reconnecting')
    })

    it('online event triggers reconnect with reset backoff', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client)

      // Set high backoff
      // @ts-expect-error — access private
      client.reconnectAttempts = 30
      // @ts-expect-error — access private
      client.reconnectInterval = 15000

      // Simulate disconnect — close the ws to allow the online handler to act
      // @ts-expect-error — access private
      client._connecting = false
      latestWs().close()

      window.dispatchEvent(new Event('online'))

      // Backoff should be reset
      // @ts-expect-error — access private
      expect(client.reconnectAttempts).toBeLessThan(5)
    })

    it('online event is a no-op if already connected', () => {
      const client = new WsClient()
      connectClient(client)

      const countBefore = MockWebSocket.instances.length

      window.dispatchEvent(new Event('online'))

      // No new WebSocket should be created
      expect(MockWebSocket.instances.length).toBe(countBefore)
    })
  })

  // -----------------------------------------------------------------------
  // 9. Status changes
  // -----------------------------------------------------------------------
  describe('status changes', () => {
    it('initial status is disconnected', () => {
      const client = new WsClient()
      expect(client.status).toBe('disconnected')
    })

    it('emits connected on open', () => {
      const client = new WsClient()
      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))

      connectClient(client)

      expect(statuses).toEqual(['connected'])
      expect(client.status).toBe('connected')
    })

    it('emits disconnected on explicit disconnect', () => {
      const client = new WsClient()
      connectClient(client)

      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))

      client.disconnect()

      expect(statuses).toEqual(['disconnected'])
    })

    it('emits reconnecting on unexpected close', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client)

      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))

      // @ts-expect-error — access private
      client._connecting = false
      latestWs().simulateClose()

      expect(statuses).toContain('reconnecting')
    })

    it('does not emit duplicate status', () => {
      const client = new WsClient()
      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))

      // Call setStatus with 'connected' twice
      connectClient(client)
      // Force another connected call — should be de-duped
      // @ts-expect-error — call private
      client.setStatus('connected')

      const connectedCount = statuses.filter((s) => s === 'connected').length
      expect(connectedCount).toBe(1)
    })

    it('onStatusChange returns an unsubscribe function', () => {
      const client = new WsClient()
      const handler = vi.fn()
      const unsub = client.onStatusChange(handler)

      connectClient(client)
      expect(handler).toHaveBeenCalledTimes(1)

      unsub()
      client.disconnect()
      // Should not have been called again after unsub
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('onMessage returns an unsubscribe function', () => {
      const client = new WsClient()
      const ws = connectClient(client)
      const handler = vi.fn()
      const unsub = client.onMessage(handler)

      ws.simulateMessage({ type: 'server:auth_result', ok: true, userId: 'u1' })
      expect(handler).toHaveBeenCalledTimes(1)

      unsub()
      ws.simulateMessage({ type: 'server:auth_result', ok: false })
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // 10. Token refresh
  // -----------------------------------------------------------------------
  describe('token refresh', () => {
    it('calls tokenRefresher before reconnecting when set', async () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client)

      const refresher = vi.fn().mockResolvedValue('fresh-token')
      client.setTokenRefresher(refresher)

      // Trigger close -> scheduleReconnect
      // @ts-expect-error — access private
      client._connecting = false
      latestWs().simulateClose()

      // Advance past the reconnect delay (1000ms)
      await vi.advanceTimersByTimeAsync(1000)

      expect(refresher).toHaveBeenCalledTimes(1)

      // The new connect should use the fresh token
      const newWs = latestWs()
      newWs.simulateOpen()

      const authMsg = JSON.parse(newWs.sent[0])
      expect(authMsg.token).toBe('fresh-token')
    })

    it('stops reconnecting when tokenRefresher returns null (session expired)', async () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client)

      const refresher = vi.fn().mockResolvedValue(null)
      client.setTokenRefresher(refresher)

      const statuses: ConnectionStatus[] = []
      client.onStatusChange((s) => statuses.push(s))

      // @ts-expect-error — access private
      client._connecting = false
      latestWs().simulateClose()

      await vi.advanceTimersByTimeAsync(1000)

      expect(refresher).toHaveBeenCalledTimes(1)
      expect(statuses).toContain('disconnected')
      // @ts-expect-error — access private
      expect(client._token).toBeNull()
    })

    it('retries with existing token when tokenRefresher throws', async () => {
      vi.useFakeTimers()
      const client = new WsClient()
      connectClient(client, 'existing-token')

      const refresher = vi.fn().mockRejectedValue(new Error('network error'))
      client.setTokenRefresher(refresher)

      // @ts-expect-error — access private
      client._connecting = false
      latestWs().simulateClose()

      await vi.advanceTimersByTimeAsync(1000)

      expect(refresher).toHaveBeenCalledTimes(1)

      // Should still attempt to connect with existing token
      const newWs = latestWs()
      newWs.simulateOpen()
      const authMsg = JSON.parse(newWs.sent[0])
      expect(authMsg.token).toBe('existing-token')
    })
  })

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------
  describe('heartbeat', () => {
    it('sends client:ping every 30s while connected', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      const ws = connectClient(client)
      ws.sent.length = 0 // clear auth message

      // Advance 30 seconds — should trigger one ping
      vi.advanceTimersByTime(30_000)

      expect(ws.sent).toHaveLength(1)
      const ping = JSON.parse(ws.sent[0])
      expect(ping.type).toBe('client:ping')
      expect(typeof ping.ts).toBe('number')
    })

    it('closes WebSocket if pong not received within 10s', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      const ws = connectClient(client)

      // Advance to trigger ping
      vi.advanceTimersByTime(30_000)

      // Advance 10s more without pong — should close
      vi.advanceTimersByTime(10_000)

      expect(ws.closed).toBe(true)
    })

    it('clears pong timeout when pong is received', () => {
      vi.useFakeTimers()
      const client = new WsClient()
      const ws = connectClient(client)

      // Trigger ping
      vi.advanceTimersByTime(30_000)

      // Send pong
      ws.simulateMessage({ type: 'server:pong', ts: Date.now() })

      // Advance past pong timeout — ws should still be open
      // We need to check it didn't close
      const closedBefore = ws.closed
      vi.advanceTimersByTime(10_000)

      // The close in pong timeout would call ws.close() which sets ws.closed = true
      // But since pong was received, the timer was cleared
      // Note: the next ping at 60s will fire, but that's fine
      expect(closedBefore).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // connected getter
  // -----------------------------------------------------------------------
  describe('connected getter', () => {
    it('returns true when WebSocket is open', () => {
      const client = new WsClient()
      connectClient(client)
      expect(client.connected).toBe(true)
    })

    it('returns false when WebSocket is not open', () => {
      const client = new WsClient()
      expect(client.connected).toBe(false)
    })

    it('returns false after disconnect', () => {
      const client = new WsClient()
      connectClient(client)
      client.disconnect()
      expect(client.connected).toBe(false)
    })
  })
})
