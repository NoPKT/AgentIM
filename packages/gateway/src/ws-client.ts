import WebSocket from 'ws'
import type { GatewayMessage, ServerGatewayMessage, ServerSendToAgent } from '@agentim/shared'
import { createLogger } from './lib/logger.js'

const log = createLogger('Gateway')

type MessageHandler = (msg: ServerGatewayMessage | ServerSendToAgent) => void
type TokenRefresher = () => Promise<string>

const PING_INTERVAL = 30_000 // Send ping every 30s
const PONG_TIMEOUT = 10_000 // Wait 10s for pong before considering connection dead
const MAX_QUEUE_SIZE = 1000
const MAX_RECONNECT_ATTEMPTS = 50

export class GatewayWsClient {
  private ws: WebSocket | null = null
  private url: string
  private reconnectInterval = 3000
  private maxReconnectInterval = 30000
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private onMessage: MessageHandler
  private onConnected: () => void
  private onDisconnected: () => void
  private onAuthFailed: (() => Promise<void>) | null = null
  private shouldReconnect = true
  private connecting = false // Prevent concurrent connect attempts
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
    if (this.connecting) return // Prevent concurrent connect attempts
    this.connecting = true
    this.shouldReconnect = true
    // Clean up old WebSocket before creating new one
    if (this.ws) {
      this.ws.removeAllListeners()
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.terminate()
      }
      this.ws = null
    }
    this.ws = new WebSocket(this.url)

    this.ws.on('open', () => {
      log.info('Connected to server')
      this.connecting = false
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
      } catch (err) {
        log.warn(`Failed to parse server message: ${(err as Error).message}`)
      }
    })

    this.ws.on('close', () => {
      log.warn('Disconnected from server')
      this.connecting = false
      this.stopHeartbeat()
      this.onDisconnected()
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      this.connecting = false
      log.error(`WebSocket error: ${err.message}`)
    })
  }

  send(msg: GatewayMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg))
      } catch (err) {
        log.warn(`Failed to send message: ${(err as Error).message}`)
        this.sendQueue.push(msg)
      }
    } else {
      if (this.sendQueue.length < MAX_QUEUE_SIZE) {
        this.sendQueue.push(msg)
      } else {
        // Prioritize critical messages: drop oldest non-critical messages to make room
        const critical = msg.type === 'gateway:auth' || msg.type === 'gateway:register_agent'
        if (critical) {
          // Drop the oldest non-critical message to make room
          const idx = this.sendQueue.findIndex(
            (m) => m.type !== 'gateway:auth' && m.type !== 'gateway:register_agent',
          )
          if (idx >= 0) {
            this.sendQueue.splice(idx, 1)
            this.sendQueue.push(msg)
          } else {
            log.warn('Send queue full (all critical), dropping message')
          }
        } else {
          log.warn(`Send queue full, dropping ${msg.type} message`)
        }
      }
    }
  }

  /** Flush queued messages (call after authentication succeeds) */
  flushQueue() {
    const toSend = [...this.sendQueue]
    this.sendQueue = []
    for (let i = 0; i < toSend.length; i++) {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        // Put remaining messages (including current) back in the queue
        this.sendQueue.unshift(...toSend.slice(i))
        return
      }
      try {
        this.ws.send(JSON.stringify(toSend[i]))
      } catch {
        // Put current and remaining messages back in the queue
        this.sendQueue.unshift(...toSend.slice(i))
        return
      }
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
        this.clearPongTimeout()
        try {
          this.ws.send(JSON.stringify({ type: 'gateway:ping', ts: Date.now() }))
        } catch {
          return
        }
        this.pongTimer = setTimeout(() => {
          log.warn('Pong timeout, reconnecting...')
          this.stopHeartbeat()
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
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`)
      this.onDisconnected()
      return
    }
    this.reconnectAttempts++
    const jitter = Math.random() * 1000
    if (this.reconnectAttempts % 10 === 0) {
      log.warn(`Still trying to reconnect... (${this.reconnectAttempts} attempts)`)
    }
    this.reconnectTimer = setTimeout(() => {
      log.info(`Reconnecting... (attempt ${this.reconnectAttempts})`)
      this.connect()
    }, this.reconnectInterval + jitter)
    this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, this.maxReconnectInterval)
  }
}
