import { create } from 'zustand'
import type { Room, Message, ParsedChunk } from '@agentim/shared'
import { api } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'

interface StreamingMessage {
  messageId: string
  agentId: string
  agentName: string
  chunks: ParsedChunk[]
}

interface ChatState {
  rooms: Room[]
  currentRoomId: string | null
  messages: Map<string, Message[]>
  streaming: Map<string, StreamingMessage>
  hasMore: Map<string, boolean>
  loadRooms: () => Promise<void>
  setCurrentRoom: (roomId: string) => void
  loadMessages: (roomId: string, cursor?: string) => Promise<void>
  sendMessage: (roomId: string, content: string, mentions: string[]) => void
  addMessage: (message: Message) => void
  addStreamChunk: (roomId: string, agentId: string, agentName: string, messageId: string, chunk: ParsedChunk) => void
  completeStream: (message: Message) => void
  createRoom: (name: string, type: string, broadcastMode: boolean) => Promise<Room>
}

export const useChatStore = create<ChatState>((set, get) => ({
  rooms: [],
  currentRoomId: null,
  messages: new Map(),
  streaming: new Map(),
  hasMore: new Map(),

  loadRooms: async () => {
    const res = await api.get<Room[]>('/rooms')
    if (res.ok && res.data) {
      set({ rooms: res.data })
    }
  },

  setCurrentRoom: (roomId) => {
    const prev = get().currentRoomId
    if (prev) wsClient.send({ type: 'client:leave_room', roomId: prev })
    set({ currentRoomId: roomId })
    wsClient.send({ type: 'client:join_room', roomId })
    if (!get().messages.has(roomId)) {
      get().loadMessages(roomId)
    }
  },

  loadMessages: async (roomId, cursor) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    params.set('limit', '50')

    const res = await api.get<{ items: Message[]; nextCursor?: string; hasMore: boolean }>(
      `/messages/rooms/${roomId}?${params}`,
    )
    if (res.ok && res.data) {
      const existing = get().messages.get(roomId) ?? []
      // Messages come newest first, reverse for display
      const newMsgs = res.data.items.reverse()
      const combined = cursor ? [...newMsgs, ...existing] : newMsgs
      const msgs = new Map(get().messages)
      msgs.set(roomId, combined)
      const hasMore = new Map(get().hasMore)
      hasMore.set(roomId, res.data.hasMore)
      set({ messages: msgs, hasMore })
    }
  },

  sendMessage: (roomId, content, mentions) => {
    wsClient.send({
      type: 'client:send_message',
      roomId,
      content,
      mentions,
    })
  },

  addMessage: (message) => {
    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(message.roomId) ?? []
    msgs.set(message.roomId, [...roomMsgs, message])
    set({ messages: msgs })
  },

  addStreamChunk: (roomId, agentId, agentName, messageId, chunk) => {
    const streaming = new Map(get().streaming)
    const key = `${roomId}:${agentId}`
    const existing = streaming.get(key)
    if (existing) {
      existing.chunks.push(chunk)
      streaming.set(key, { ...existing })
    } else {
      streaming.set(key, { messageId, agentId, agentName, chunks: [chunk] })
    }
    set({ streaming })
  },

  completeStream: (message) => {
    const streaming = new Map(get().streaming)
    const key = `${message.roomId}:${message.senderId}`
    streaming.delete(key)
    set({ streaming })

    get().addMessage(message)
  },

  createRoom: async (name, type, broadcastMode) => {
    const res = await api.post<Room>('/rooms', { name, type, broadcastMode })
    if (!res.ok || !res.data) throw new Error(res.error ?? 'Failed to create room')
    set({ rooms: [...get().rooms, res.data] })
    return res.data
  },
}))
