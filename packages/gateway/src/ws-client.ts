import WebSocket from 'ws'
import type { GatewayMessage, ServerGatewayMessage, ServerSendToAgent } from '@agentim/shared'
import { serverGatewayMessageSchema } from '@agentim/shared'
import { createLogger } from './lib/logger.js'

const log = createLogger('Gateway')

type MessageHandler = (msg: ServerGatewayMessage | ServerSendToAgent) => void

const PING_INTERVAL = 30_000 // Send ping every 30s
const PONG_TIMEOUT = 10_000 // Wait 10s for pong before considering connection dead
const MAX_QUEUE_SIZE = 1000
const MAX_RECONNECT_ATTEMPTS = parseInt(process.env.AGENTIM_MAX_RECONNECT ?? '', 10) || 50
const PROBE_INTERVAL = parseInt(process.env.AGENTIM_PROBE_INTERVAL ?? '', 10) || 300_000 // 5 min

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
  private onDroppedMessage: ((msg: GatewayMessage) => void) | null = null
  private shouldReconnect = true
  private connecting = false // Prevent concurrent connect attempts
  private flushing = false
  private probing = false
  private pongTimeoutReconnect = false // Use fast reconnect after pong timeout
  private sendQueue: GatewayMessage[] = []

  constructor(opts: {
    url: string
    onMessage: MessageHandler
    onConnected: () => void
    onDisconnected: () => void
    onDroppedMessage?: (msg: GatewayMessage) => void
  }) {
    this.url = opts.url
    this.onMessage = opts.onMessage
    this.onConnected = opts.onConnected
    this.onDisconnected = opts.onDisconnected
    this.onDroppedMessage = opts.onDroppedMessage ?? null
  }

  connect() {
    if (this.connecting) return // Prevent concurrent connect attempts
    this.connecting = true
    this.shouldReconnect = true
    this.stopHeartbeat() // Prevent timer leaks from previous connection
    // Clean up old WebSocket before creating new one
    if (this.ws) {
      this.ws.removeAllListeners()
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'reconnecting')
      }
      this.ws = null
    }
    this.ws = new WebSocket(this.url)

    this.ws.on('open', () => {
      if (this.probing) {
        log.info('Probe succeeded, resuming normal mode')
        this.probing = false
      }
      log.info('Connected to server')
      this.connecting = false
      this.reconnectInterval = 3000
      this.reconnectAttempts = 0
      if (this.droppedCount > 0) {
        log.info(
          `Reconnected. Messages dropped during previous connection(s): ${this.droppedCount}`,
        )
      }
      this.startHeartbeat()
      this.onConnected()
    })

    this.ws.on('message', (data) => {
      try {
        const raw = JSON.parse(data.toString())
        const parsed = serverGatewayMessageSchema.safeParse(raw)
        if (!parsed.success) {
          log.warn(
            `Invalid server message (type=${raw?.type}), skipping: ${parsed.error.issues.map((i: { message: string }) => i.message).join(', ')}`,
          )
          return
        }
        if (parsed.data.type === 'server:pong') {
          this.clearPongTimeout()
          return
        }
        this.onMessage(parsed.data)
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

  private getMessagePriority(type: GatewayMessage['type']): 'critical' | 'high' | 'normal' {
    if (type === 'gateway:auth' || type === 'gateway:register_agent') return 'critical'
    if (
      type === 'gateway:message_chunk' ||
      type === 'gateway:message_complete' ||
      type === 'gateway:agent_status' ||
      type === 'gateway:permission_request'
    )
      return 'high'
    return 'normal'
  }

  private static readonly CRITICAL_DROP_TYPES = [
    'gateway:message_complete',
    'gateway:auth',
    'gateway:permission_request',
  ]

  private static readonly RETRY_ON_DROP_TYPES = new Set([
    'gateway:auth',
    'gateway:permission_request',
    'gateway:message_complete',
    'gateway:agent_status',
  ])

  private logDroppedMessage(msg: GatewayMessage): void {
    const msgType = msg.type ?? 'unknown'
    log.warn(
      `WebSocket message queue full (${this.sendQueue.length}), dropping message of type: ${msgType}`,
    )
    if (typeof msg.type === 'string' && GatewayWsClient.CRITICAL_DROP_TYPES.includes(msg.type)) {
      log.error(`Dropped critical message type "${msg.type}" due to queue overflow`)
    }
  }

  private droppedCount = 0
  // Track retry attempts by message type + timestamp to ensure reliable counting.
  // Using Map<string, number> instead of WeakMap<object> because WeakMap keys
  // can be garbage-collected when no strong references remain, losing retry state.
  private retryAttempts = new Map<string, number>()

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
        // Warn when queue reaches 75% capacity
        const threshold = Math.floor(MAX_QUEUE_SIZE * 0.75)
        if (this.sendQueue.length === threshold) {
          log.warn(
            `Message queue at 75% capacity (${threshold}/${MAX_QUEUE_SIZE}), messages may be dropped soon`,
          )
        }
      } else {
        const priority = this.getMessagePriority(msg.type)

        if (priority === 'critical') {
          // Drop the oldest non-critical message to make room
          const idx = this.sendQueue.findIndex((m) => this.getMessagePriority(m.type) === 'normal')
          if (idx >= 0) {
            const [dropped] = this.sendQueue.splice(idx, 1)
            this.droppedCount++
            this.logDroppedMessage(dropped)
            this.onDroppedMessage?.(dropped)
            this.sendQueue.push(msg)
          } else {
            // Try dropping oldest high-priority message
            const highIdx = this.sendQueue.findIndex(
              (m) => this.getMessagePriority(m.type) === 'high',
            )
            if (highIdx >= 0) {
              const [dropped] = this.sendQueue.splice(highIdx, 1)
              this.droppedCount++
              this.logDroppedMessage(dropped)
              this.onDroppedMessage?.(dropped)
              this.sendQueue.push(msg)
            } else {
              // Queue is full of critical messages; retry with exponential backoff
              const retryKey = `${msg.type}:${Date.now()}`
              const attempt = (this.retryAttempts.get(retryKey) ?? 0) + 1
              const MAX_RETRY = 5
              if (attempt > MAX_RETRY) {
                log.error(`Giving up on critical message after ${MAX_RETRY} retries`)
                this.droppedCount++
                this.retryAttempts.delete(retryKey)
                this.logDroppedMessage(msg)
                this.onDroppedMessage?.(msg)
              } else {
                this.retryAttempts.set(retryKey, attempt)
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000)
                log.warn(`Send queue full (all critical), retry #${attempt} in ${delay}ms`)
                setTimeout(() => {
                  this.retryAttempts.delete(retryKey)
                  this.send(msg)
                }, delay)
              }
            }
          }
        } else if (priority === 'high') {
          // Drop the oldest normal-priority message to make room
          const idx = this.sendQueue.findIndex((m) => this.getMessagePriority(m.type) === 'normal')
          if (idx >= 0) {
            const [dropped] = this.sendQueue.splice(idx, 1)
            this.droppedCount++
            this.logDroppedMessage(dropped)
            this.onDroppedMessage?.(dropped)
            this.sendQueue.push(msg)
          } else {
            this.droppedCount++
            this.logDroppedMessage(msg)
            this.onDroppedMessage?.(msg)
          }
        } else {
          // Normal priority — drop it, but retry if it's a critical type
          if (GatewayWsClient.RETRY_ON_DROP_TYPES.has(msg.type)) {
            const retryKey = `${msg.type}:${Date.now()}`
            const attempt = (this.retryAttempts.get(retryKey) ?? 0) + 1
            const MAX_RETRY = 5
            if (attempt > MAX_RETRY) {
              log.error(`Giving up on retryable message "${msg.type}" after ${MAX_RETRY} retries`)
              this.droppedCount++
              this.retryAttempts.delete(retryKey)
              this.logDroppedMessage(msg)
              this.onDroppedMessage?.(msg)
            } else {
              this.retryAttempts.set(retryKey, attempt)
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000)
              log.warn(`Retrying dropped message "${msg.type}", retry #${attempt} in ${delay}ms`)
              setTimeout(() => {
                this.retryAttempts.delete(retryKey)
                this.send(msg)
              }, delay)
            }
          } else {
            this.droppedCount++
            this.logDroppedMessage(msg)
            this.onDroppedMessage?.(msg)
          }
        }

        if (this.droppedCount > 0 && this.droppedCount % 10 === 0) {
          log.warn(`Total messages dropped due to full queue: ${this.droppedCount}`)
        }
      }
    }
  }

  /** Flush queued messages (call after authentication succeeds) */
  flushQueue() {
    if (this.flushing) return // Prevent concurrent flushes
    this.flushing = true
    try {
      // Drain the queue atomically: splice in place so that any messages
      // arriving during flush are appended *after* the batch we are sending.
      const toSend = this.sendQueue.splice(0)
      for (let i = 0; i < toSend.length; i++) {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          // Put remaining messages back at the *front* of the queue
          // (messages added during flush stay at the end, preserving order)
          this.sendQueue.unshift(...toSend.slice(i))
          return
        }
        try {
          this.ws.send(JSON.stringify(toSend[i]))
        } catch {
          this.sendQueue.unshift(...toSend.slice(i))
          return
        }
      }
    } finally {
      this.flushing = false
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
      // Note: .unref() called after assignment below
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.clearPongTimeout()
        try {
          this.ws.send(JSON.stringify({ type: 'gateway:ping', ts: Date.now() }))
        } catch (err) {
          log.warn(`Failed to send ping: ${(err as Error).message}, forcing reconnect`)
          this.stopHeartbeat()
          if (this.ws) {
            this.ws.removeAllListeners()
            this.ws.close(1006, 'ping failed')
            this.ws = null
          }
          this.onDisconnected()
          this.scheduleReconnect()
          return
        }
        this.pongTimer = setTimeout(() => {
          log.warn('Pong timeout, forcing reconnect...')
          this.stopHeartbeat()
          this.pongTimeoutReconnect = true
          if (this.ws) {
            this.ws.removeAllListeners()
            this.ws.close(1006, 'pong timeout')
            this.ws = null
          }
          this.onDisconnected()
          this.scheduleReconnect()
        }, PONG_TIMEOUT)
        this.pongTimer.unref()
      }
    }, PING_INTERVAL)
    // Allow process to exit even if heartbeat is still running
    this.pingTimer.unref()
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

    // Enter low-frequency probe mode after exhausting normal retries
    if (!this.probing && this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.probing = true
      log.warn(
        `Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, entering probe mode (every ${Math.round(PROBE_INTERVAL / 1000)}s)`,
      )
    }

    this.reconnectAttempts++

    // Fast reconnect after pong timeout to reduce "agent appears offline" window
    if (this.pongTimeoutReconnect) {
      this.pongTimeoutReconnect = false
      const delay = 1000 + Math.random() * 500
      log.info(`Fast reconnect after pong timeout in ${Math.round(delay)}ms`)
      this.reconnectTimer = setTimeout(() => {
        this.connect()
      }, delay)
      return
    }

    if (this.probing) {
      const jitter = Math.random() * PROBE_INTERVAL
      this.reconnectTimer = setTimeout(() => {
        log.info(`Probing server... (attempt ${this.reconnectAttempts})`)
        this.connect()
      }, PROBE_INTERVAL + jitter)
    } else {
      const jitter = Math.random() * this.reconnectInterval
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
}
