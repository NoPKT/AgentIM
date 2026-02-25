import type { ClientMessage, ServerMessage } from '@agentim/shared'
import { serverMessageSchema, MAX_WS_QUEUE_SIZE, MAX_RECONNECT_ATTEMPTS } from '@agentim/shared'

type MessageHandler = (msg: ServerMessage) => void
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'
type StatusHandler = (status: ConnectionStatus) => void
type ReconnectHandler = () => void

const PING_INTERVAL = 30_000
const PONG_TIMEOUT = 10_000

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
  private reconnectAttempts = 0
  private shouldReconnect = true
  private _status: ConnectionStatus = 'disconnected'
  private _token: string | null = null
  private pendingQueue: ClientMessage[] = []
  private _tokenRefresher: (() => Promise<string | null>) | null = null
  private _connecting = false
  private _boundOnline: (() => void) | null = null
  private _boundOffline: (() => void) | null = null

  /** Register a callback that refreshes the access token before reconnecting. */
  setTokenRefresher(fn: () => Promise<string | null>) {
    this._tokenRefresher = fn
  }

  get status(): ConnectionStatus {
    return this._status
  }

  /** Keep the stored token in sync when the API layer refreshes it */
  updateToken(token: string) {
    this._token = token
  }

  private setStatus(status: ConnectionStatus) {
    if (this._status === status) return
    this._status = status
    for (const handler of this.statusHandlers) {
      handler(status)
    }
  }

  connect(token: string) {
    // Guard against concurrent connect() calls (e.g. rapid reconnect + manual reconnect)
    if (this._connecting) return
    this._connecting = true
    this._token = token
    this.shouldReconnect = true
    // Clear any pending reconnect timer to prevent concurrent connections
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // Clean up old WebSocket before creating new one to prevent orphaned connections
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
      this.ws = null
    }
    this.listenNetwork()
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws/client`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._connecting = false
      this.reconnectInterval = 1000
      this.reconnectAttempts = 0
      // Use this._token (not the closure 'token') so that if updateToken() was called
      // between connect() and the WebSocket opening, the freshest token is used.
      this.send({ type: 'client:auth', token: this._token ?? token })
      this.setStatus('connected')
      this.startHeartbeat()
      // Queue flush and reconnect handlers are deferred until server:auth_result
    }

    this.ws.onmessage = (evt) => {
      try {
        const raw = JSON.parse(evt.data)
        const parsed = serverMessageSchema.safeParse(raw)
        if (!parsed.success) {
          console.warn('[WS] Invalid server message, skipping:', parsed.error.issues)
          window.dispatchEvent(new CustomEvent('ws:validation_error', { detail: { raw } }))
          return
        }
        const msg: ServerMessage = parsed.data
        if (msg.type === 'server:pong') {
          this.clearPongTimeout()
          return
        }
        // Defer queue flush and reconnect handlers until auth succeeds
        if (msg.type === 'server:auth_result' && msg.ok) {
          this.flushQueue()
          if (this.wasConnected) {
            for (const handler of this.reconnectHandlers) {
              handler()
            }
          }
          this.wasConnected = true
        }
        for (const handler of this.handlers) {
          handler(msg)
        }
      } catch {
        // Ignore parse errors
      }
    }

    this.ws.onclose = () => {
      this._connecting = false
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
    this.unlistenNetwork()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this._token = null
    this.pendingQueue.length = 0
    this.setStatus('disconnected')
    // NOTE: Do NOT clear handler sets here — useWebSocket registers handlers
    // once at mount time and relies on them surviving disconnect/reconnect cycles.
    // The useEffect cleanup (unsub callbacks) handles deregistration properly.
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg))
      } catch {
        // Send failed — queue for retry on reconnect
        if (msg.type !== 'client:auth' && msg.type !== 'client:ping') {
          if (this.pendingQueue.length < MAX_WS_QUEUE_SIZE) {
            this.pendingQueue.push(msg)
          }
        }
        return
      }
    } else if (msg.type !== 'client:auth' && msg.type !== 'client:ping') {
      // Queue non-auth, non-ping messages for replay on reconnect
      if (this.pendingQueue.length < MAX_WS_QUEUE_SIZE) {
        this.pendingQueue.push(msg)
      } else {
        console.warn('[WS] Send queue full, message may be lost. Please check your connection.')
        window.dispatchEvent(new CustomEvent('ws:queue_full', { detail: { type: msg.type } }))
      }
    }
  }

  private flushQueue() {
    if (this.pendingQueue.length === 0) return
    const count = this.pendingQueue.length
    const queue = this.pendingQueue.splice(0)
    // eslint-disable-next-line no-console -- useful reconnect diagnostic
    console.info(`[WS] Flushing ${count} pending message(s) after reconnect`)
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

  /** Manually retry connection after max reconnect attempts were exhausted. */
  reconnect() {
    if (!this._token) return
    this.reconnectAttempts = 0
    this.reconnectInterval = 1000
    this.shouldReconnect = true
    this.connect(this._token)
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.clearPongTimeout()
        try {
          this.ws.send(JSON.stringify({ type: 'client:ping', ts: Date.now() }))
        } catch {
          return
        }
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
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[WS] Max reconnect attempts reached, giving up')
      this.setStatus('disconnected')
      return
    }
    this.reconnectAttempts++
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(async () => {
      // Try to refresh the token before reconnecting (it may have expired during disconnect)
      if (this._tokenRefresher) {
        try {
          const freshToken = await this._tokenRefresher()
          if (freshToken) {
            this._token = freshToken
          } else {
            // Token refresh returned null — session is expired, stop reconnecting
            this._token = null
            this.shouldReconnect = false
            this.setStatus('disconnected')
            return
          }
        } catch {
          // Transient network error — retry with existing token if available
          if (!this._token) {
            this.setStatus('disconnected')
            return
          }
        }
      }
      if (this._token) this.connect(this._token)
    }, this.reconnectInterval)
    this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, 15000)
  }

  /** Register browser online/offline listeners to accelerate reconnection */
  private listenNetwork() {
    if (this._boundOnline) return
    this._boundOnline = () => {
      if (this.shouldReconnect && this._token && !this.connected) {
        // Reset backoff so reconnection is immediate
        this.reconnectInterval = 1000
        this.reconnectAttempts = 0
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
        this.scheduleReconnect()
      }
    }
    this._boundOffline = () => {
      if (this.connected) {
        this.setStatus('reconnecting')
        this.stopHeartbeat()
        this.ws?.close()
      }
    }
    window.addEventListener('online', this._boundOnline)
    window.addEventListener('offline', this._boundOffline)
  }

  private unlistenNetwork() {
    if (this._boundOnline) {
      window.removeEventListener('online', this._boundOnline)
      this._boundOnline = null
    }
    if (this._boundOffline) {
      window.removeEventListener('offline', this._boundOffline)
      this._boundOffline = null
    }
  }
}

export const wsClient = new WsClient()
