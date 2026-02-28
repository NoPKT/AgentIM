import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Message, ParsedChunk, Room, RoomMember } from '@agentim/shared'
import { useChatStore, selectTypingNames } from './chat.js'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  getThread: vi.fn(),
  getReplyCount: vi.fn(),
}))

vi.mock('../lib/ws.js', () => ({
  wsClient: {
    send: vi.fn(),
    status: 'connected',
  },
}))

vi.mock('./auth.js', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 'user-1' } }),
  },
}))

vi.mock('./toast.js', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../lib/message-cache.js', () => ({
  getCachedMessages: vi.fn().mockResolvedValue([]),
  setCachedMessages: vi.fn().mockResolvedValue(undefined),
  addCachedMessage: vi.fn().mockResolvedValue(undefined),
  updateCachedMessage: vi.fn().mockResolvedValue(undefined),
  removeCachedMessage: vi.fn().mockResolvedValue(undefined),
  getCachedRooms: vi.fn().mockResolvedValue([]),
  setCachedRooms: vi.fn().mockResolvedValue(undefined),
  getCachedRoomMeta: vi.fn().mockResolvedValue(new Map()),
  setCachedRoomMeta: vi.fn().mockResolvedValue(undefined),
  clearRoomCache: vi.fn().mockResolvedValue(undefined),
  clearCache: vi.fn().mockResolvedValue(undefined),
  addPendingMessage: vi.fn().mockResolvedValue(undefined),
  getPendingMessages: vi.fn().mockResolvedValue([]),
  removePendingMessage: vi.fn().mockResolvedValue(undefined),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    roomId: 'room-1',
    senderId: 'user-1',
    senderType: 'user',
    senderName: 'Alice',
    type: 'text',
    content: 'Hello',
    createdAt: new Date().toISOString(),
    mentions: [],
    reactions: [],
    ...overrides,
  }
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    name: 'Test Room',
    type: 'group',
    broadcastMode: false,
    createdById: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeMember(overrides: Partial<RoomMember> = {}): RoomMember {
  return {
    roomId: 'room-1',
    memberId: 'user-1',
    memberType: 'user',
    role: 'owner',
    joinedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    vi.clearAllMocks()
  })

  // ── reset() ──────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('clears all state to initial values', () => {
      const store = useChatStore.getState()
      store.addMessage(makeMessage())
      store.reset()

      const state = useChatStore.getState()
      expect(state.rooms).toEqual([])
      expect(state.messages.size).toBe(0)
      expect(state.streaming.size).toBe(0)
      expect(state.currentRoomId).toBeNull()
      expect(state.replyTo).toBeNull()
      expect(state.onlineUsers.size).toBe(0)
      expect(state.readReceipts.size).toBe(0)
    })

    it('clears pending messages', () => {
      useChatStore.setState({ pendingMessages: [{ id: 'p1' } as any] })
      useChatStore.getState().reset()
      expect(useChatStore.getState().pendingMessages).toEqual([])
    })

    it('clears thread messages', () => {
      useChatStore.setState({
        threadMessages: new Map([['msg-1', [makeMessage()]]]),
      })
      useChatStore.getState().reset()
      expect(useChatStore.getState().threadMessages.size).toBe(0)
    })
  })

  // ── addMessage() ──────────────────────────────────────────────────────────

  describe('addMessage()', () => {
    it('adds a message to the correct room', () => {
      useChatStore.getState().addMessage(makeMessage())
      const msgs = useChatStore.getState().messages.get('room-1')
      expect(msgs).toHaveLength(1)
      expect(msgs![0].id).toBe('msg-1')
    })

    it('deduplicates messages with the same id', () => {
      const msg = makeMessage()
      useChatStore.getState().addMessage(msg)
      useChatStore.getState().addMessage(msg)
      const msgs = useChatStore.getState().messages.get('room-1')
      expect(msgs).toHaveLength(1)
    })

    it('updates lastMessages after adding', () => {
      useChatStore.getState().addMessage(makeMessage({ content: 'Hi there' }))
      const last = useChatStore.getState().lastMessages.get('room-1')
      expect(last?.content).toBe('Hi there')
    })

    it('increments unread count for non-current room', () => {
      // room-1 is not the current room
      useChatStore.getState().addMessage(makeMessage())
      expect(useChatStore.getState().unreadCounts.get('room-1')).toBe(1)

      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2' }))
      expect(useChatStore.getState().unreadCounts.get('room-1')).toBe(2)
    })

    it('does not increment unread count for current room', () => {
      // Navigate to room-1 so it's the current room
      useChatStore.setState({ currentRoomId: 'room-1' })
      useChatStore.getState().addMessage(makeMessage())
      expect(useChatStore.getState().unreadCounts.get('room-1')).toBeUndefined()
    })

    it('caps messages at MAX_CACHED_MESSAGES (1000)', () => {
      // Pre-fill with 999 messages
      const existing: Message[] = Array.from({ length: 999 }, (_, i) =>
        makeMessage({ id: `old-${i}`, content: `msg ${i}` }),
      )
      useChatStore.setState({ messages: new Map([['room-1', existing]]) })

      // Add one more — total 1000, should not truncate yet
      useChatStore.getState().addMessage(makeMessage({ id: 'new-1' }))
      expect(useChatStore.getState().messages.get('room-1')).toHaveLength(1000)

      // Add another — total would be 1001, should truncate to 1000
      useChatStore.getState().addMessage(makeMessage({ id: 'new-2' }))
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs.length).toBe(1000)
      // Oldest message should have been evicted
      expect(msgs.find((m) => m.id === 'old-0')).toBeUndefined()
    })

    it('tracks senderName in lastMessages', () => {
      useChatStore.getState().addMessage(makeMessage({ senderName: 'Bob' }))
      const last = useChatStore.getState().lastMessages.get('room-1')
      expect(last?.senderName).toBe('Bob')
    })

    it('adds messages to different rooms independently', () => {
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1', roomId: 'room-1' }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2', roomId: 'room-2' }))
      expect(useChatStore.getState().messages.get('room-1')).toHaveLength(1)
      expect(useChatStore.getState().messages.get('room-2')).toHaveLength(1)
    })
  })

  // ── updateMessage() ───────────────────────────────────────────────────────

  describe('updateMessage()', () => {
    it('replaces an existing message in place', () => {
      useChatStore.getState().addMessage(makeMessage({ content: 'original' }))
      useChatStore.getState().updateMessage(makeMessage({ content: 'edited' }))
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs[0].content).toBe('edited')
    })

    it('is a no-op if the message does not exist', () => {
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1' }))
      // updateMessage for a different id should not throw or change anything
      useChatStore.getState().updateMessage(makeMessage({ id: 'msg-999', content: 'ghost' }))
      expect(useChatStore.getState().messages.get('room-1')).toHaveLength(1)
    })

    it('preserves other messages in the same room', () => {
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1', content: 'first' }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2', content: 'second' }))
      useChatStore.getState().updateMessage(makeMessage({ id: 'msg-1', content: 'updated-first' }))
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs).toHaveLength(2)
      expect(msgs[0].content).toBe('updated-first')
      expect(msgs[1].content).toBe('second')
    })

    it('is a no-op when room has no messages', () => {
      useChatStore.getState().updateMessage(makeMessage({ roomId: 'empty-room' }))
      expect(useChatStore.getState().messages.has('empty-room')).toBe(false)
    })
  })

  // ── removeMessage() ───────────────────────────────────────────────────────

  describe('removeMessage()', () => {
    it('removes the specified message from the room', () => {
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1' }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2' }))
      useChatStore.getState().removeMessage('room-1', 'msg-1')
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs).toHaveLength(1)
      expect(msgs[0].id).toBe('msg-2')
    })

    it('is a no-op if the message does not exist', () => {
      useChatStore.getState().addMessage(makeMessage())
      useChatStore.getState().removeMessage('room-1', 'nonexistent')
      expect(useChatStore.getState().messages.get('room-1')).toHaveLength(1)
    })

    it('is a no-op if the room does not exist', () => {
      useChatStore.getState().removeMessage('nonexistent-room', 'msg-1')
      expect(useChatStore.getState().messages.has('nonexistent-room')).toBe(false)
    })
  })

  // ── updateReactions() ────────────────────────────────────────────────────

  describe('updateReactions()', () => {
    it('updates reactions on an existing message', () => {
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1', reactions: [] }))
      const newReactions = [{ emoji: '👍', userIds: ['user-1'], usernames: ['Alice'] }]
      useChatStore.getState().updateReactions('room-1', 'msg-1', newReactions)

      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs[0].reactions).toEqual(newReactions)
    })

    it('replaces existing reactions entirely', () => {
      const initialReactions = [{ emoji: '👍', userIds: ['user-1'], usernames: ['Alice'] }]
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1', reactions: initialReactions }))
      const newReactions = [
        { emoji: '👍', userIds: ['user-1', 'user-2'], usernames: ['Alice', 'Bob'] },
        { emoji: '❤️', userIds: ['user-2'], usernames: ['Bob'] },
      ]
      useChatStore.getState().updateReactions('room-1', 'msg-1', newReactions)

      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs[0].reactions).toHaveLength(2)
      expect(msgs[0].reactions![0].userIds).toEqual(['user-1', 'user-2'])
    })

    it('is a no-op if the room has no messages', () => {
      useChatStore.getState().updateReactions('room-1', 'msg-1', [])
      expect(useChatStore.getState().messages.has('room-1')).toBe(false)
    })

    it('does not modify other messages in the same room', () => {
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1', reactions: [] }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2', reactions: [] }))
      const reactions = [{ emoji: '🎉', userIds: ['user-1'], usernames: ['Alice'] }]
      useChatStore.getState().updateReactions('room-1', 'msg-1', reactions)

      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs[0].reactions).toEqual(reactions)
      expect(msgs[1].reactions).toEqual([])
    })
  })

  // ── addStreamChunk() / completeStream() ───────────────────────────────────

  describe('streaming message lifecycle', () => {
    const chunk: ParsedChunk = { type: 'text', content: 'Hello' }

    it('addStreamChunk creates a new stream entry', () => {
      useChatStore.getState().addStreamChunk('room-1', 'agent-1', 'Agent A', 'stream-msg-1', chunk)
      const stream = useChatStore.getState().streaming.get('room-1:agent-1')
      expect(stream).toBeDefined()
      expect(stream!.messageId).toBe('stream-msg-1')
      expect(stream!.chunks).toHaveLength(1)
    })

    it('addStreamChunk appends chunks to an existing stream', () => {
      const chunk2: ParsedChunk = { type: 'text', content: ' World' }
      useChatStore.getState().addStreamChunk('room-1', 'agent-1', 'Agent A', 'stream-msg-1', chunk)
      useChatStore.getState().addStreamChunk('room-1', 'agent-1', 'Agent A', 'stream-msg-1', chunk2)
      const stream = useChatStore.getState().streaming.get('room-1:agent-1')!
      expect(stream.chunks).toHaveLength(2)
    })

    it('caps chunks at MAX_CHUNKS_PER_STREAM (2000)', () => {
      // Pre-fill the stream with 2000 chunks
      const initial: ParsedChunk[] = Array.from({ length: 2000 }, () => ({
        type: 'text' as const,
        content: 'x',
      }))
      useChatStore.setState({
        streaming: new Map([
          [
            'room-1:agent-1',
            {
              messageId: 'sm',
              agentId: 'agent-1',
              agentName: 'A',
              chunks: initial,
              lastChunkAt: Date.now(),
            },
          ],
        ]),
      })

      // Adding one more should still result in exactly 2000 chunks (oldest evicted)
      useChatStore
        .getState()
        .addStreamChunk('room-1', 'agent-1', 'A', 'sm', { type: 'text', content: 'new' })
      const stream = useChatStore.getState().streaming.get('room-1:agent-1')!
      expect(stream.chunks.length).toBe(2000)
      // The newest chunk should be the last one
      expect(stream.chunks[stream.chunks.length - 1].content).toBe('new')
    })

    it('completeStream adds final message and removes stream entry', () => {
      useChatStore.getState().addStreamChunk('room-1', 'agent-1', 'Agent A', 'sm-1', chunk)
      expect(useChatStore.getState().streaming.has('room-1:agent-1')).toBe(true)

      const finalMsg = makeMessage({ id: 'sm-1', senderId: 'agent-1', senderType: 'agent' })
      useChatStore.getState().completeStream(finalMsg)

      // Stream entry removed
      expect(useChatStore.getState().streaming.has('room-1:agent-1')).toBe(false)
      // Final message added
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs.some((m) => m.id === 'sm-1')).toBe(true)
    })
  })

  // ── setReplyTo() ──────────────────────────────────────────────────────────

  describe('setReplyTo()', () => {
    it('sets and clears replyTo', () => {
      const msg = makeMessage()
      useChatStore.getState().setReplyTo(msg)
      expect(useChatStore.getState().replyTo).toEqual(msg)

      useChatStore.getState().setReplyTo(null)
      expect(useChatStore.getState().replyTo).toBeNull()
    })
  })

  // ── setUserOnline() ───────────────────────────────────────────────────────

  describe('setUserOnline()', () => {
    it('adds userId when going online', () => {
      useChatStore.getState().setUserOnline('user-42', true)
      expect(useChatStore.getState().onlineUsers.has('user-42')).toBe(true)
    })

    it('removes userId when going offline', () => {
      useChatStore.getState().setUserOnline('user-42', true)
      useChatStore.getState().setUserOnline('user-42', false)
      expect(useChatStore.getState().onlineUsers.has('user-42')).toBe(false)
    })

    it('handles multiple users independently', () => {
      useChatStore.getState().setUserOnline('user-1', true)
      useChatStore.getState().setUserOnline('user-2', true)
      useChatStore.getState().setUserOnline('user-1', false)
      expect(useChatStore.getState().onlineUsers.has('user-1')).toBe(false)
      expect(useChatStore.getState().onlineUsers.has('user-2')).toBe(true)
    })

    it('is idempotent for repeated online calls', () => {
      useChatStore.getState().setUserOnline('user-1', true)
      useChatStore.getState().setUserOnline('user-1', true)
      expect(useChatStore.getState().onlineUsers.size).toBe(1)
    })
  })

  // ── updateReadReceipt() ───────────────────────────────────────────────────

  describe('updateReadReceipt()', () => {
    it('stores a read receipt', () => {
      useChatStore
        .getState()
        .updateReadReceipt('room-1', 'user-1', 'Alice', new Date().toISOString())
      const receipts = useChatStore.getState().readReceipts.get('room-1')!
      expect(receipts).toHaveLength(1)
      expect(receipts[0].userId).toBe('user-1')
    })

    it('replaces an existing receipt for the same user', () => {
      const t1 = '2024-01-01T00:00:00Z'
      const t2 = '2024-01-02T00:00:00Z'
      useChatStore.getState().updateReadReceipt('room-1', 'user-1', 'Alice', t1)
      useChatStore.getState().updateReadReceipt('room-1', 'user-1', 'Alice', t2)
      const receipts = useChatStore.getState().readReceipts.get('room-1')!
      expect(receipts).toHaveLength(1)
      expect(receipts[0].lastReadAt).toBe(t2)
    })

    it('stores receipts for multiple users in the same room', () => {
      useChatStore.getState().updateReadReceipt('room-1', 'user-1', 'Alice', '2024-01-01T00:00:00Z')
      useChatStore.getState().updateReadReceipt('room-1', 'user-2', 'Bob', '2024-01-01T00:00:00Z')
      const receipts = useChatStore.getState().readReceipts.get('room-1')!
      expect(receipts).toHaveLength(2)
    })

    it('stores receipts for different rooms independently', () => {
      useChatStore.getState().updateReadReceipt('room-1', 'user-1', 'Alice', '2024-01-01T00:00:00Z')
      useChatStore.getState().updateReadReceipt('room-2', 'user-1', 'Alice', '2024-01-02T00:00:00Z')
      expect(useChatStore.getState().readReceipts.get('room-1')).toHaveLength(1)
      expect(useChatStore.getState().readReceipts.get('room-2')).toHaveLength(1)
    })
  })

  // ── clearStreamingState() ─────────────────────────────────────────────────

  describe('clearStreamingState()', () => {
    it('clears all streaming and terminal buffer state', () => {
      useChatStore
        .getState()
        .addStreamChunk('room-1', 'agent-1', 'A', 'sm-1', { type: 'text', content: 'x' })
      useChatStore.getState().addTerminalData('agent-1', 'A', 'some output')
      useChatStore.getState().clearStreamingState()
      expect(useChatStore.getState().streaming.size).toBe(0)
      expect(useChatStore.getState().terminalBuffers.size).toBe(0)
    })
  })

  // ── addTerminalData() / clearTerminalBuffer() ─────────────────────────────

  describe('terminal buffer', () => {
    it('addTerminalData creates and appends to a buffer', () => {
      useChatStore.getState().addTerminalData('agent-1', 'A', 'line 1')
      useChatStore.getState().addTerminalData('agent-1', 'A', 'line 2')
      const buf = useChatStore.getState().terminalBuffers.get('agent-1')!
      expect(buf.lines).toEqual(['line 1', 'line 2'])
      expect(buf.totalPushed).toBe(2)
    })

    it('clearTerminalBuffer removes the buffer', () => {
      useChatStore.getState().addTerminalData('agent-1', 'A', 'data')
      useChatStore.getState().clearTerminalBuffer('agent-1')
      expect(useChatStore.getState().terminalBuffers.has('agent-1')).toBe(false)
    })

    it('caps terminal buffer at MAX_TERMINAL_LINES (500)', () => {
      // Push 501 lines to exceed the limit
      for (let i = 0; i < 501; i++) {
        useChatStore.getState().addTerminalData('agent-1', 'A', `line-${i}`)
      }
      const buf = useChatStore.getState().terminalBuffers.get('agent-1')!
      expect(buf.lines.length).toBe(500)
      // Oldest line should have been evicted
      expect(buf.lines[0]).toBe('line-1')
      expect(buf.lines[buf.lines.length - 1]).toBe('line-500')
      // totalPushed tracks all lines ever pushed
      expect(buf.totalPushed).toBe(501)
    })

    it('does not truncate when at exactly MAX_TERMINAL_LINES', () => {
      for (let i = 0; i < 500; i++) {
        useChatStore.getState().addTerminalData('agent-1', 'A', `line-${i}`)
      }
      const buf = useChatStore.getState().terminalBuffers.get('agent-1')!
      expect(buf.lines.length).toBe(500)
      expect(buf.lines[0]).toBe('line-0')
      expect(buf.totalPushed).toBe(500)
    })

    it('maintains separate buffers per agent', () => {
      useChatStore.getState().addTerminalData('agent-1', 'A', 'line-a')
      useChatStore.getState().addTerminalData('agent-2', 'B', 'line-b')
      expect(useChatStore.getState().terminalBuffers.get('agent-1')!.lines).toEqual(['line-a'])
      expect(useChatStore.getState().terminalBuffers.get('agent-2')!.lines).toEqual(['line-b'])
    })

    it('updates agentName on subsequent calls', () => {
      useChatStore.getState().addTerminalData('agent-1', 'OldName', 'line-1')
      useChatStore.getState().addTerminalData('agent-1', 'NewName', 'line-2')
      expect(useChatStore.getState().terminalBuffers.get('agent-1')!.agentName).toBe('NewName')
    })
  })

  // ── cleanupStaleStreams() ─────────────────────────────────────────────────

  describe('cleanupStaleStreams()', () => {
    it('removes streams older than STALE_TIMEOUT (5 minutes)', () => {
      const fiveMinutesAgo = Date.now() - 301_000
      useChatStore.setState({
        streaming: new Map([
          [
            'room-1:agent-stale',
            {
              messageId: 'sm-stale',
              agentId: 'agent-stale',
              agentName: 'Stale',
              chunks: [{ type: 'text', content: 'old' }],
              lastChunkAt: fiveMinutesAgo,
            },
          ],
          [
            'room-1:agent-fresh',
            {
              messageId: 'sm-fresh',
              agentId: 'agent-fresh',
              agentName: 'Fresh',
              chunks: [{ type: 'text', content: 'new' }],
              lastChunkAt: Date.now(),
            },
          ],
        ]),
      })

      useChatStore.getState().cleanupStaleStreams()

      expect(useChatStore.getState().streaming.has('room-1:agent-stale')).toBe(false)
      expect(useChatStore.getState().streaming.has('room-1:agent-fresh')).toBe(true)
    })

    it('does nothing when all streams are fresh', () => {
      const now = Date.now()
      useChatStore.setState({
        streaming: new Map([
          [
            'room-1:agent-1',
            {
              messageId: 'sm',
              agentId: 'agent-1',
              agentName: 'A',
              chunks: [{ type: 'text', content: 'x' }],
              lastChunkAt: now,
            },
          ],
        ]),
      })

      useChatStore.getState().cleanupStaleStreams()

      expect(useChatStore.getState().streaming.size).toBe(1)
    })

    it('does nothing when streaming map is empty', () => {
      useChatStore.getState().cleanupStaleStreams()
      expect(useChatStore.getState().streaming.size).toBe(0)
    })

    it('removes all streams when all are stale', () => {
      const longAgo = Date.now() - 301_000
      useChatStore.setState({
        streaming: new Map([
          [
            'room-1:agent-1',
            {
              messageId: 'sm1',
              agentId: 'agent-1',
              agentName: 'A',
              chunks: [{ type: 'text', content: 'x' }],
              lastChunkAt: longAgo,
            },
          ],
          [
            'room-2:agent-2',
            {
              messageId: 'sm2',
              agentId: 'agent-2',
              agentName: 'B',
              chunks: [{ type: 'text', content: 'y' }],
              lastChunkAt: longAgo,
            },
          ],
        ]),
      })

      useChatStore.getState().cleanupStaleStreams()

      expect(useChatStore.getState().streaming.size).toBe(0)
    })
  })

  // ── Unread count management ─────────────────────────────────────────────────

  describe('unread count management', () => {
    it('does not increment unread for messages in the current room', () => {
      useChatStore.setState({ currentRoomId: 'room-1' })
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1', roomId: 'room-1' }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2', roomId: 'room-1' }))
      expect(useChatStore.getState().unreadCounts.get('room-1')).toBeUndefined()
    })

    it('increments unread for multiple different rooms', () => {
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1', roomId: 'room-1' }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2', roomId: 'room-2' }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-3', roomId: 'room-1' }))

      expect(useChatStore.getState().unreadCounts.get('room-1')).toBe(2)
      expect(useChatStore.getState().unreadCounts.get('room-2')).toBe(1)
    })

    it('duplicate messages do not increment unread count', () => {
      const msg = makeMessage({ id: 'msg-1', roomId: 'room-1' })
      useChatStore.getState().addMessage(msg)
      useChatStore.getState().addMessage(msg) // duplicate
      expect(useChatStore.getState().unreadCounts.get('room-1')).toBe(1)
    })

    it('unread count starts at 0 for rooms with no messages', () => {
      expect(useChatStore.getState().unreadCounts.get('room-1')).toBeUndefined()
    })
  })

  // ── editMessage() optimistic update ─────────────────────────────────────────

  describe('editMessage()', () => {
    it('optimistically updates message content on success', async () => {
      const { api } = await import('../lib/api.js')
      const msg = makeMessage({ id: 'msg-1', roomId: 'room-1', content: 'original' })
      useChatStore.getState().addMessage(msg)

      vi.mocked(api.put).mockResolvedValueOnce({
        ok: true,
        data: { ...msg, content: 'edited' },
      })

      await useChatStore.getState().editMessage('msg-1', 'edited')
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs[0].content).toBe('edited')
    })

    it('reverts and shows toast on API failure', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      const msg = makeMessage({ id: 'msg-1', roomId: 'room-1', content: 'original' })
      useChatStore.getState().addMessage(msg)

      vi.mocked(api.put).mockResolvedValueOnce({
        ok: false,
        error: 'Server error',
      })

      await useChatStore.getState().editMessage('msg-1', 'edited')
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs[0].content).toBe('original')
      expect(toast.error).toHaveBeenCalled()
    })

    it('reverts and shows toast on network exception', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      const msg = makeMessage({ id: 'msg-1', roomId: 'room-1', content: 'original' })
      useChatStore.getState().addMessage(msg)

      vi.mocked(api.put).mockRejectedValueOnce(new Error('Network error'))

      await useChatStore.getState().editMessage('msg-1', 'edited')
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs[0].content).toBe('original')
      expect(toast.error).toHaveBeenCalled()
    })
  })

  // ── deleteMessage() optimistic update ───────────────────────────────────────

  describe('deleteMessage()', () => {
    it('optimistically removes message on success', async () => {
      const { api } = await import('../lib/api.js')
      const msg = makeMessage({ id: 'msg-1', roomId: 'room-1' })
      useChatStore.getState().addMessage(msg)

      vi.mocked(api.delete).mockResolvedValueOnce({ ok: true, data: null })

      await useChatStore.getState().deleteMessage('msg-1')
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs.find((m) => m.id === 'msg-1')).toBeUndefined()
    })

    it('restores message and shows toast on API failure', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      const msg = makeMessage({ id: 'msg-1', roomId: 'room-1' })
      useChatStore.getState().addMessage(msg)

      vi.mocked(api.delete).mockResolvedValueOnce({
        ok: false,
        error: 'Server error',
      })

      await useChatStore.getState().deleteMessage('msg-1')
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs.find((m) => m.id === 'msg-1')).toBeDefined()
      expect(toast.error).toHaveBeenCalled()
    })

    it('restores message and shows toast on network exception', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      const msg = makeMessage({ id: 'msg-1', roomId: 'room-1' })
      useChatStore.getState().addMessage(msg)

      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Network error'))

      await useChatStore.getState().deleteMessage('msg-1')
      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs.find((m) => m.id === 'msg-1')).toBeDefined()
      expect(toast.error).toHaveBeenCalled()
    })
  })

  // ── Streaming truncation boundary ───────────────────────────────────────

  describe('streaming truncation boundary', () => {
    it('evicts the oldest chunk when exactly at MAX_CHUNKS_PER_STREAM', () => {
      const MAX = 2000
      // Pre-fill with exactly MAX chunks
      const initial: ParsedChunk[] = Array.from({ length: MAX }, (_, i) => ({
        type: 'text' as const,
        content: `chunk-${i}`,
      }))
      useChatStore.setState({
        streaming: new Map([
          [
            'room-1:agent-1',
            {
              messageId: 'sm',
              agentId: 'agent-1',
              agentName: 'A',
              chunks: initial,
              lastChunkAt: Date.now(),
            },
          ],
        ]),
      })

      // Add one more — oldest should be evicted
      useChatStore
        .getState()
        .addStreamChunk('room-1', 'agent-1', 'A', 'sm', { type: 'text', content: 'overflow' })
      const stream = useChatStore.getState().streaming.get('room-1:agent-1')!
      expect(stream.chunks.length).toBe(MAX)
      // First chunk should now be chunk-1 (chunk-0 evicted)
      expect(stream.chunks[0].content).toBe('chunk-1')
      expect(stream.chunks[stream.chunks.length - 1].content).toBe('overflow')
    })

    it('does not truncate when below MAX_CHUNKS_PER_STREAM', () => {
      useChatStore
        .getState()
        .addStreamChunk('room-1', 'agent-1', 'A', 'sm', { type: 'text', content: 'first' })
      useChatStore
        .getState()
        .addStreamChunk('room-1', 'agent-1', 'A', 'sm', { type: 'text', content: 'second' })

      const stream = useChatStore.getState().streaming.get('room-1:agent-1')!
      expect(stream.chunks.length).toBe(2)
      expect(stream.chunks[0].content).toBe('first')
      expect(stream.chunks[1].content).toBe('second')
    })
  })

  // ── loadThread() ────────────────────────────────────────────────────────

  describe('loadThread()', () => {
    it('populates threadMessages for the given messageId', async () => {
      const { getThread } = await import('../lib/api.js')
      const replies: Message[] = [
        makeMessage({ id: 'reply-1', content: 'Reply 1' }),
        makeMessage({ id: 'reply-2', content: 'Reply 2' }),
      ]
      vi.mocked(getThread).mockResolvedValueOnce(replies)

      await useChatStore.getState().loadThread('msg-parent')

      const thread = useChatStore.getState().threadMessages.get('msg-parent')
      expect(thread).toHaveLength(2)
      expect(thread![0].id).toBe('reply-1')
      expect(thread![1].id).toBe('reply-2')
    })

    it('handles API error gracefully without crashing', async () => {
      const { getThread } = await import('../lib/api.js')
      vi.mocked(getThread).mockRejectedValueOnce(new Error('Network error'))

      // Should not throw
      await useChatStore.getState().loadThread('msg-fail')
      // threadMessages should not have the key
      expect(useChatStore.getState().threadMessages.has('msg-fail')).toBe(false)
    })
  })

  // ── loadRooms() concurrency guard ──────────────────────────────────────

  describe('loadRooms()', () => {
    it('prevents duplicate concurrent calls', async () => {
      const { api } = await import('../lib/api.js')
      let callCount = 0
      vi.mocked(api.get).mockImplementation(async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 10))
        return { ok: true, data: [] }
      })

      // Fire two concurrent loadRooms calls
      const p1 = useChatStore.getState().loadRooms()
      const p2 = useChatStore.getState().loadRooms()
      await Promise.all([p1, p2])

      // api.get should only be called once (from the first call)
      // because the second call returns immediately due to _loadingRooms guard
      expect(callCount).toBeLessThanOrEqual(2) // at most: rooms + recent
    })

    it('allows a second call after the first completes', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.get).mockResolvedValue({ ok: true, data: [] })

      await useChatStore.getState().loadRooms()
      await useChatStore.getState().loadRooms()

      // Both should have completed successfully (no crash, no deadlock)
      expect(api.get).toHaveBeenCalled()
    })

    it('populates rooms from API response', async () => {
      const { api } = await import('../lib/api.js')
      const rooms = [makeRoom({ id: 'room-1' }), makeRoom({ id: 'room-2' })]
      vi.mocked(api.get)
        .mockResolvedValueOnce({ ok: true, data: rooms })
        .mockResolvedValueOnce({ ok: true, data: {} })

      await useChatStore.getState().loadRooms()
      expect(useChatStore.getState().rooms).toHaveLength(2)
    })

    it('shows toast on error when no cached rooms exist', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'))

      await useChatStore.getState().loadRooms()
      expect(toast.error).toHaveBeenCalledWith('Failed to load rooms')
    })
  })

  // ── createRoom() with mutation guard ──────────────────────────────────────

  describe('createRoom()', () => {
    it('creates a room and adds it to state', async () => {
      const { api } = await import('../lib/api.js')
      const newRoom = makeRoom({ id: 'room-new', name: 'New Room' })
      vi.mocked(api.post).mockResolvedValueOnce({ ok: true, data: newRoom })

      const result = await useChatStore.getState().createRoom('New Room', 'group', false)
      expect(result).toEqual(newRoom)
      expect(useChatStore.getState().rooms).toContainEqual(newRoom)
    })

    it('throws when API returns error', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.post).mockResolvedValueOnce({ ok: false, error: 'Name taken' })

      await expect(useChatStore.getState().createRoom('Dup Name', 'group', false)).rejects.toThrow(
        'Name taken',
      )
    })

    it('rejects second concurrent call with same room name (anti-duplicate guard)', async () => {
      const { api } = await import('../lib/api.js')
      let resolveFirst: (v: unknown) => void
      const firstCall = new Promise((r) => {
        resolveFirst = r
      })
      vi.mocked(api.post).mockImplementationOnce(() => firstCall as any)

      const p1 = useChatStore.getState().createRoom('Room X', 'group', false)
      // Second call with same name should throw immediately
      await expect(useChatStore.getState().createRoom('Room X', 'group', false)).rejects.toThrow(
        'Operation already in progress',
      )

      // Resolve the first call
      resolveFirst!({ ok: true, data: makeRoom({ name: 'Room X' }) })
      await p1
    })

    it('allows same name after first call completes', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.post).mockResolvedValueOnce({
        ok: true,
        data: makeRoom({ id: 'r1', name: 'Room X' }),
      })
      await useChatStore.getState().createRoom('Room X', 'group', false)

      vi.mocked(api.post).mockResolvedValueOnce({
        ok: true,
        data: makeRoom({ id: 'r2', name: 'Room X' }),
      })
      // Should not throw
      await useChatStore.getState().createRoom('Room X', 'group', false)
    })

    it('clears mutation guard even when API throws', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.post).mockResolvedValueOnce({ ok: false, error: 'fail' })

      await expect(useChatStore.getState().createRoom('Room Y', 'group', false)).rejects.toThrow()

      // Subsequent call should work (guard was cleared in finally)
      vi.mocked(api.post).mockResolvedValueOnce({
        ok: true,
        data: makeRoom({ name: 'Room Y' }),
      })
      await expect(
        useChatStore.getState().createRoom('Room Y', 'group', false),
      ).resolves.toBeDefined()
    })

    it('passes systemPrompt and routerId when provided', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.post).mockResolvedValueOnce({
        ok: true,
        data: makeRoom({ name: 'R', systemPrompt: 'Be nice', routerId: 'rtr-1' }),
      })

      await useChatStore.getState().createRoom('R', 'private', true, 'Be nice', 'rtr-1')
      expect(api.post).toHaveBeenCalledWith('/rooms', {
        name: 'R',
        type: 'private',
        broadcastMode: true,
        systemPrompt: 'Be nice',
        routerId: 'rtr-1',
      })
    })
  })

  // ── addRoomMember() with mutation guard ──────────────────────────────────

  describe('addRoomMember()', () => {
    it('calls API and reloads members on success', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.post).mockResolvedValueOnce({ ok: true })
      vi.mocked(api.get).mockResolvedValueOnce({
        ok: true,
        data: [makeMember({ memberId: 'user-1' }), makeMember({ memberId: 'user-2' })],
      })

      await useChatStore.getState().addRoomMember('room-1', 'user-2', 'user')
      expect(api.post).toHaveBeenCalledWith('/rooms/room-1/members', {
        memberId: 'user-2',
        memberType: 'user',
      })
    })

    it('throws when API returns error', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.post).mockResolvedValueOnce({ ok: false, error: 'Already a member' })

      await expect(
        useChatStore.getState().addRoomMember('room-1', 'user-2', 'user'),
      ).rejects.toThrow('Already a member')
    })

    it('rejects second concurrent call for same room+member (anti-duplicate guard)', async () => {
      const { api } = await import('../lib/api.js')
      let resolveFirst: (v: unknown) => void
      const firstCall = new Promise((r) => {
        resolveFirst = r
      })
      vi.mocked(api.post).mockImplementationOnce(() => firstCall as any)

      const p1 = useChatStore.getState().addRoomMember('room-1', 'user-2', 'user')
      await expect(
        useChatStore.getState().addRoomMember('room-1', 'user-2', 'user'),
      ).rejects.toThrow('Operation already in progress')

      // Resolve first call
      resolveFirst!({ ok: true })
      // Still need loadRoomMembers to resolve
      vi.mocked(api.get).mockResolvedValueOnce({ ok: true, data: [] })
      await p1
    })

    it('passes roleDescription when provided', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.post).mockResolvedValueOnce({ ok: true })
      vi.mocked(api.get).mockResolvedValueOnce({ ok: true, data: [] })

      await useChatStore.getState().addRoomMember('room-1', 'agent-1', 'agent', 'Code reviewer')
      expect(api.post).toHaveBeenCalledWith('/rooms/room-1/members', {
        memberId: 'agent-1',
        memberType: 'agent',
        roleDescription: 'Code reviewer',
      })
    })
  })

  // ── removeRoomMember() with mutation guard ────────────────────────────────

  describe('removeRoomMember()', () => {
    it('calls API and reloads members on success', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.delete).mockResolvedValueOnce({ ok: true })
      vi.mocked(api.get).mockResolvedValueOnce({ ok: true, data: [makeMember()] })

      await useChatStore.getState().removeRoomMember('room-1', 'user-2')
      expect(api.delete).toHaveBeenCalledWith('/rooms/room-1/members/user-2')
    })

    it('throws when API returns error', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.delete).mockResolvedValueOnce({ ok: false, error: 'Not a member' })

      await expect(useChatStore.getState().removeRoomMember('room-1', 'user-2')).rejects.toThrow(
        'Not a member',
      )
    })

    it('rejects second concurrent call for same room+member (anti-duplicate guard)', async () => {
      const { api } = await import('../lib/api.js')
      let resolveFirst: (v: unknown) => void
      const firstCall = new Promise((r) => {
        resolveFirst = r
      })
      vi.mocked(api.delete).mockImplementationOnce(() => firstCall as any)

      const p1 = useChatStore.getState().removeRoomMember('room-1', 'user-2')
      await expect(useChatStore.getState().removeRoomMember('room-1', 'user-2')).rejects.toThrow(
        'Operation already in progress',
      )

      resolveFirst!({ ok: true })
      vi.mocked(api.get).mockResolvedValueOnce({ ok: true, data: [] })
      await p1
    })
  })

  // ── updateRoom() with mutation guard ──────────────────────────────────────

  describe('updateRoom()', () => {
    it('updates room in state on success', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({ rooms: [makeRoom({ id: 'room-1', name: 'Old Name' })] })
      vi.mocked(api.put).mockResolvedValueOnce({
        ok: true,
        data: makeRoom({ id: 'room-1', name: 'New Name' }),
      })

      await useChatStore.getState().updateRoom('room-1', { name: 'New Name' })
      expect(useChatStore.getState().rooms[0].name).toBe('New Name')
    })

    it('throws when API returns error', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.put).mockResolvedValueOnce({ ok: false, error: 'Forbidden' })

      await expect(useChatStore.getState().updateRoom('room-1', { name: 'Test' })).rejects.toThrow(
        'Forbidden',
      )
    })

    it('rejects second concurrent call for same room (anti-duplicate guard)', async () => {
      const { api } = await import('../lib/api.js')
      let resolveFirst: (v: unknown) => void
      const firstCall = new Promise((r) => {
        resolveFirst = r
      })
      vi.mocked(api.put).mockImplementationOnce(() => firstCall as any)

      const p1 = useChatStore.getState().updateRoom('room-1', { name: 'A' })
      await expect(useChatStore.getState().updateRoom('room-1', { name: 'B' })).rejects.toThrow(
        'Operation already in progress',
      )

      resolveFirst!({ ok: true, data: makeRoom({ name: 'A' }) })
      await p1
    })

    it('allows updating different rooms concurrently', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({
        rooms: [makeRoom({ id: 'room-1' }), makeRoom({ id: 'room-2' })],
      })
      vi.mocked(api.put)
        .mockResolvedValueOnce({ ok: true, data: makeRoom({ id: 'room-1', name: 'A' }) })
        .mockResolvedValueOnce({ ok: true, data: makeRoom({ id: 'room-2', name: 'B' }) })

      // Both should succeed because they have different mutation keys
      await Promise.all([
        useChatStore.getState().updateRoom('room-1', { name: 'A' }),
        useChatStore.getState().updateRoom('room-2', { name: 'B' }),
      ])
      expect(useChatStore.getState().rooms[0].name).toBe('A')
      expect(useChatStore.getState().rooms[1].name).toBe('B')
    })

    it('clears mutation guard even when API throws', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.put).mockResolvedValueOnce({ ok: false, error: 'fail' })

      await expect(useChatStore.getState().updateRoom('room-1', { name: 'A' })).rejects.toThrow()

      vi.mocked(api.put).mockResolvedValueOnce({
        ok: true,
        data: makeRoom({ id: 'room-1', name: 'B' }),
      })
      // Should not throw — guard was cleared
      await expect(
        useChatStore.getState().updateRoom('room-1', { name: 'B' }),
      ).resolves.toBeUndefined()
    })
  })

  // ── deleteRoom() with mutation guard ──────────────────────────────────────

  describe('deleteRoom()', () => {
    it('removes room and all associated state on success', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({
        rooms: [makeRoom({ id: 'room-1' }), makeRoom({ id: 'room-2' })],
        currentRoomId: 'room-1',
      })
      useChatStore.getState().addMessage(makeMessage({ roomId: 'room-1' }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2', roomId: 'room-2' }))

      vi.mocked(api.delete).mockResolvedValueOnce({ ok: true })

      await useChatStore.getState().deleteRoom('room-1')

      expect(useChatStore.getState().rooms).toHaveLength(1)
      expect(useChatStore.getState().rooms[0].id).toBe('room-2')
      expect(useChatStore.getState().currentRoomId).toBeNull()
      expect(useChatStore.getState().messages.has('room-1')).toBe(false)
      expect(useChatStore.getState().messages.has('room-2')).toBe(true)
    })

    it('throws when API returns error', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.delete).mockResolvedValueOnce({ ok: false, error: 'Cannot delete' })

      await expect(useChatStore.getState().deleteRoom('room-1')).rejects.toThrow('Cannot delete')
    })

    it('rejects second concurrent call for same room (anti-duplicate guard)', async () => {
      const { api } = await import('../lib/api.js')
      let resolveFirst: (v: unknown) => void
      const firstCall = new Promise((r) => {
        resolveFirst = r
      })
      vi.mocked(api.delete).mockImplementationOnce(() => firstCall as any)

      const p1 = useChatStore.getState().deleteRoom('room-1')
      await expect(useChatStore.getState().deleteRoom('room-1')).rejects.toThrow(
        'Operation already in progress',
      )

      resolveFirst!({ ok: true })
      await p1
    })

    it('clears typing users for deleted room', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({
        rooms: [makeRoom({ id: 'room-1' })],
        typingUsers: new Map([
          ['room-1:user-2', { username: 'Bob', expiresAt: Date.now() + 5000 }],
          ['room-2:user-3', { username: 'Charlie', expiresAt: Date.now() + 5000 }],
        ]),
      })
      vi.mocked(api.delete).mockResolvedValueOnce({ ok: true })

      await useChatStore.getState().deleteRoom('room-1')
      expect(useChatStore.getState().typingUsers.has('room-1:user-2')).toBe(false)
      expect(useChatStore.getState().typingUsers.has('room-2:user-3')).toBe(true)
    })

    it('clears replyTo if it references deleted room', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({
        rooms: [makeRoom({ id: 'room-1' })],
        replyTo: makeMessage({ roomId: 'room-1' }),
      })
      vi.mocked(api.delete).mockResolvedValueOnce({ ok: true })

      await useChatStore.getState().deleteRoom('room-1')
      expect(useChatStore.getState().replyTo).toBeNull()
    })

    it('preserves replyTo if it references a different room', async () => {
      const { api } = await import('../lib/api.js')
      const replyMsg = makeMessage({ roomId: 'room-2' })
      useChatStore.setState({
        rooms: [makeRoom({ id: 'room-1' })],
        replyTo: replyMsg,
      })
      vi.mocked(api.delete).mockResolvedValueOnce({ ok: true })

      await useChatStore.getState().deleteRoom('room-1')
      expect(useChatStore.getState().replyTo).toEqual(replyMsg)
    })
  })

  // ── toggleReaction() ──────────────────────────────────────────────────────

  describe('toggleReaction()', () => {
    it('calls API with correct params', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.post).mockResolvedValueOnce({ ok: true })

      await useChatStore.getState().toggleReaction('msg-1', '👍')
      expect(api.post).toHaveBeenCalledWith('/messages/msg-1/reactions', { emoji: '👍' })
    })

    it('shows toast on API failure', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      vi.mocked(api.post).mockResolvedValueOnce({ ok: false, error: 'fail' })

      await useChatStore.getState().toggleReaction('msg-1', '👍')
      expect(toast.error).toHaveBeenCalled()
    })

    it('shows toast on network exception', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'))

      await useChatStore.getState().toggleReaction('msg-1', '❤️')
      expect(toast.error).toHaveBeenCalledWith('Failed to toggle reaction')
    })
  })

  // ── setCurrentRoom() ──────────────────────────────────────────────────────

  describe('setCurrentRoom()', () => {
    it('sets currentRoomId', () => {
      useChatStore.getState().setCurrentRoom('room-1')
      expect(useChatStore.getState().currentRoomId).toBe('room-1')
    })

    it('adds room to joinedRooms set', () => {
      useChatStore.getState().setCurrentRoom('room-1')
      expect(useChatStore.getState().joinedRooms.has('room-1')).toBe(true)
    })

    it('sends join_room WS message for new rooms', async () => {
      const { wsClient } = await import('../lib/ws.js')
      useChatStore.getState().setCurrentRoom('room-1')
      expect(wsClient.send).toHaveBeenCalledWith({ type: 'client:join_room', roomId: 'room-1' })
    })

    it('does not send join_room WS message for already joined rooms', async () => {
      const { wsClient } = await import('../lib/ws.js')
      useChatStore.setState({ joinedRooms: new Set(['room-1']) })
      useChatStore.getState().setCurrentRoom('room-1')
      expect(wsClient.send).not.toHaveBeenCalled()
    })

    it('clears unread count for the selected room', () => {
      useChatStore.setState({ unreadCounts: new Map([['room-1', 5]]) })
      useChatStore.getState().setCurrentRoom('room-1')
      expect(useChatStore.getState().unreadCounts.has('room-1')).toBe(false)
    })

    it('calls read API for the selected room', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.getState().setCurrentRoom('room-1')
      expect(api.post).toHaveBeenCalledWith('/messages/rooms/room-1/read')
    })
  })

  // ── sendMessage() ──────────────────────────────────────────────────────────

  describe('sendMessage()', () => {
    it('sends message via WS when connected', async () => {
      const { wsClient } = await import('../lib/ws.js')
      useChatStore.getState().sendMessage('room-1', 'Hello', ['user-2'])
      expect(wsClient.send).toHaveBeenCalledWith({
        type: 'client:send_message',
        roomId: 'room-1',
        content: 'Hello',
        mentions: ['user-2'],
      })
    })

    it('includes replyToId when replying', async () => {
      const { wsClient } = await import('../lib/ws.js')
      useChatStore.setState({ replyTo: makeMessage({ id: 'parent-msg' }) })
      useChatStore.getState().sendMessage('room-1', 'Reply', [])
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ replyToId: 'parent-msg' }),
      )
      // replyTo should be cleared after sending
      expect(useChatStore.getState().replyTo).toBeNull()
    })

    it('includes attachmentIds when provided', async () => {
      const { wsClient } = await import('../lib/ws.js')
      useChatStore.getState().sendMessage('room-1', 'File', [], ['att-1', 'att-2'])
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentIds: ['att-1', 'att-2'] }),
      )
    })

    it('queues pending message when offline', async () => {
      const ws = await import('../lib/ws.js')
      Object.defineProperty(ws.wsClient, 'status', { value: 'disconnected', writable: true })

      useChatStore.getState().sendMessage('room-1', 'Offline msg', [])

      const pending = useChatStore.getState().pendingMessages
      expect(pending).toHaveLength(1)
      expect(pending[0].content).toBe('Offline msg')
      expect(pending[0].roomId).toBe('room-1')

      // Restore connected status
      Object.defineProperty(ws.wsClient, 'status', { value: 'connected', writable: true })
    })

    it('deduplicates identical offline messages', async () => {
      const ws = await import('../lib/ws.js')
      Object.defineProperty(ws.wsClient, 'status', { value: 'disconnected', writable: true })

      useChatStore.getState().sendMessage('room-1', 'Same msg', [])
      useChatStore.getState().sendMessage('room-1', 'Same msg', [])

      expect(useChatStore.getState().pendingMessages).toHaveLength(1)

      Object.defineProperty(ws.wsClient, 'status', { value: 'connected', writable: true })
    })

    it('allows different content as separate pending messages', async () => {
      const ws = await import('../lib/ws.js')
      Object.defineProperty(ws.wsClient, 'status', { value: 'disconnected', writable: true })

      useChatStore.getState().sendMessage('room-1', 'Msg A', [])
      useChatStore.getState().sendMessage('room-1', 'Msg B', [])

      expect(useChatStore.getState().pendingMessages).toHaveLength(2)

      Object.defineProperty(ws.wsClient, 'status', { value: 'connected', writable: true })
    })
  })

  // ── loadMessages() ────────────────────────────────────────────────────────

  describe('loadMessages()', () => {
    it('prevents duplicate concurrent loads for the same room', async () => {
      const { api } = await import('../lib/api.js')
      let callCount = 0
      vi.mocked(api.get).mockImplementation(async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 10))
        return { ok: true, data: { items: [], hasMore: false } }
      })

      const p1 = useChatStore.getState().loadMessages('room-1')
      const p2 = useChatStore.getState().loadMessages('room-1')
      await Promise.all([p1, p2])

      // Only one call should have gone through
      expect(callCount).toBe(1)
    })

    it('allows concurrent loads for different rooms', async () => {
      const { api } = await import('../lib/api.js')
      let callCount = 0
      vi.mocked(api.get).mockImplementation(async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 5))
        return { ok: true, data: { items: [], hasMore: false } }
      })

      const p1 = useChatStore.getState().loadMessages('room-1')
      const p2 = useChatStore.getState().loadMessages('room-2')
      await Promise.all([p1, p2])

      // Both should go through
      expect(callCount).toBe(2)
    })

    it('populates messages from API response', async () => {
      const { api } = await import('../lib/api.js')
      const msgs = [
        makeMessage({ id: 'msg-2', createdAt: '2024-01-02T00:00:00Z' }),
        makeMessage({ id: 'msg-1', createdAt: '2024-01-01T00:00:00Z' }),
      ]
      vi.mocked(api.get).mockResolvedValueOnce({
        ok: true,
        data: { items: msgs, hasMore: true },
      })

      await useChatStore.getState().loadMessages('room-1')

      // Messages should be reversed (newest first from API, but stored oldest first)
      const stored = useChatStore.getState().messages.get('room-1')!
      expect(stored).toHaveLength(2)
      expect(stored[0].id).toBe('msg-1')
      expect(stored[1].id).toBe('msg-2')
      expect(useChatStore.getState().hasMore.get('room-1')).toBe(true)
    })

    it('shows toast on failure when no messages exist', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'))

      await useChatStore.getState().loadMessages('room-1')
      expect(toast.error).toHaveBeenCalledWith('Failed to load messages')
    })

    it('clears loadingMessages after completion', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.get).mockResolvedValueOnce({
        ok: true,
        data: { items: [], hasMore: false },
      })

      await useChatStore.getState().loadMessages('room-1')
      expect(useChatStore.getState().loadingMessages.has('room-1')).toBe(false)
    })

    it('clears loadingMessages even on failure', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.get).mockRejectedValueOnce(new Error('fail'))

      await useChatStore.getState().loadMessages('room-1')
      expect(useChatStore.getState().loadingMessages.has('room-1')).toBe(false)
    })
  })

  // ── loadRoomMembers() ──────────────────────────────────────────────────────

  describe('loadRoomMembers()', () => {
    it('populates roomMembers from API response', async () => {
      const { api } = await import('../lib/api.js')
      const members = [makeMember({ memberId: 'user-1' }), makeMember({ memberId: 'user-2' })]
      vi.mocked(api.get).mockResolvedValueOnce({ ok: true, data: members })

      await useChatStore.getState().loadRoomMembers('room-1')
      expect(useChatStore.getState().roomMembers.get('room-1')).toHaveLength(2)
    })

    it('is a no-op when API fails', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.get).mockResolvedValueOnce({ ok: false, error: 'fail' })

      await useChatStore.getState().loadRoomMembers('room-1')
      expect(useChatStore.getState().roomMembers.has('room-1')).toBe(false)
    })
  })

  // ── addTypingUser() / clearExpiredTyping() ────────────────────────────────

  describe('typing indicator', () => {
    it('addTypingUser stores a typing entry', () => {
      useChatStore.getState().addTypingUser('room-1', 'user-2', 'Bob')
      expect(useChatStore.getState().typingUsers.has('room-1:user-2')).toBe(true)
    })

    it('addTypingUser refreshes expiry on repeated calls', () => {
      useChatStore.getState().addTypingUser('room-1', 'user-2', 'Bob')
      const firstExpiry = useChatStore.getState().typingUsers.get('room-1:user-2')!.expiresAt
      // Wait a tiny bit for time to advance
      useChatStore.getState().addTypingUser('room-1', 'user-2', 'Bob')
      const secondExpiry = useChatStore.getState().typingUsers.get('room-1:user-2')!.expiresAt
      expect(secondExpiry).toBeGreaterThanOrEqual(firstExpiry)
    })

    it('clearExpiredTyping removes expired entries', () => {
      // Manually set an expired entry
      useChatStore.setState({
        typingUsers: new Map([
          ['room-1:user-2', { username: 'Bob', expiresAt: Date.now() - 1000 }],
          ['room-1:user-3', { username: 'Charlie', expiresAt: Date.now() + 10000 }],
        ]),
      })
      useChatStore.getState().clearExpiredTyping()
      expect(useChatStore.getState().typingUsers.has('room-1:user-2')).toBe(false)
      expect(useChatStore.getState().typingUsers.has('room-1:user-3')).toBe(true)
    })

    it('clearExpiredTyping is a no-op when no entries are expired', () => {
      useChatStore.setState({
        typingUsers: new Map([
          ['room-1:user-2', { username: 'Bob', expiresAt: Date.now() + 10000 }],
        ]),
      })
      const before = useChatStore.getState().typingUsers
      useChatStore.getState().clearExpiredTyping()
      // Should be unchanged (null returned from action, no set())
      expect(useChatStore.getState().typingUsers).toBe(before)
    })
  })

  // ── selectTypingNames() ────────────────────────────────────────────────────

  describe('selectTypingNames()', () => {
    it('returns names of typing users in the room', () => {
      useChatStore.setState({
        typingUsers: new Map([
          ['room-1:user-2', { username: 'Bob', expiresAt: Date.now() + 5000 }],
          ['room-1:user-3', { username: 'Charlie', expiresAt: Date.now() + 5000 }],
        ]),
      })
      const names = selectTypingNames(useChatStore.getState(), 'room-1', 'user-1')
      expect(names).toContain('Bob')
      expect(names).toContain('Charlie')
      expect(names).toHaveLength(2)
    })

    it('excludes the current user', () => {
      useChatStore.setState({
        typingUsers: new Map([
          ['room-1:user-1', { username: 'Alice', expiresAt: Date.now() + 5000 }],
          ['room-1:user-2', { username: 'Bob', expiresAt: Date.now() + 5000 }],
        ]),
      })
      const names = selectTypingNames(useChatStore.getState(), 'room-1', 'user-1')
      expect(names).toEqual(['Bob'])
    })

    it('returns empty array for null roomId', () => {
      const names = selectTypingNames(useChatStore.getState(), null, 'user-1')
      expect(names).toEqual([])
    })

    it('returns empty array when no one is typing', () => {
      const names = selectTypingNames(useChatStore.getState(), 'room-1', 'user-1')
      expect(names).toEqual([])
    })

    it('excludes expired typing entries', () => {
      useChatStore.setState({
        typingUsers: new Map([
          ['room-1:user-2', { username: 'Bob', expiresAt: Date.now() - 1000 }],
          ['room-1:user-3', { username: 'Charlie', expiresAt: Date.now() + 5000 }],
        ]),
      })
      const names = selectTypingNames(useChatStore.getState(), 'room-1', 'user-1')
      expect(names).toEqual(['Charlie'])
    })
  })

  // ── evictRoom() ─────────────────────────────────────────────────────────

  describe('evictRoom()', () => {
    it('removes room from rooms list', () => {
      useChatStore.setState({
        rooms: [{ id: 'room-1', name: 'R1' } as any, { id: 'room-2', name: 'R2' } as any],
      })
      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().rooms).toHaveLength(1)
      expect(useChatStore.getState().rooms[0].id).toBe('room-2')
    })

    it('clears messages for the evicted room', () => {
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-1', roomId: 'room-1' }))
      useChatStore.getState().addMessage(makeMessage({ id: 'msg-2', roomId: 'room-2' }))

      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().messages.has('room-1')).toBe(false)
      expect(useChatStore.getState().messages.get('room-2')).toHaveLength(1)
    })

    it('resets currentRoomId when evicting the current room', () => {
      useChatStore.setState({ currentRoomId: 'room-1' })
      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().currentRoomId).toBeNull()
    })

    it('preserves currentRoomId when evicting a different room', () => {
      useChatStore.setState({ currentRoomId: 'room-2' })
      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().currentRoomId).toBe('room-2')
    })

    it('clears unread counts, last messages, and read receipts for evicted room', () => {
      useChatStore.setState({
        unreadCounts: new Map([
          ['room-1', 5],
          ['room-2', 3],
        ]),
        lastMessages: new Map([
          ['room-1', { content: 'hi', senderName: 'A', createdAt: '2024-01-01' }],
          ['room-2', { content: 'bye', senderName: 'B', createdAt: '2024-01-02' }],
        ]),
        readReceipts: new Map([
          ['room-1', [{ userId: 'u1', username: 'User1', lastReadAt: '2024-01-01' }]],
        ]),
      })

      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().unreadCounts.has('room-1')).toBe(false)
      expect(useChatStore.getState().unreadCounts.get('room-2')).toBe(3)
      expect(useChatStore.getState().lastMessages.has('room-1')).toBe(false)
      expect(useChatStore.getState().readReceipts.has('room-1')).toBe(false)
    })

    it('clears streaming entries for evicted room', () => {
      useChatStore.setState({
        streaming: new Map([
          [
            'room-1:agent-1',
            {
              messageId: 'sm',
              agentId: 'agent-1',
              agentName: 'A',
              chunks: [{ type: 'text', content: 'x' }],
              lastChunkAt: Date.now(),
            },
          ],
          [
            'room-2:agent-2',
            {
              messageId: 'sm2',
              agentId: 'agent-2',
              agentName: 'B',
              chunks: [{ type: 'text', content: 'y' }],
              lastChunkAt: Date.now(),
            },
          ],
        ]),
      })

      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().streaming.has('room-1:agent-1')).toBe(false)
      expect(useChatStore.getState().streaming.has('room-2:agent-2')).toBe(true)
    })

    it('clears replyTo if it references the evicted room', () => {
      const msg = makeMessage({ roomId: 'room-1' })
      useChatStore.setState({ replyTo: msg })

      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().replyTo).toBeNull()
    })

    it('preserves replyTo if it references a different room', () => {
      const msg = makeMessage({ roomId: 'room-2' })
      useChatStore.setState({ replyTo: msg })

      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().replyTo).toEqual(msg)
    })

    it('clears joinedRooms for evicted room', () => {
      useChatStore.setState({ joinedRooms: new Set(['room-1', 'room-2']) })
      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().joinedRooms.has('room-1')).toBe(false)
      expect(useChatStore.getState().joinedRooms.has('room-2')).toBe(true)
    })

    it('clears hasMore for evicted room', () => {
      useChatStore.setState({
        hasMore: new Map([
          ['room-1', true],
          ['room-2', false],
        ]),
      })
      useChatStore.getState().evictRoom('room-1')
      expect(useChatStore.getState().hasMore.has('room-1')).toBe(false)
      expect(useChatStore.getState().hasMore.get('room-2')).toBe(false)
    })
  })

  // ── updateNotificationPref() ──────────────────────────────────────────────

  describe('updateNotificationPref()', () => {
    it('updates member notification preference on success', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({
        roomMembers: new Map([
          ['room-1', [makeMember({ memberId: 'user-1', notificationPref: 'all' })]],
        ]),
      })
      vi.mocked(api.put).mockResolvedValueOnce({ ok: true })

      await useChatStore.getState().updateNotificationPref('room-1', 'mentions')
      const members = useChatStore.getState().roomMembers.get('room-1')!
      expect(members[0].notificationPref).toBe('mentions')
    })

    it('shows toast on API failure', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      vi.mocked(api.put).mockResolvedValueOnce({ ok: false, error: 'fail' })

      await useChatStore.getState().updateNotificationPref('room-1', 'none')
      expect(toast.error).toHaveBeenCalled()
    })

    it('shows toast on network exception', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'))

      await useChatStore.getState().updateNotificationPref('room-1', 'all')
      expect(toast.error).toHaveBeenCalledWith('Failed to update notification preference')
    })
  })

  // ── togglePin() ────────────────────────────────────────────────────────────

  describe('togglePin()', () => {
    it('optimistically toggles pin and confirms from server', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({
        roomMembers: new Map([
          ['room-1', [makeMember({ memberId: 'user-1', pinnedAt: undefined })]],
        ]),
      })
      vi.mocked(api.put).mockResolvedValueOnce({ ok: true, data: { pinned: true } })

      await useChatStore.getState().togglePin('room-1')
      const members = useChatStore.getState().roomMembers.get('room-1')!
      expect(members[0].pinnedAt).toBeDefined()
    })

    it('reverts on API failure', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({
        roomMembers: new Map([
          ['room-1', [makeMember({ memberId: 'user-1', pinnedAt: undefined })]],
        ]),
      })
      vi.mocked(api.put).mockResolvedValueOnce({ ok: false, error: 'fail' })

      await useChatStore.getState().togglePin('room-1')
      const members = useChatStore.getState().roomMembers.get('room-1')!
      // Should revert — pinnedAt was originally undefined
      expect(members[0].pinnedAt).toBeUndefined()
    })

    it('reverts and shows toast on network exception', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      useChatStore.setState({
        roomMembers: new Map([
          ['room-1', [makeMember({ memberId: 'user-1', pinnedAt: undefined })]],
        ]),
      })
      vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'))

      await useChatStore.getState().togglePin('room-1')
      expect(toast.error).toHaveBeenCalledWith('Failed to toggle pin')
    })
  })

  // ── toggleArchive() ────────────────────────────────────────────────────────

  describe('toggleArchive()', () => {
    it('updates archive state on success', async () => {
      const { api } = await import('../lib/api.js')
      useChatStore.setState({
        roomMembers: new Map([
          ['room-1', [makeMember({ memberId: 'user-1', archivedAt: undefined })]],
        ]),
      })
      vi.mocked(api.put).mockResolvedValueOnce({ ok: true, data: { archived: true } })

      await useChatStore.getState().toggleArchive('room-1')
      const members = useChatStore.getState().roomMembers.get('room-1')!
      expect(members[0].archivedAt).toBeDefined()
    })

    it('shows toast on network exception', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'))

      await useChatStore.getState().toggleArchive('room-1')
      expect(toast.error).toHaveBeenCalledWith('Failed to toggle archive')
    })
  })

  // ── syncMissedMessages() ─────────────────────────────────────────────────

  describe('syncMissedMessages()', () => {
    it('appends missed messages after the last known message', async () => {
      const { api } = await import('../lib/api.js')
      const existing = makeMessage({ id: 'msg-1', createdAt: '2024-01-01T00:00:00Z' })
      useChatStore.setState({
        messages: new Map([['room-1', [existing]]]),
      })

      const missed = [
        makeMessage({ id: 'msg-3', createdAt: '2024-01-03T00:00:00Z' }),
        makeMessage({ id: 'msg-2', createdAt: '2024-01-02T00:00:00Z' }),
      ]
      vi.mocked(api.get).mockResolvedValueOnce({
        ok: true,
        data: { items: missed, hasMore: false },
      })

      await useChatStore.getState().syncMissedMessages('room-1')

      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs).toHaveLength(3)
      // Should be sorted by createdAt
      expect(msgs[0].id).toBe('msg-1')
      expect(msgs[1].id).toBe('msg-2')
      expect(msgs[2].id).toBe('msg-3')
    })

    it('deduplicates messages from sync response', async () => {
      const { api } = await import('../lib/api.js')
      const existing = makeMessage({ id: 'msg-1', createdAt: '2024-01-01T00:00:00Z' })
      useChatStore.setState({
        messages: new Map([['room-1', [existing]]]),
      })

      const missed = [
        makeMessage({ id: 'msg-1', createdAt: '2024-01-01T00:00:00Z' }),
        makeMessage({ id: 'msg-2', createdAt: '2024-01-02T00:00:00Z' }),
      ]
      vi.mocked(api.get).mockResolvedValueOnce({
        ok: true,
        data: { items: missed, hasMore: false },
      })

      await useChatStore.getState().syncMissedMessages('room-1')

      const msgs = useChatStore.getState().messages.get('room-1')!
      expect(msgs).toHaveLength(2)
    })

    it('does full load when no messages exist', async () => {
      const { api } = await import('../lib/api.js')
      vi.mocked(api.get).mockResolvedValueOnce({
        ok: true,
        data: { items: [makeMessage()], hasMore: false },
      })

      await useChatStore.getState().syncMissedMessages('room-1')
      // Should have called loadMessages which loads via API
      expect(api.get).toHaveBeenCalled()
    })

    it('silently fails on network error', async () => {
      const { api } = await import('../lib/api.js')
      const { toast } = await import('./toast.js')
      useChatStore.setState({
        messages: new Map([['room-1', [makeMessage()]]]),
      })
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'))

      // Should not throw
      await useChatStore.getState().syncMissedMessages('room-1')
      // Should not show error toast (silently fail)
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  // ── flushPendingMessages() ────────────────────────────────────────────────

  describe('flushPendingMessages()', () => {
    it('sends pending messages via WS and clears the queue', async () => {
      const { wsClient } = await import('../lib/ws.js')
      const { getPendingMessages, removePendingMessage } = await import('../lib/message-cache.js')
      vi.mocked(getPendingMessages).mockResolvedValueOnce([
        {
          id: 'p1',
          roomId: 'room-1',
          content: 'Pending msg',
          mentions: [],
          createdAt: new Date().toISOString(),
        },
      ])

      await useChatStore.getState().flushPendingMessages()
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'client:send_message',
          roomId: 'room-1',
          content: 'Pending msg',
        }),
      )
      expect(removePendingMessage).toHaveBeenCalledWith('p1')
      expect(useChatStore.getState().pendingMessages).toEqual([])
    })

    it('is a no-op when no pending messages exist', async () => {
      const { wsClient } = await import('../lib/ws.js')
      const { getPendingMessages } = await import('../lib/message-cache.js')
      vi.mocked(getPendingMessages).mockResolvedValueOnce([])

      await useChatStore.getState().flushPendingMessages()
      expect(wsClient.send).not.toHaveBeenCalled()
    })

    it('skips already-delivered messages (dedup by content and timestamp)', async () => {
      const { wsClient } = await import('../lib/ws.js')
      const { getPendingMessages, removePendingMessage } = await import('../lib/message-cache.js')
      const ts = new Date().toISOString()
      // Pre-populate with a delivered message that matches
      useChatStore.setState({
        messages: new Map([
          ['room-1', [makeMessage({ content: 'Already sent', createdAt: ts, senderType: 'user' })]],
        ]),
      })
      vi.mocked(getPendingMessages).mockResolvedValueOnce([
        {
          id: 'p1',
          roomId: 'room-1',
          content: 'Already sent',
          mentions: [],
          createdAt: ts,
        },
      ])

      await useChatStore.getState().flushPendingMessages()
      // Should not re-send
      expect(wsClient.send).not.toHaveBeenCalled()
      // But should still remove from pending
      expect(removePendingMessage).toHaveBeenCalledWith('p1')
    })
  })
})
