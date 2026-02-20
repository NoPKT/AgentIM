import { create } from 'zustand'
import type { Room, RoomMember, Message, MessageReaction, ParsedChunk } from '@agentim/shared'
import { api } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'
import { useAuthStore } from './auth.js'
import { toast } from './toast.js'

interface StreamingMessage {
  messageId: string
  agentId: string
  agentName: string
  chunks: ParsedChunk[]
  lastChunkAt: number
}

interface LastMessageInfo {
  content: string
  senderName: string
  createdAt: string
}

interface TerminalBuffer {
  agentName: string
  lines: string[]
  /** Monotonic counter — total lines ever pushed (survives slice truncation). */
  totalPushed: number
}

interface ReadReceipt {
  userId: string
  username: string
  lastReadAt: string
}

interface ChatState {
  rooms: Room[]
  currentRoomId: string | null
  joinedRooms: Set<string>
  messages: Map<string, Message[]>
  streaming: Map<string, StreamingMessage>
  hasMore: Map<string, boolean>
  loadingMessages: Set<string>
  roomMembers: Map<string, RoomMember[]>
  lastMessages: Map<string, LastMessageInfo>
  unreadCounts: Map<string, number>
  terminalBuffers: Map<string, TerminalBuffer>
  onlineUsers: Set<string>
  readReceipts: Map<string, ReadReceipt[]>
  loadRooms: () => Promise<void>
  setCurrentRoom: (roomId: string) => void
  loadMessages: (roomId: string, cursor?: string) => Promise<void>
  replyTo: Message | null
  setReplyTo: (message: Message | null) => void
  typingUsers: Map<string, { username: string; expiresAt: number }>
  addTypingUser: (roomId: string, userId: string, username: string) => void
  clearExpiredTyping: () => void
  sendMessage: (
    roomId: string,
    content: string,
    mentions: string[],
    attachmentIds?: string[],
  ) => void
  addMessage: (message: Message) => void
  addStreamChunk: (
    roomId: string,
    agentId: string,
    agentName: string,
    messageId: string,
    chunk: ParsedChunk,
  ) => void
  completeStream: (message: Message) => void
  addTerminalData: (agentId: string, agentName: string, data: string) => void
  clearTerminalBuffer: (agentId: string) => void
  clearStreamingState: () => void
  cleanupStaleStreams: () => void
  setUserOnline: (userId: string, online: boolean) => void
  updateReadReceipt: (roomId: string, userId: string, username: string, lastReadAt: string) => void
  createRoom: (
    name: string,
    type: 'private' | 'group',
    broadcastMode: boolean,
    systemPrompt?: string,
    routerId?: string,
  ) => Promise<Room>
  loadRoomMembers: (roomId: string) => Promise<void>
  addRoomMember: (
    roomId: string,
    memberId: string,
    memberType: 'user' | 'agent',
    roleDescription?: string,
  ) => Promise<void>
  removeRoomMember: (roomId: string, memberId: string) => Promise<void>
  updateRoom: (
    roomId: string,
    data: {
      name?: string
      broadcastMode?: boolean
      systemPrompt?: string | null
      routerId?: string | null
    },
  ) => Promise<void>
  deleteRoom: (roomId: string) => Promise<void>
  editMessage: (messageId: string, content: string) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  toggleReaction: (messageId: string, emoji: string) => Promise<void>
  updateReactions: (roomId: string, messageId: string, reactions: MessageReaction[]) => void
  updateMessage: (message: Message) => void
  removeMessage: (roomId: string, messageId: string) => void
  syncMissedMessages: (roomId: string) => Promise<void>
  updateNotificationPref: (roomId: string, pref: 'all' | 'mentions' | 'none') => Promise<void>
  togglePin: (roomId: string) => Promise<void>
  toggleArchive: (roomId: string) => Promise<void>
  // Server-initiated eviction: clean up local state without an API call.
  evictRoom: (roomId: string) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  rooms: [],
  currentRoomId: null,
  joinedRooms: new Set(),
  messages: new Map(),
  streaming: new Map(),
  hasMore: new Map(),
  loadingMessages: new Set(),
  roomMembers: new Map(),
  lastMessages: new Map(),
  unreadCounts: new Map(),
  replyTo: null,
  typingUsers: new Map(),
  terminalBuffers: new Map(),
  onlineUsers: new Set(),
  readReceipts: new Map(),

