import WebSocket from 'ws'
import type { GatewayMessage, ServerGatewayMessage, ServerSendToAgent } from '@agentim/shared'

type MessageHandler = (msg: ServerGatewayMessage | ServerSendToAgent) => void
type TokenRefresher = () => Promise<string>

export class GatewayWsClient {
  private ws: WebSocket | null = null
  private url: string
  private reconnectInterval = 3000
  private maxReconnectInterval = 30000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private onMessage: MessageHandler
  private onConnected: () => void
  private onDisconnected: () => void
  private onAuthFailed: (() => Promise<void>) | null = null
  private shouldReconnect = true

  constructor(opts: {
    url: string
    onMessage: MessageHandler
    onConnected: () => void
    onDisconnected: () => void
    onAuthFailed?: () => Promise<void>
  }) {
    this.url = opts.url
    this.onMessage = opts.onMessage
    this.onConnected = opts.onConnected
    this.onDisconnected = opts.onDisconnected
    this.onAuthFailed = opts.onAuthFailed ?? null
  }

  connect() {
    this.shouldReconnect = true
    this.ws = new WebSocket(this.url)

    this.ws.on('open', () => {
      console.log('[Gateway] Connected to server')
      this.reconnectInterval = 3000
      this.onConnected()
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        this.onMessage(msg)
      } catch {
        // Ignore parse errors
      }
    })

    this.ws.on('close', () => {
      console.log('[Gateway] Disconnected from server')
      this.onDisconnected()
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      console.error('[Gateway] WebSocket error:', err.message)
    })
  }

  send(msg: GatewayMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  close() {
    this.shouldReconnect = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return
    this.reconnectTimer = setTimeout(() => {
      console.log('[Gateway] Reconnecting...')
      this.connect()
    }, this.reconnectInterval)
    this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, this.maxReconnectInterval)
  }
}
