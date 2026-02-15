import type { ClientMessage, ServerMessage } from '@agentim/shared'

type MessageHandler = (msg: ServerMessage) => void
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'
type StatusHandler = (status: ConnectionStatus) => void
type ReconnectHandler = () => void

const PING_INTERVAL = 30_000
const PONG_TIMEOUT = 10_000
const MAX_QUEUE_SIZE = 100

export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private reconnectHandlers = new Set<ReconnectHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wasConnected = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectInterval = 1000
  private shouldReconnect = true
  private _status: ConnectionStatus = 'disconnected'
  private _token: string | null = null
  private pendingQueue: ClientMessage[] = []

  get status(): ConnectionStatus {
    return this._status
  }

  private setStatus(status: ConnectionStatus) {
    if (this._status === status) return
    this._status = status
    for (const handler of this.statusHandlers) {
      handler(status)
    }
  }

  connect(token: string) {
    this._token = token
    this.shouldReconnect = true
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws/client`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      const isReconnect = this.wasConnected
      this.reconnectInterval = 1000
      this.send({ type: 'client:auth', token })
      this.setStatus('connected')
      this.startHeartbeat()
      this.flushQueue()
      if (isReconnect) {
        for (const handler of this.reconnectHandlers) {
          handler()
        }
      }
      this.wasConnected = true
    }

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as ServerMessage
        if (msg.type === 'server:pong') {
          this.clearPongTimeout()
          return
        }
        for (const handler of this.handlers) {
          handler(msg)
        }
      } catch {
        // Ignore parse errors
      }
    }

    this.ws.onclose = () => {
      this.stopHeartbeat()
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // Will trigger onclose
    }
  }

  disconnect() {
    this.shouldReconnect = false
    this.wasConnected = false
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this._token = null
    this.pendingQueue.length = 0
    this.setStatus('disconnected')
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else if (msg.type !== 'client:auth' && msg.type !== 'client:ping') {
      // Queue non-auth, non-ping messages for replay on reconnect
      if (this.pendingQueue.length < MAX_QUEUE_SIZE) {
        this.pendingQueue.push(msg)
      }
    }
  }

  private flushQueue() {
    if (this.pendingQueue.length === 0) return
    const queue = this.pendingQueue.splice(0)
    for (const msg of queue) {
      this.send(msg)
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  onReconnect(handler: ReconnectHandler): () => void {
    this.reconnectHandlers.add(handler)
    return () => this.reconnectHandlers.delete(handler)
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'client:ping', ts: Date.now() }))
        this.pongTimer = setTimeout(() => {
          console.warn('[WS] Pong timeout, reconnecting...')
          this.ws?.close()
        }, PONG_TIMEOUT)
      }
    }, PING_INTERVAL)
  }

  private stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    this.clearPongTimeout()
  }

  private clearPongTimeout() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || !this._token) return
    this.setStatus('reconnecting')
    const token = this._token
    this.reconnectTimer = setTimeout(() => {
      this.connect(token)
    }, this.reconnectInterval)
    this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, 15000)
  }
}

export const wsClient = new WsClient()
