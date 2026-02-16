import WebSocket from 'ws'
import type { GatewayMessage, ServerGatewayMessage, ServerSendToAgent } from '@agentim/shared'
import { createLogger } from './lib/logger.js'

const log = createLogger('Gateway')

type MessageHandler = (msg: ServerGatewayMessage | ServerSendToAgent) => void
type TokenRefresher = () => Promise<string>

const PING_INTERVAL = 30_000 // Send ping every 30s
const PONG_TIMEOUT = 10_000 // Wait 10s for pong before considering connection dead

export class GatewayWsClient {
  private ws: WebSocket | null = null
  private url: string
  private reconnectInterval = 3000
  private maxReconnectInterval = 30000
  private reconnectAttempts = 0
  private maxReconnectAttempts = 50
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private onMessage: MessageHandler
  private onConnected: () => void
  private onDisconnected: () => void
  private onAuthFailed: (() => Promise<void>) | null = null
  private shouldReconnect = true
  private sendQueue: GatewayMessage[] = []

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
      log.info('Connected to server')
      this.reconnectInterval = 3000
      this.reconnectAttempts = 0
      this.startHeartbeat()
      this.onConnected()
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'server:pong') {
          this.clearPongTimeout()
          return
        }
        this.onMessage(msg)
      } catch {
        // Ignore parse errors
      }
    })

    this.ws.on('close', () => {
      log.warn('Disconnected from server')
      this.stopHeartbeat()
      this.onDisconnected()
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      log.error(`WebSocket error: ${err.message}`)
    })
  }

  send(msg: GatewayMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.sendQueue.push(msg)
    }
  }

  /** Flush queued messages (call after authentication succeeds) */
  flushQueue() {
    while (this.sendQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.sendQueue.shift()!
      this.ws.send(JSON.stringify(msg))
    }
  }

  close() {
    this.shouldReconnect = false
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'gateway:ping', ts: Date.now() }))
        this.pongTimer = setTimeout(() => {
          log.warn('Pong timeout, reconnecting...')
          this.ws?.terminate()
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
    if (!this.shouldReconnect) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error(
        `Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`,
      )
      this.onDisconnected()
      return
    }
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      log.info(
        `Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
      )
      this.connect()
    }, this.reconnectInterval)
    this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, this.maxReconnectInterval)
  }
}