  setReplyTo: (message) => set({ replyTo: message }),

  setUserOnline: (userId, online) => {
    const onlineUsers = new Set(get().onlineUsers)
    if (online) onlineUsers.add(userId)
    else onlineUsers.delete(userId)
    set({ onlineUsers })
  },

  updateReadReceipt: (roomId, userId, username, lastReadAt) => {
    const MAX_RECEIPTS_PER_ROOM = 100
    const readReceipts = new Map(get().readReceipts)
    const receipts = (readReceipts.get(roomId) ?? []).filter((r) => r.userId !== userId)
    receipts.push({ userId, username, lastReadAt })
    // Cap per-room receipts to prevent unbounded growth
    readReceipts.set(roomId, receipts.length > MAX_RECEIPTS_PER_ROOM ? receipts.slice(-MAX_RECEIPTS_PER_ROOM) : receipts)
    set({ readReceipts })
  },

  addTypingUser: (roomId, userId, username) => {
    const MAX_TYPING_ENTRIES = 500
    const key = `${roomId}:${userId}`
    const typingUsers = new Map(get().typingUsers)
    typingUsers.set(key, { username, expiresAt: Date.now() + 4000 })
    // Safety cap — clearExpiredTyping handles normal cleanup
    if (typingUsers.size > MAX_TYPING_ENTRIES) {
      const entries = [...typingUsers.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      const toKeep = entries.slice(-MAX_TYPING_ENTRIES)
      set({ typingUsers: new Map(toKeep) })
    } else {
      set({ typingUsers })
    }
  },

  clearExpiredTyping: () => {
    const now = Date.now()
    const typingUsers = new Map(get().typingUsers)
    let changed = false
    for (const [key, value] of typingUsers) {
      if (value.expiresAt < now) {
        typingUsers.delete(key)
        changed = true
      }
    }
    if (changed) set({ typingUsers })
  },

  loadRooms: async () => {
    try {
      const res = await api.get<Room[]>('/rooms')
      if (res.ok && res.data) {
        set({ rooms: res.data })
      }
      // Load last message + server-side unread counts for each room
      const recentRes =
        await api.get<Record<string, LastMessageInfo & { unread: number }>>('/messages/recent')
      if (recentRes.ok && recentRes.data) {
        const lastMessages = new Map(get().lastMessages)
        const unreadCounts = new Map(get().unreadCounts)
        for (const [roomId, info] of Object.entries(recentRes.data)) {
          lastMessages.set(roomId, {
            content: info.content,
            senderName: info.senderName,
            createdAt: info.createdAt,
          })
          if (info.unread > 0) {
            unreadCounts.set(roomId, info.unread)
          } else {
            unreadCounts.delete(roomId)
          }
        }
        set({ lastMessages, unreadCounts })
      }
    } catch {
      toast.error('Failed to load rooms')
    }
  },

  setCurrentRoom: (roomId) => {
    set({ currentRoomId: roomId })
    // Join the room if not already subscribed — keep previous rooms
    // subscribed so we receive real-time unread/notification updates.
    if (!get().joinedRooms.has(roomId)) {
      wsClient.send({ type: 'client:join_room', roomId })
      const joinedRooms = new Set(get().joinedRooms)
      joinedRooms.add(roomId)
      set({ joinedRooms })
    }

    // Mark room as read (optimistic + server sync)
    const unreadCounts = new Map(get().unreadCounts)
    unreadCounts.delete(roomId)
    set({ unreadCounts })
    api.post(`/messages/rooms/${roomId}/read`)

    if (!get().messages.has(roomId)) {
      get().loadMessages(roomId)
    }
  },

  loadMessages: async (roomId, cursor) => {
    // Prevent duplicate concurrent loads for the same room
    if (get().loadingMessages.has(roomId)) return
    const loadingMessages = new Set(get().loadingMessages)
    loadingMessages.add(roomId)
    set({ loadingMessages })

    try {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', '50')

      const res = await api.get<{ items: Message[]; nextCursor?: string; hasMore: boolean }>(
        `/messages/rooms/${roomId}?${params}`,
      )

      if (res.ok && res.data) {
        const existing = get().messages.get(roomId) ?? []
        // Messages come newest first, reverse for display
        const MAX_CACHED_MESSAGES = 1000
        const newMsgs = res.data.items.reverse()
        let combined = cursor ? [...newMsgs, ...existing] : newMsgs
        if (combined.length > MAX_CACHED_MESSAGES) {
          combined = combined.slice(-MAX_CACHED_MESSAGES)
        }
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
    } catch {
      toast.error('Failed to load messages')
    } finally {
      const loadingDone = new Set(get().loadingMessages)
      loadingDone.delete(roomId)
      set({ loadingMessages: loadingDone })
    }
  },

  sendMessage: (roomId, content, mentions, attachmentIds?) => {
    const replyTo = get().replyTo
    wsClient.send({
      type: 'client:send_message',
      roomId,
      content,
      mentions,
      ...(replyTo ? { replyToId: replyTo.id } : {}),
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
    })
    if (replyTo) set({ replyTo: null })
  },

  addMessage: (message) => {
    const MAX_CACHED_MESSAGES = 1000
    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(message.roomId) ?? []
    // Dedup: skip if message already exists (race between WS and REST)
    if (roomMsgs.some((m) => m.id === message.id)) return
    let updated = [...roomMsgs, message]
    if (updated.length > MAX_CACHED_MESSAGES) {
      updated = updated.slice(-MAX_CACHED_MESSAGES)
    }
    msgs.set(message.roomId, updated)

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
    const MAX_CHUNKS_PER_STREAM = 2000
    const streaming = new Map(get().streaming)
    const key = `${roomId}:${agentId}`
    const existing = streaming.get(key)
    const now = Date.now()
    if (existing) {
      const chunks = existing.chunks.length >= MAX_CHUNKS_PER_STREAM
        ? [...existing.chunks.slice(-MAX_CHUNKS_PER_STREAM + 1), chunk]
        : [...existing.chunks, chunk]
      streaming.set(key, { ...existing, chunks, lastChunkAt: now })
    } else {
      streaming.set(key, { messageId, agentId, agentName, chunks: [chunk], lastChunkAt: now })
    }
    set({ streaming })
  },

  completeStream: (message) => {
    // Add message first, then clean up streaming state
    // This ensures message is visible even if addMessage triggers re-renders
    get().addMessage(message)

    const streaming = new Map(get().streaming)
    const key = `${message.roomId}:${message.senderId}`
    streaming.delete(key)
    set({ streaming })
  },

  addTerminalData: (agentId, agentName, data) => {
    const MAX_TERMINAL_LINES = 500
    const terminalBuffers = new Map(get().terminalBuffers)
    const existing = terminalBuffers.get(agentId)
    if (existing) {
      const lines = [...existing.lines, data]
      terminalBuffers.set(agentId, {
        agentName,
        lines: lines.length > MAX_TERMINAL_LINES ? lines.slice(-MAX_TERMINAL_LINES) : lines,
        totalPushed: existing.totalPushed + 1,
      })
    } else {
      terminalBuffers.set(agentId, { agentName, lines: [data], totalPushed: 1 })
    }
    set({ terminalBuffers })
  },

  clearTerminalBuffer: (agentId) => {
    const terminalBuffers = new Map(get().terminalBuffers)
    terminalBuffers.delete(agentId)
    set({ terminalBuffers })
  },

  clearStreamingState: () => {
    set({ streaming: new Map(), terminalBuffers: new Map() })
  },

  cleanupStaleStreams: () => {
    const STALE_TIMEOUT = 120_000 // 2 minutes
    const now = Date.now()
    const streaming = new Map(get().streaming)
    let changed = false
    for (const [key, stream] of streaming) {
      if (now - stream.lastChunkAt > STALE_TIMEOUT) {
        streaming.delete(key)
        changed = true
      }
    }
    if (changed) set({ streaming })
  },

  createRoom: async (name, type, broadcastMode, systemPrompt?, routerId?) => {
    const body: Record<string, unknown> = { name, type, broadcastMode }
    if (systemPrompt) body.systemPrompt = systemPrompt
    if (routerId) body.routerId = routerId
    const res = await api.post<Room>('/rooms', body)
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

  addRoomMember: async (roomId, memberId, memberType, roleDescription?) => {
    const body: Record<string, unknown> = { memberId, memberType }
    if (roleDescription) body.roleDescription = roleDescription
    const res = await api.post(`/rooms/${roomId}/members`, body)
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

    // Clean up all Map/Set entries associated with this room
    const messages = new Map(get().messages)
    const roomMembers = new Map(get().roomMembers)
    const lastMessages = new Map(get().lastMessages)
    const unreadCounts = new Map(get().unreadCounts)
    const readReceipts = new Map(get().readReceipts)
    const hasMore = new Map(get().hasMore)
    const joinedRooms = new Set(get().joinedRooms)
    messages.delete(roomId)
    roomMembers.delete(roomId)
    lastMessages.delete(roomId)
    unreadCounts.delete(roomId)
    readReceipts.delete(roomId)
    hasMore.delete(roomId)
    joinedRooms.delete(roomId)

    // Clean up typing users for this room
    const typingUsers = new Map(get().typingUsers)
    for (const key of typingUsers.keys()) {
      if (key.startsWith(`${roomId}:`)) typingUsers.delete(key)
    }

    // Clean up streaming entries for this room
    const streaming = new Map(get().streaming)
    for (const key of streaming.keys()) {
      if (key.startsWith(`${roomId}:`)) streaming.delete(key)
    }

    // Clear replyTo if it references a message from the deleted room
    const replyTo = get().replyTo?.roomId === roomId ? null : get().replyTo

    set({
      rooms: get().rooms.filter((r) => r.id !== roomId),
      currentRoomId: get().currentRoomId === roomId ? null : get().currentRoomId,
      joinedRooms,
      messages,
      roomMembers,
      lastMessages,
      unreadCounts,
      readReceipts,
      hasMore,
      typingUsers,
      streaming,
      replyTo,
    })
  },

  editMessage: async (messageId, content) => {
    const res = await api.put<Message>(`/messages/${messageId}`, { content })
    if (!res.ok || !res.data) throw new Error(res.error ?? 'Failed to edit message')
    // The WS broadcast will handle UI update via updateMessage
  },

  deleteMessage: async (messageId) => {
    const res = await api.delete(`/messages/${messageId}`)
    if (!res.ok) throw new Error(res.error ?? 'Failed to delete message')
    // The WS broadcast will handle UI update via removeMessage
  },

  toggleReaction: async (messageId, emoji) => {
    try {
      const res = await api.post(`/messages/${messageId}/reactions`, { emoji })
      if (!res.ok) toast.error(res.error ?? 'Failed to toggle reaction')
    } catch {
      toast.error('Failed to toggle reaction')
    }
    // The WS broadcast will handle the UI update via updateReactions
  },

  updateReactions: (roomId, messageId, reactions) => {
    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(roomId)
    if (roomMsgs) {
      msgs.set(
        roomId,
        roomMsgs.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
      )
      set({ messages: msgs })
    }
  },

  updateMessage: (message) => {
    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(message.roomId)
    if (roomMsgs) {
      msgs.set(
        message.roomId,
        roomMsgs.map((m) => (m.id === message.id ? message : m)),
      )
      set({ messages: msgs })
    }
  },

  removeMessage: (roomId, messageId) => {
    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(roomId)
    if (roomMsgs) {
      msgs.set(
        roomId,
        roomMsgs.filter((m) => m.id !== messageId),
      )
      set({ messages: msgs })
    }
  },

  updateNotificationPref: async (roomId, pref) => {
    try {
      const res = await api.put(`/rooms/${roomId}/notification-pref`, { pref })
      if (res.ok) {
        // Update local member data
        const members = new Map(get().roomMembers)
        const list = members.get(roomId)
        if (list) {
          const userId = useAuthStore.getState().user?.id ?? null
          members.set(
            roomId,
            list.map((m) => (m.memberId === userId ? { ...m, notificationPref: pref } : m)),
          )
          set({ roomMembers: members })
        }
      } else {
        toast.error(res.error ?? 'Failed to update notification preference')
      }
    } catch {
      toast.error('Failed to update notification preference')
    }
  },

  togglePin: async (roomId) => {
    try {
      const res = await api.put<{ pinned: boolean }>(`/rooms/${roomId}/pin`)
      if (res.ok && res.data) {
        const members = new Map(get().roomMembers)
        const list = members.get(roomId)
        if (list) {
          const userId = useAuthStore.getState().user?.id ?? null
          members.set(
            roomId,
            list.map((m) =>
              m.memberId === userId
                ? { ...m, pinnedAt: res.data!.pinned ? new Date().toISOString() : undefined }
                : m,
            ),
          )
          set({ roomMembers: members })
        }
      }
    } catch {
      toast.error('Failed to toggle pin')
    }
  },

  evictRoom: (roomId) => {
    // Clean up all local state for a room we were server-evicted from.
    // This mirrors deleteRoom's cleanup but skips the API call.
    const state = get()
    const messages = new Map(state.messages)
    const roomMembers = new Map(state.roomMembers)
    const lastMessages = new Map(state.lastMessages)
    const unreadCounts = new Map(state.unreadCounts)
    const readReceipts = new Map(state.readReceipts)
    const hasMore = new Map(state.hasMore)
    const joinedRooms = new Set(state.joinedRooms)
    messages.delete(roomId)
    roomMembers.delete(roomId)
    lastMessages.delete(roomId)
    unreadCounts.delete(roomId)
    readReceipts.delete(roomId)
    hasMore.delete(roomId)
    joinedRooms.delete(roomId)

    const typingUsers = new Map(state.typingUsers)
    for (const key of typingUsers.keys()) {
      if (key.startsWith(`${roomId}:`)) typingUsers.delete(key)
    }

    const streaming = new Map(state.streaming)
    for (const key of streaming.keys()) {
      if (key.startsWith(`${roomId}:`)) streaming.delete(key)
    }

    const replyTo = state.replyTo?.roomId === roomId ? null : state.replyTo

    set({
      rooms: state.rooms.filter((r) => r.id !== roomId),
      currentRoomId: state.currentRoomId === roomId ? null : state.currentRoomId,
      joinedRooms,
      messages,
      roomMembers,
      lastMessages,
      unreadCounts,
      readReceipts,
      hasMore,
      typingUsers,
      streaming,
      replyTo,
    })
  },

  reset: () => {
    set({
      rooms: [],
      currentRoomId: null,
      joinedRooms: new Set(),
      messages: new Map(),
      streaming: new Map(),
      hasMore: new Map(),
      loadingMessages: new Set(),
      roomMembers: new Map(),
      lastMessages: new Map(),
      unreadCounts: new Map(),
      replyTo: null,
      typingUsers: new Map(),
      terminalBuffers: new Map(),
      onlineUsers: new Set(),
      readReceipts: new Map(),
    })
  },

  toggleArchive: async (roomId) => {
    try {
      const res = await api.put<{ archived: boolean }>(`/rooms/${roomId}/archive`)
      if (res.ok && res.data) {
        const members = new Map(get().roomMembers)
        const list = members.get(roomId)
        if (list) {
          const userId = useAuthStore.getState().user?.id ?? null
          members.set(
            roomId,
            list.map((m) =>
              m.memberId === userId
                ? { ...m, archivedAt: res.data!.archived ? new Date().toISOString() : undefined }
                : m,
            ),
          )
          set({ roomMembers: members })
        }
      }
    } catch {
      toast.error('Failed to toggle archive')
    }
  },

  syncMissedMessages: async (roomId) => {
    try {
      const existing = get().messages.get(roomId) ?? []
      const lastMsg = existing[existing.length - 1]
      if (!lastMsg) {
        // No messages loaded — do a full load
        await get().loadMessages(roomId)
        return
      }

      const params = new URLSearchParams({ after: lastMsg.createdAt, limit: '100' })
      const res = await api.get<{ items: Message[]; hasMore: boolean }>(
        `/messages/rooms/${roomId}?${params}`,
      )
      if (res.ok && res.data && res.data.items.length > 0) {
        const newMsgs = res.data.items.reverse()
        const existingIds = new Set(existing.map((m) => m.id))
        const unique = newMsgs.filter((m) => !existingIds.has(m.id))
        if (unique.length > 0) {
          const msgs = new Map(get().messages)
          const combined = [...existing, ...unique]
          combined.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          msgs.set(roomId, combined)
          set({ messages: msgs })
        }
      }
    } catch {
      // Silently fail for background sync
    }
  },
}))
