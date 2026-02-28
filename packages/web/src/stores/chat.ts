import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Room, RoomMember, Message, MessageReaction, ParsedChunk } from '@agentim/shared'
import { MAX_CACHED_ROOMS } from '@agentim/shared'
import { api, getThread } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'
import { useAuthStore } from './auth.js'
import { useAgentStore } from './agents.js'
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
  replaceOptimisticMessage: (message: Message) => boolean
  addStreamChunk: (
    roomId: string,
    agentId: string,
    agentName: string,
    messageId: string,
    chunk: ParsedChunk,
  ) => { truncated: boolean }
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

// LRU tracking for thread cache eviction
const _threadAccessTimes = new Map<string, number>()

// LRU tracking for cross-room message cache eviction
const _roomAccessTimes = new Map<string, number>()

// Disable IDB writes after QuotaExceededError to avoid repeated failures
let _idbDisabled = false

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
    _roomAccessTimes.set(roomId, Date.now())
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
        let combined: Message[]
        if (cursor) {
          combined = [...newMsgs, ...existing]
        } else {
          // Server data takes precedence, but preserve any WS messages that
          // arrived after the server snapshot to prevent message loss on refresh
          const serverIds = new Set(newMsgs.map((m) => m.id))
          const serverNewest = newMsgs[newMsgs.length - 1]?.createdAt ?? ''
          const wsOnlyMsgs = existing.filter(
            (m) => m.createdAt >= serverNewest && !serverIds.has(m.id),
          )
          combined = [...newMsgs, ...wsOnlyMsgs]
        }
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
        // Evict least-recently-accessed rooms when cache exceeds threshold
        if (msgs.size > MAX_CACHED_ROOMS) {
          let lruKey: string | null = null
          let lruTime = Infinity
          for (const key of msgs.keys()) {
            if (key === roomId) continue // Don't evict current room
            const t = _roomAccessTimes.get(key) ?? 0
            if (t < lruTime) {
              lruTime = t
              lruKey = key
            }
          }
          if (lruKey) {
            msgs.delete(lruKey)
            _roomAccessTimes.delete(lruKey)
          }
        }

        _roomAccessTimes.set(roomId, Date.now())
        set({ messages: msgs, hasMore, lastMessages, showingCachedMessages: false })

        // Write back to IndexedDB (first page only)
        if (!cursor && !_idbDisabled) {
          setCachedMessages(roomId, combined).catch((err) => {
            if (err instanceof DOMException && err.name === 'QuotaExceededError') {
              console.warn(
                '[IDB QuotaExceeded] setCachedMessages failed, disabling IDB writes',
                err,
              )
              _idbDisabled = true
            } else {
              console.warn('[IDB] setCachedMessages failed', err)
            }
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

      // Optimistic update: show user message immediately before server echo
      const currentUser = useAuthStore.getState().user
      if (currentUser) {
        const optimisticMsg: Message = {
          id: `optimistic-${nanoid()}`,
          roomId,
          senderId: currentUser.id,
          senderType: 'user',
          senderName: currentUser.displayName || currentUser.username,
          type: 'text',
          content,
          mentions: mentions || [],
          replyToId: replyTo?.id,
          attachments: [],
          createdAt: new Date().toISOString(),
        }
        get().addMessage(optimisticMsg)
      }
    }

    if (replyTo) set({ replyTo: null })
  },

  addMessage: (message) => {
    const MAX_CACHED_MESSAGES = 1000
    _roomAccessTimes.set(message.roomId, Date.now())
    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(message.roomId) ?? []
    // Dedup: skip if message already exists (race between WS and REST)
    if (roomMsgs.length > 0) {
      const existingIds = new Set(roomMsgs.map((m) => m.id))
      if (existingIds.has(message.id)) return
    }
    let updated = [...roomMsgs, message]
    updated.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
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

    // If this is an agent message, clean up any lingering streaming state
    // (handles the case where server:message_complete was missed)
    const streamKey = `${message.roomId}:${message.senderId}`
    const streaming = get().streaming
    if (message.senderType === 'agent' && streaming.has(streamKey)) {
      const nextStreaming = new Map(streaming)
      nextStreaming.delete(streamKey)
      set({ messages: msgs, lastMessages, unreadCounts, streaming: nextStreaming })
    } else {
      set({ messages: msgs, lastMessages, unreadCounts })
    }

    if (!_idbDisabled) {
      addCachedMessage(message).catch((err) => {
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          console.warn('[IDB QuotaExceeded] addCachedMessage failed, disabling IDB writes', err)
          _idbDisabled = true
        } else {
          console.warn('[IDB] addCachedMessage failed', err)
        }
      })
    }
  },

  replaceOptimisticMessage: (message) => {
    const msgs = get().messages
    const roomMsgs = msgs.get(message.roomId)
    if (!roomMsgs) return false

    // Check if the real message already exists (from sync/load)
    const hasReal = roomMsgs.some((m) => m.id === message.id)

    // Find an optimistic message with matching sender + content + close timestamp
    const optimisticIdx = roomMsgs.findIndex(
      (m) =>
        m.id.startsWith('optimistic-') &&
        m.senderId === message.senderId &&
        m.content === message.content &&
        Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 10_000,
    )

    if (optimisticIdx < 0 && !hasReal) return false

    const updated = [...roomMsgs]
    if (optimisticIdx >= 0) {
      if (hasReal) {
        // Both exist — remove the optimistic duplicate
        updated.splice(optimisticIdx, 1)
      } else {
        // Normal case — replace optimistic with real
        updated[optimisticIdx] = message
      }
    }
    // If only hasReal (no optimistic), nothing to do — return true to skip addMessage
    const next = new Map(msgs)
    next.set(message.roomId, updated)
    set({ messages: next })
    return true
  },

  addStreamChunk: (roomId, agentId, agentName, messageId, chunk) => {
    const { streaming, truncated } = addStreamChunkAction(
      get().streaming,
      roomId,
      agentId,
      agentName,
      messageId,
      chunk,
    )
    set({ streaming })
    return { truncated }
  },

  completeStream: (message) => {
    const MAX_CACHED_MESSAGES = 1000
    const streamKey = `${message.roomId}:${message.senderId}`
    const streamEntry = get().streaming.get(streamKey)
    // Preserve streaming chunks if the completed message doesn't have them
    if (streamEntry?.chunks?.length && !message.chunks?.length) {
      message = { ...message, chunks: streamEntry.chunks }
    }

    const msgs = new Map(get().messages)
    const roomMsgs = msgs.get(message.roomId) ?? []

    // Add-or-update: if message exists, update it; if not, add it
    const existingIdx = roomMsgs.findIndex((m) => m.id === message.id)
    if (existingIdx >= 0) {
      const updated = [...roomMsgs]
      updated[existingIdx] = message
      msgs.set(message.roomId, updated)
    } else {
      let updated = [...roomMsgs, message]
      updated.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      if (updated.length > MAX_CACHED_MESSAGES) {
        updated = updated.slice(-MAX_CACHED_MESSAGES)
      }
      msgs.set(message.roomId, updated)
    }

    _roomAccessTimes.set(message.roomId, Date.now())

    const lastMessages = new Map(get().lastMessages)
    lastMessages.set(message.roomId, {
      content: message.content,
      senderName: message.senderName,
      createdAt: message.createdAt,
    })

    const unreadCounts = new Map(get().unreadCounts)
    if (message.roomId !== get().currentRoomId) {
      unreadCounts.set(message.roomId, (unreadCounts.get(message.roomId) || 0) + 1)
    }

    // Atomic: update messages AND remove streaming entry in single set()
    const nextStreaming = completeStreamAction(get().streaming, message)
    set({ messages: msgs, lastMessages, unreadCounts, streaming: nextStreaming })

    // IDB cache
    if (!_idbDisabled) {
      addCachedMessage(message).catch((err) => {
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          console.warn('[IDB QuotaExceeded] addCachedMessage failed, disabling IDB writes', err)
          _idbDisabled = true
        } else {
          console.warn('[IDB] addCachedMessage failed', err)
        }
      })
    }
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
    // Build set of online/busy agent IDs so we don't prematurely clean up
    // streams for agents that are still working (e.g. waiting for CI/builds).
    const onlineAgentIds = new Set(
      useAgentStore
        .getState()
        .agents.filter((a) => a.status === 'online' || a.status === 'busy')
        .map((a) => a.id),
    )
    const result = cleanupStaleStreamsAction(get().streaming, onlineAgentIds)
    if (!result) return
    set({ streaming: result.next })
    for (const stale of result.stale) {
      get()
        .syncMissedMessages(stale.roomId)
        .catch(() => {})
    }
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
      _threadAccessTimes.set(messageId, Date.now())
      set((state) => {
        const threadMessages = new Map(state.threadMessages)
        threadMessages.set(messageId, replies)
        // Cap thread cache with LRU eviction to prevent unbounded memory growth
        const MAX_CACHED_THREADS = 50
        if (threadMessages.size > MAX_CACHED_THREADS) {
          let lruKey: string | null = null
          let lruTime = Infinity
          for (const key of threadMessages.keys()) {
            const accessTime = _threadAccessTimes.get(key) ?? 0
            if (accessTime < lruTime) {
              lruTime = accessTime
              lruKey = key
            }
          }
          if (lruKey) {
            threadMessages.delete(lruKey)
            _threadAccessTimes.delete(lruKey)
          }
        }
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
    const userId = useAuthStore.getState().user?.id
    for (const msg of pending) {
      // Dedup: skip if a message with matching content from the same sender
      // was already delivered within a generous time window.
      const roomMsgs = currentMessages.get(msg.roomId) ?? []
      const alreadyDelivered = roomMsgs.some(
        (m) =>
          m.content === msg.content &&
          m.senderId === userId &&
          Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 10_000,
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

    _threadAccessTimes.clear()
    _roomAccessTimes.clear()
    _idbDisabled = false

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
        await get().loadMessages(roomId)
        return
      }

      const params = new URLSearchParams({ after: lastMsg.createdAt, limit: '100' })
      const res = await api.get<{ items: Message[]; hasMore: boolean }>(
        `/messages/rooms/${roomId}?${params}`,
      )
      if (res.ok && res.data && res.data.items.length > 0) {
        const newMsgs = res.data.items.reverse()
        // Re-read CURRENT state after await to avoid TOCTOU race —
        // completeStream() may have added messages during the fetch.
        const current = get().messages.get(roomId) ?? []
        const currentIds = new Set(current.map((m) => m.id))
        const unique = newMsgs.filter((m) => !currentIds.has(m.id))
        if (unique.length > 0) {
          const msgs = new Map(get().messages)
          const combined = [...current, ...unique]
          combined.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
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
