import type { ClientMessage, ServerMessage } from '@agentim/shared'

type MessageHandler = (msg: ServerMessage) => void

export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Set<MessageHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectInterval = 1000
  private shouldReconnect = true

  connect(token: string) {
    this.shouldReconnect = true
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws/client`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectInterval = 1000
      this.send({ type: 'client:auth', token })
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

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private scheduleReconnect(token: string) {
    if (!this.shouldReconnect) return
    this.reconnectTimer = setTimeout(() => {
      this.connect(token)
    }, this.reconnectInterval)
    this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, 15000)
  }
}

export const wsClient = new WsClient()
