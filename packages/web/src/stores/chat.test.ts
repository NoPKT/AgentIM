import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Message, ParsedChunk } from '@agentim/shared'
import { useChatStore } from './chat.js'

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
    it('removes streams older than STALE_TIMEOUT (2 minutes)', () => {
      const twoMinutesAgo = Date.now() - 121_000
      useChatStore.setState({
        streaming: new Map([
          [
            'room-1:agent-stale',
            {
              messageId: 'sm-stale',
              agentId: 'agent-stale',
              agentName: 'Stale',
              chunks: [{ type: 'text', content: 'old' }],
              lastChunkAt: twoMinutesAgo,
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
      const longAgo = Date.now() - 300_000
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
  })
})
