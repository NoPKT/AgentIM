import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WsClient } from './ws.js'

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
  static instances: MockWebSocket[] = []

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

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
})

describe('WsClient', () => {
  it('transitions status to connected after open', () => {
    const client = new WsClient()
    const statuses: string[] = []
    client.onStatusChange((s) => statuses.push(s))

    client.connect('token123')
    MockWebSocket.instances[0].simulateOpen()

    expect(statuses).toContain('connected')
  })

  it('transitions to disconnected on explicit disconnect', () => {
    const client = new WsClient()
    client.connect('token123')
    MockWebSocket.instances[0].simulateOpen()

    const statuses: string[] = []
    client.onStatusChange((s) => statuses.push(s))
    client.disconnect()

    expect(statuses).toContain('disconnected')
  })

  it('queues messages sent while not connected', () => {
    const client = new WsClient()
    client.send({ type: 'client:join_room', roomId: 'r1' })
    // @ts-expect-error — access private
    expect(client.pendingQueue.length).toBe(1)
  })

  it('gives up reconnecting once MAX_RECONNECT_ATTEMPTS (50) is reached', () => {
    vi.useFakeTimers()
    const client = new WsClient()

    // First connect and open to set status to 'connected'
    client.connect('token123')
    MockWebSocket.instances[0].simulateOpen()

    // Set internal state as if 50 attempts have already been used
    // @ts-expect-error — access private
    client._token = 'token123'
    // @ts-expect-error — access private
    client.shouldReconnect = true
    // @ts-expect-error — access private
    client.reconnectAttempts = 50

    const statuses: string[] = []
    client.onStatusChange((s) => statuses.push(s))

    // scheduleReconnect should now hit the limit and set status to 'disconnected'
    // @ts-expect-error — call private method
    client.scheduleReconnect()

    expect(statuses).toContain('disconnected')
    // @ts-expect-error — confirm no timer was scheduled
    expect(client.reconnectTimer).toBeNull()
  })

  it('resets reconnect backoff on network online event', () => {
    const client = new WsClient()
    client.connect('token123')
    MockWebSocket.instances[0].simulateOpen()

    // Simulate high backoff state after many reconnect failures
    // @ts-expect-error — access private
    client.reconnectAttempts = 30
    // @ts-expect-error — access private
    client.reconnectInterval = 15000

    // Trigger disconnect so the online handler has work to do
    client['ws']?.close()

    window.dispatchEvent(new Event('online'))

    // After the online event, the handler resets to 0 then scheduleReconnect increments to 1.
    // The key invariant is that the count is dramatically reduced from 30 (i.e., reset happened).
    // @ts-expect-error — access private
    expect(client.reconnectAttempts).toBeLessThan(5)
  })
})
