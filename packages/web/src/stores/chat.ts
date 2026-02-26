import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Room, RoomMember, Message, MessageReaction, ParsedChunk } from '@agentim/shared'
import { api, getThread } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'
import { useAuthStore } from './auth.js'
import { toast } from './toast.js'
import { registerStoreReset } from './reset.js'
import {
  getCachedMessages,
  setCachedMessages,
  addCachedMessage,
  updateCachedMessage,
  removeCachedMessage,
  getCachedRooms,
  setCachedRooms,
  getCachedRoomMeta,
  setCachedRoomMeta,
  clearRoomCache,
  clearCache,
  addPendingMessage,
  getPendingMessages,
  removePendingMessage,
  type PendingMessage,
} from '../lib/message-cache.js'
import {
  addStreamChunkAction,
  completeStreamAction,
  addTerminalDataAction,
  cleanupStaleStreamsAction,
  type StreamingMessage,
  type TerminalBuffer,
} from './chat-streaming.js'
import {
  addTypingUserAction,
  clearExpiredTypingAction,
  setUserOnlineAction,
  updateReadReceiptAction,
  selectTypingNamesFromState,
  type ReadReceipt,
} from './chat-presence.js'

interface LastMessageInfo {
  content: string
  senderName: string
  createdAt: string
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
  /** True when rooms are loaded from cache and server data has not yet arrived */
  showingCachedRooms: boolean
  /** True when messages are loaded from cache and server data has not yet arrived */
  showingCachedMessages: boolean
  /** Pending messages queued while offline */
  pendingMessages: PendingMessage[]
  /** Thread messages keyed by parent message ID */
  threadMessages: Map<string, Message[]>
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
      agentCommandRole?: 'member' | 'admin' | 'owner'
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
  /** Load thread replies for a message */
  loadThread: (messageId: string) => Promise<void>
  /** Flush pending messages queued while offline */
  flushPendingMessages: () => Promise<void>
  reset: () => void
}

// Guard to prevent concurrent loadRooms() calls (mirrors loadMessages dedup pattern)
let _loadingRooms = false

