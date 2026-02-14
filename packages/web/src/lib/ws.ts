import type { ClientMessage, ServerMessage } from '@agentim/shared'

type MessageHandler = (msg: ServerMessage) => void
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'
type StatusHandler = (status: ConnectionStatus) => void

export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectInterval = 1000
  private shouldReconnect = true
  private _status: ConnectionStatus = 'disconnected'

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
    this.shouldReconnect = true
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws/client`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectInterval = 1000
      this.send({ type: 'client:auth', token })
      this.setStatus('connected')
    }

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as ServerMessage
        for (const handler of this.handlers) {
          handler(msg)
        }
      } catch {
        // Ignore parse errors
      }
    }

    this.ws.onclose = () => {
      this.scheduleReconnect(token)
    }

    this.ws.onerror = () => {
      // Will trigger onclose
    }
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.setStatus('disconnected')
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
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

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private scheduleReconnect(token: string) {
    if (!this.shouldReconnect) return
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.connect(token)
    }, this.reconnectInterval)
    this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, 15000)
  }
}

export const wsClient = new WsClient()
