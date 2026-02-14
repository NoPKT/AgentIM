import { create } from 'zustand'
import type { Room, RoomMember, Message, ParsedChunk } from '@agentim/shared'
import { api } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'

interface StreamingMessage {
  messageId: string
  agentId: string
  agentName: string
  chunks: ParsedChunk[]
}

interface LastMessageInfo {
  content: string
  senderName: string
  createdAt: string
}

// Persist lastReadAt to localStorage
const LAST_READ_KEY = 'agentim:lastReadAt'
function loadLastReadAt(): Map<string, string> {
  try {
    const raw = localStorage.getItem(LAST_READ_KEY)
    if (raw) return new Map(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Map()
}
function saveLastReadAt(map: Map<string, string>) {
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify([...map]))
  } catch { /* ignore */ }
}

interface ChatState {
  rooms: Room[]
  currentRoomId: string | null
  messages: Map<string, Message[]>
  streaming: Map<string, StreamingMessage>
  hasMore: Map<string, boolean>
  roomMembers: Map<string, RoomMember[]>
  lastMessages: Map<string, LastMessageInfo>
  unreadCounts: Map<string, number>
  lastReadAt: Map<string, string>
  loadRooms: () => Promise<void>
  setCurrentRoom: (roomId: string) => void
  loadMessages: (roomId: string, cursor?: string) => Promise<void>
  replyTo: Message | null
  setReplyTo: (message: Message | null) => void
  sendMessage: (roomId: string, content: string, mentions: string[]) => void
  addMessage: (message: Message) => void
  addStreamChunk: (roomId: string, agentId: string, agentName: string, messageId: string, chunk: ParsedChunk) => void
  completeStream: (message: Message) => void
  createRoom: (name: string, broadcastMode: boolean) => Promise<Room>
  loadRoomMembers: (roomId: string) => Promise<void>
  addRoomMember: (roomId: string, memberId: string, memberType: 'user' | 'agent') => Promise<void>
  removeRoomMember: (roomId: string, memberId: string) => Promise<void>
  updateRoom: (roomId: string, data: { name?: string; broadcastMode?: boolean }) => Promise<void>
  deleteRoom: (roomId: string) => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  rooms: [],
  currentRoomId: null,
  messages: new Map(),
  streaming: new Map(),
  hasMore: new Map(),
  roomMembers: new Map(),
  lastMessages: new Map(),
  unreadCounts: new Map(),
  replyTo: null,
  lastReadAt: loadLastReadAt(),

  setReplyTo: (message) => set({ replyTo: message }),

  loadRooms: async () => {
    const res = await api.get<Room[]>('/rooms')
    if (res.ok && res.data) {
      set({ rooms: res.data })
    }
    // Load last message for each room (for preview + sorting + unread calculation)
    const recentRes = await api.get<Record<string, LastMessageInfo>>('/messages/recent')
    if (recentRes.ok && recentRes.data) {
      const lastMessages = new Map(get().lastMessages)
      const unreadCounts = new Map(get().unreadCounts)
      const lastReadAt = get().lastReadAt
      for (const [roomId, info] of Object.entries(recentRes.data)) {
        lastMessages.set(roomId, info)
        // If this room has a message newer than lastReadAt, mark as unread
        const readAt = lastReadAt.get(roomId)
        if (!readAt || info.createdAt > readAt) {
          unreadCounts.set(roomId, (unreadCounts.get(roomId) || 0) || 1)
        }
      }
      set({ lastMessages, unreadCounts })
    }
  },

  setCurrentRoom: (roomId) => {
    const prev = get().currentRoomId
    if (prev) wsClient.send({ type: 'client:leave_room', roomId: prev })
    set({ currentRoomId: roomId })
    wsClient.send({ type: 'client:join_room', roomId })

    // Mark room as read
    const lastReadAt = new Map(get().lastReadAt)
    lastReadAt.set(roomId, new Date().toISOString())
    saveLastReadAt(lastReadAt)
    const unreadCounts = new Map(get().unreadCounts)
    unreadCounts.delete(roomId)
    set({ lastReadAt, unreadCounts })

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

      // Track last message for room list preview
      const lastMsg = combined[combined.length - 1]
      if (lastMsg) {
        const lastMessages = new Map(get().lastMessages)
        const existing = lastMessages.get(roomId)
        if (!existing || lastMsg.createdAt >= existing.createdAt) {
          lastMessages.set(roomId, {
            content: lastMsg.content,
            senderName: lastMsg.senderName,
            createdAt: lastMsg.createdAt,
          })
          set({ messages: msgs, hasMore, lastMessages })
          return
        }
      }
      set({ messages: msgs, hasMore })
    }
  },

  sendMessage: (roomId, content, mentions) => {
    const replyTo = get().replyTo
    wsClient.send({
      type: 'client:send_message',
      roomId,
      content,
      mentions,
      ...(replyTo ? { replyToId: replyTo.id } : {}),
    })
    if (replyTo) set({ replyTo: null })
  },

  addMessage: (message) => {
    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(message.roomId) ?? []
    msgs.set(message.roomId, [...roomMsgs, message])

    const lastMessages = new Map(get().lastMessages)
    lastMessages.set(message.roomId, {
      content: message.content,
      senderName: message.senderName,
      createdAt: message.createdAt,
    })

    // Increment unread count if message is not in the current room
    const unreadCounts = new Map(get().unreadCounts)
    if (message.roomId !== get().currentRoomId) {
      unreadCounts.set(message.roomId, (unreadCounts.get(message.roomId) || 0) + 1)
    }

    set({ messages: msgs, lastMessages, unreadCounts })
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

  createRoom: async (name, broadcastMode) => {
    const res = await api.post<Room>('/rooms', { name, type: 'group', broadcastMode })
    if (!res.ok || !res.data) throw new Error(res.error ?? 'Failed to create room')
    set({ rooms: [...get().rooms, res.data] })
    return res.data
  },

  loadRoomMembers: async (roomId) => {
    const res = await api.get<RoomMember[]>(`/rooms/${roomId}/members`)
    if (res.ok && res.data) {
      const members = new Map(get().roomMembers)
      members.set(roomId, res.data)
      set({ roomMembers: members })
    }
  },

  addRoomMember: async (roomId, memberId, memberType) => {
    const res = await api.post(`/rooms/${roomId}/members`, { memberId, memberType })
    if (!res.ok) throw new Error(res.error ?? 'Failed to add member')
    await get().loadRoomMembers(roomId)
  },

  removeRoomMember: async (roomId, memberId) => {
    const res = await api.delete(`/rooms/${roomId}/members/${memberId}`)
    if (!res.ok) throw new Error(res.error ?? 'Failed to remove member')
    await get().loadRoomMembers(roomId)
  },

  updateRoom: async (roomId, data) => {
    const res = await api.put<Room>(`/rooms/${roomId}`, data)
    if (!res.ok || !res.data) throw new Error(res.error ?? 'Failed to update room')
    set({
      rooms: get().rooms.map((r) => (r.id === roomId ? { ...r, ...res.data } : r)),
    })
  },

  deleteRoom: async (roomId) => {
    const res = await api.delete(`/rooms/${roomId}`)
    if (!res.ok) throw new Error(res.error ?? 'Failed to delete room')
    set({
      rooms: get().rooms.filter((r) => r.id !== roomId),
      currentRoomId: get().currentRoomId === roomId ? null : get().currentRoomId,
    })
  },
}))