// Guards to prevent concurrent mutating API calls (e.g. rapid double-click)
const _pendingMutations = new Set<string>()

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
  showingCachedRooms: false,
  showingCachedMessages: false,
  pendingMessages: [],
  threadMessages: new Map(),

  setReplyTo: (message) => set({ replyTo: message }),

  setUserOnline: (userId, online) => {
    set({ onlineUsers: setUserOnlineAction(get().onlineUsers, userId, online) })
  },

  updateReadReceipt: (roomId, userId, username, lastReadAt) => {
    set({
      readReceipts: updateReadReceiptAction(
        get().readReceipts,
        roomId,
        userId,
        username,
        lastReadAt,
      ),
    })
  },

  addTypingUser: (roomId, userId, username) => {
    set({ typingUsers: addTypingUserAction(get().typingUsers, roomId, userId, username) })
  },

  clearExpiredTyping: () => {
    const result = clearExpiredTypingAction(get().typingUsers)
    if (result) set({ typingUsers: result })
  },

  loadRooms: async () => {
    // Prevent duplicate concurrent loads (e.g. rapid connect/disconnect)
    if (_loadingRooms) return
    _loadingRooms = true

    // Show cached data immediately while API loads
    const [cachedRooms, cachedMeta] = await Promise.all([getCachedRooms(), getCachedRoomMeta()])
    if (cachedRooms.length > 0) {
      const lastMessages = new Map(get().lastMessages)
      const unreadCounts = new Map(get().unreadCounts)
      for (const [roomId, meta] of cachedMeta) {
        lastMessages.set(roomId, meta.lastMessage)
        if (meta.unread > 0) unreadCounts.set(roomId, meta.unread)
      }
      set({ rooms: cachedRooms, lastMessages, unreadCounts, showingCachedRooms: true })
    }

    try {
      const res = await api.get<Room[]>('/rooms')
      if (res.ok && res.data) {
        set({ rooms: res.data, showingCachedRooms: false })
        setCachedRooms(res.data).catch((err) => {
          console.warn('[IDB] setCachedRooms failed', err)
        })
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
          setCachedRoomMeta(roomId, {
            lastMessage: {
              content: info.content,
              senderName: info.senderName,
              createdAt: info.createdAt,
            },
            unread: info.unread,
          }).catch((err) => {
            console.warn('[IDB] setCachedRoomMeta failed', err)
          })
        }
        set({ lastMessages, unreadCounts })
      }
    } catch {
      // Keep showing cached rooms if API fails (offline)
      if (get().rooms.length === 0) {
        toast.error('Failed to load rooms')
      }
    } finally {
      _loadingRooms = false
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

    // Show cached messages immediately (first load only, no cursor)
    if (!cursor) {
      const cached = await getCachedMessages(roomId)
      if (cached.length > 0 && !get().messages.has(roomId)) {
        const msgs = new Map(get().messages)
        msgs.set(roomId, cached)
        set({ messages: msgs, showingCachedMessages: true })
      }
    }

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
        const lastMessages = new Map(get().lastMessages)
        if (lastMsg) {
          const existingPreview = lastMessages.get(roomId)
          if (!existingPreview || lastMsg.createdAt >= existingPreview.createdAt) {
            lastMessages.set(roomId, {
              content: lastMsg.content,
              senderName: lastMsg.senderName,
              createdAt: lastMsg.createdAt,
            })
          }
        }
        set({ messages: msgs, hasMore, lastMessages, showingCachedMessages: false })

        // Write back to IndexedDB (first page only)
        if (!cursor) {
          setCachedMessages(roomId, combined).catch((err) => {
            const tag =
              err instanceof DOMException && err.name === 'QuotaExceededError'
                ? '[IDB QuotaExceeded]'
                : '[IDB]'
            console.warn(tag, 'setCachedMessages failed', err)
          })
        }
      }
    } catch {
      // Keep showing cached messages if API fails (offline)
      if (!get().messages.has(roomId) || (get().messages.get(roomId)?.length ?? 0) === 0) {
        toast.error('Failed to load messages')
      }
    } finally {
      const loadingDone = new Set(get().loadingMessages)
      loadingDone.delete(roomId)
      set({ loadingMessages: loadingDone })
    }
  },

  sendMessage: (roomId, content, mentions, attachmentIds?) => {
    const replyTo = get().replyTo
    const msg = {
      type: 'client:send_message' as const,
      roomId,
      content,
      mentions,
      ...(replyTo ? { replyToId: replyTo.id } : {}),
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
    }

    // If offline, only persist to IndexedDB — don't attempt WS send
    if (wsClient.status !== 'connected') {
      // Dedup: skip if an identical pending message already exists for this room
      const existingPending = get().pendingMessages
      const mentionKey = mentions?.slice().sort().join(',') ?? ''
      const attachKey = attachmentIds?.slice().sort().join(',') ?? ''
      const isDuplicate = existingPending.some(
        (p) =>
          p.roomId === roomId &&
          p.content === content &&
          (p.mentions?.slice().sort().join(',') ?? '') === mentionKey &&
          (p.attachmentIds?.slice().sort().join(',') ?? '') === attachKey &&
          (p.replyToId ?? '') === (replyTo?.id ?? ''),
      )
      if (!isDuplicate) {
        const pending: PendingMessage = {
          id: nanoid(),
          roomId,
          content,
          mentions,
          replyToId: replyTo?.id,
          attachmentIds,
          createdAt: new Date().toISOString(),
        }
        addPendingMessage(pending)
        set({ pendingMessages: [...existingPending, pending] })
      }
    } else {
      wsClient.send(msg)
    }

    if (replyTo) set({ replyTo: null })
  },

  addMessage: (message) => {
    const MAX_CACHED_MESSAGES = 1000
    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(message.roomId) ?? []
    // Dedup: skip if message already exists (race between WS and REST)
    if (roomMsgs.length > 0) {
      const existingIds = new Set(roomMsgs.map((m) => m.id))
      if (existingIds.has(message.id)) return
    }
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

    addCachedMessage(message).catch((err) => {
      const tag =
        err instanceof DOMException && err.name === 'QuotaExceededError'
          ? '[IDB QuotaExceeded]'
          : '[IDB]'
      console.warn(tag, 'addCachedMessage failed', err)
    })
  },

  addStreamChunk: (roomId, agentId, agentName, messageId, chunk) => {
    set({
      streaming: addStreamChunkAction(
        get().streaming,
        roomId,
        agentId,
        agentName,
        messageId,
        chunk,
      ),
    })
  },

  completeStream: (message) => {
    // Add message first, then clean up streaming state
    get().addMessage(message)
    set({ streaming: completeStreamAction(get().streaming, message) })
  },

  addTerminalData: (agentId, agentName, data) => {
    set({
      terminalBuffers: addTerminalDataAction(get().terminalBuffers, agentId, agentName, data),
    })
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
    const result = cleanupStaleStreamsAction(get().streaming)
    if (result) set({ streaming: result })
  },

  createRoom: async (name, type, broadcastMode, systemPrompt?, routerId?) => {
    const mutKey = `createRoom:${name}`
    if (_pendingMutations.has(mutKey)) throw new Error('Operation already in progress')
    _pendingMutations.add(mutKey)
    try {
      const body: Record<string, unknown> = { name, type, broadcastMode }
      if (systemPrompt) body.systemPrompt = systemPrompt
      if (routerId) body.routerId = routerId
      const res = await api.post<Room>('/rooms', body)
      if (!res.ok || !res.data) throw new Error(res.error ?? 'Failed to create room')
      set({ rooms: [...get().rooms, res.data] })
      return res.data
    } finally {
      _pendingMutations.delete(mutKey)
    }
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
    const mutKey = `addMember:${roomId}:${memberId}`
    if (_pendingMutations.has(mutKey)) throw new Error('Operation already in progress')
    _pendingMutations.add(mutKey)
    try {
      const body: Record<string, unknown> = { memberId, memberType }
      if (roleDescription) body.roleDescription = roleDescription
      const res = await api.post(`/rooms/${roomId}/members`, body)
      if (!res.ok) throw new Error(res.error ?? 'Failed to add member')
      await get().loadRoomMembers(roomId)
    } finally {
      _pendingMutations.delete(mutKey)
    }
  },

  removeRoomMember: async (roomId, memberId) => {
    const mutKey = `removeMember:${roomId}:${memberId}`
    if (_pendingMutations.has(mutKey)) throw new Error('Operation already in progress')
    _pendingMutations.add(mutKey)
    try {
      const res = await api.delete(`/rooms/${roomId}/members/${memberId}`)
      if (!res.ok) throw new Error(res.error ?? 'Failed to remove member')
      await get().loadRoomMembers(roomId)
    } finally {
      _pendingMutations.delete(mutKey)
    }
  },

  updateRoom: async (roomId, data) => {
    const mutKey = `updateRoom:${roomId}`
    if (_pendingMutations.has(mutKey)) throw new Error('Operation already in progress')
    _pendingMutations.add(mutKey)
    try {
      const res = await api.put<Room>(`/rooms/${roomId}`, data)
      if (!res.ok || !res.data) throw new Error(res.error ?? 'Failed to update room')
      set({
        rooms: get().rooms.map((r) => (r.id === roomId ? { ...r, ...res.data } : r)),
      })
    } finally {
      _pendingMutations.delete(mutKey)
    }
  },

  deleteRoom: async (roomId) => {
    const mutKey = `deleteRoom:${roomId}`
    if (_pendingMutations.has(mutKey)) throw new Error('Operation already in progress')
    _pendingMutations.add(mutKey)
    const res = await api.delete(`/rooms/${roomId}`)
    if (!res.ok) {
      _pendingMutations.delete(mutKey)
      throw new Error(res.error ?? 'Failed to delete room')
    }

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

    _pendingMutations.delete(mutKey)

    clearRoomCache(roomId).catch((err) => {
      console.warn('[IDB] clearRoomCache failed', err)
    })
  },

  editMessage: async (messageId, content) => {
    // Optimistic update: find message and update content immediately
    let prevMessage: Message | undefined
    let roomId: string | undefined
    const prevMessages = get().messages
    for (const [rid, msgs] of prevMessages) {
      const found = msgs.find((m) => m.id === messageId)
      if (found) {
        prevMessage = found
        roomId = rid
        break
      }
    }
    if (prevMessage && roomId) {
      const optimistic = new Map(prevMessages)
      optimistic.set(
        roomId,
        optimistic.get(roomId)!.map((m) => (m.id === messageId ? { ...m, content } : m)),
      )
      set({ messages: optimistic })
    }
    try {
      const res = await api.put<Message>(`/messages/${messageId}`, { content })
      if (!res.ok || !res.data) {
        // Revert on failure
        if (prevMessage) set({ messages: prevMessages })
        toast.error(res.error ?? 'Failed to edit message')
      }
    } catch {
      // Revert on error
      if (prevMessage) set({ messages: prevMessages })
      toast.error('Failed to edit message')
    }
  },

  deleteMessage: async (messageId) => {
    // Optimistic update: find and remove message immediately
    let prevMessage: Message | undefined
    let roomId: string | undefined
    const prevMessages = get().messages
    for (const [rid, msgs] of prevMessages) {
      const found = msgs.find((m) => m.id === messageId)
      if (found) {
        prevMessage = found
        roomId = rid
        break
      }
    }
    if (prevMessage && roomId) {
      const optimistic = new Map(prevMessages)
      optimistic.set(
        roomId,
        optimistic.get(roomId)!.filter((m) => m.id !== messageId),
      )
      set({ messages: optimistic })
    }
    try {
      const res = await api.delete(`/messages/${messageId}`)
      if (!res.ok) {
        // Revert on failure
        if (prevMessage) set({ messages: prevMessages })
        toast.error(res.error ?? 'Failed to delete message')
      }
    } catch {
      // Revert on error
      if (prevMessage) set({ messages: prevMessages })
      toast.error('Failed to delete message')
    }
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

    updateCachedMessage(message).catch((err) => {
      console.warn('[IDB] updateCachedMessage failed', err)
    })
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

    removeCachedMessage(roomId, messageId).catch((err) => {
      console.warn('[IDB] removeCachedMessage failed', err)
    })
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
    // Optimistic update: toggle pin state immediately before API call
    const userId = useAuthStore.getState().user?.id ?? null
    const prevMembers = get().roomMembers
    const list = prevMembers.get(roomId)
    if (list && userId) {
      const currentMember = list.find((m) => m.memberId === userId)
      const isPinned = !!currentMember?.pinnedAt
      const optimisticMembers = new Map(prevMembers)
      optimisticMembers.set(
        roomId,
        list.map((m) =>
          m.memberId === userId
            ? { ...m, pinnedAt: isPinned ? undefined : new Date().toISOString() }
            : m,
        ),
      )
      set({ roomMembers: optimisticMembers })
    }
    try {
      const res = await api.put<{ pinned: boolean }>(`/rooms/${roomId}/pin`)
      if (res.ok && res.data) {
        // Apply server-confirmed state
        const members = new Map(get().roomMembers)
        const currentList = members.get(roomId)
        if (currentList) {
          members.set(
            roomId,
            currentList.map((m) =>
              m.memberId === userId
                ? { ...m, pinnedAt: res.data!.pinned ? new Date().toISOString() : undefined }
                : m,
            ),
          )
          set({ roomMembers: members })
        }
      } else {
        // Revert on failure
        set({ roomMembers: prevMembers })
      }
    } catch {
      // Revert on error
      set({ roomMembers: prevMembers })
      toast.error('Failed to toggle pin')
    }
  },

  loadThread: async (messageId) => {
    try {
      const replies = await getThread(messageId)
      set((state) => {
        const threadMessages = new Map(state.threadMessages)
        threadMessages.set(messageId, replies)
        return { threadMessages }
      })
    } catch (err) {
      console.error('Failed to load thread:', err)
    }
  },

  flushPendingMessages: async () => {
    const pending = await getPendingMessages()
    if (pending.length === 0) return
    const currentMessages = get().messages
    for (const msg of pending) {
      // Dedup: skip if a message with matching content and close timestamp
      // was already delivered (use pending id as idempotency key).
      const roomMsgs = currentMessages.get(msg.roomId) ?? []
      const alreadyDelivered = roomMsgs.some(
        (m) =>
          m.content === msg.content &&
          m.senderType !== 'system' &&
          Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 5000,
      )
      if (!alreadyDelivered) {
        wsClient.send({
          type: 'client:send_message',
          roomId: msg.roomId,
          content: msg.content,
          mentions: msg.mentions,
          ...(msg.replyToId ? { replyToId: msg.replyToId } : {}),
          ...(msg.attachmentIds && msg.attachmentIds.length > 0
            ? { attachmentIds: msg.attachmentIds }
            : {}),
        })
      }
      await removePendingMessage(msg.id)
    }
    set({ pendingMessages: [] })
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

    clearRoomCache(roomId).catch((err) => {
      console.warn('[IDB] clearRoomCache failed', err)
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
      showingCachedRooms: false,
      showingCachedMessages: false,
      pendingMessages: [],
      threadMessages: new Map(),
    })

    clearCache().catch((err) => {
      console.warn('[IDB] clearCache failed', err)
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

registerStoreReset(() => useChatStore.getState().reset())

/**
 * Derive typing user names for a room, excluding the current user.
 * Returns a stable string[] — the result only changes when names actually differ.
 */
export function selectTypingNames(
  state: ChatState,
  roomId: string | null,
  excludeUserId: string | undefined,
): string[] {
  return selectTypingNamesFromState(state.typingUsers, roomId, excludeUserId)
}

// Re-export types so existing consumers don't need to update imports
export type { StreamingMessage, TerminalBuffer, ReadReceipt }
