import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ServerMessage, Message, MessageReaction } from '@agentim/shared'

// ── WS client mock ──────────────────────────────────────────────────────────

const mockOnMessage = vi.fn((_handler: (msg: ServerMessage) => void) => vi.fn())
const mockOnReconnect = vi.fn(() => vi.fn())
const mockOnStatusChange = vi.fn((_handler: (status: string) => void) => vi.fn())
const mockWsSend = vi.fn()

vi.mock('../lib/ws.js', () => ({
  wsClient: {
    onMessage: mockOnMessage,
    onReconnect: mockOnReconnect,
    onStatusChange: mockOnStatusChange,
    send: mockWsSend,
  },
}))

// ── Store mocks ─────────────────────────────────────────────────────────────

const mockAddMessage = vi.fn()
const mockAddStreamChunk = vi.fn()
const mockCompleteStream = vi.fn()
const mockAddTypingUser = vi.fn()
const mockUpdateMessage = vi.fn()
const mockRemoveMessage = vi.fn()
const mockSetCurrentRoom = vi.fn()
const mockUpdateReadReceipt = vi.fn()
const mockUpdateReactions = vi.fn()
const mockEvictRoom = vi.fn()
const mockChatSetUserOnline = vi.fn()
const mockChatClearStreamingState = vi.fn()
const mockChatLoadRooms = vi.fn()
const mockChatLoadRoomMembers = vi.fn()
const mockSyncMissedMessages = vi.fn()
const mockCleanupStaleStreams = vi.fn()
const mockClearExpiredTyping = vi.fn()
const mockAddTerminalData = vi.fn()

const mockChatGetState = vi.fn(() => ({
  setUserOnline: mockChatSetUserOnline,
  clearStreamingState: mockChatClearStreamingState,
  clearExpiredTyping: mockClearExpiredTyping,
  cleanupStaleStreams: mockCleanupStaleStreams,
  loadRooms: mockChatLoadRooms,
  loadRoomMembers: mockChatLoadRoomMembers,
  syncMissedMessages: mockSyncMissedMessages,
  currentRoomId: null as string | null,
  rooms: [] as Array<{ id: string; name: string }>,
  joinedRooms: new Set<string>(),
  addMessage: mockAddMessage,
  addStreamChunk: mockAddStreamChunk,
  completeStream: mockCompleteStream,
  addTypingUser: mockAddTypingUser,
  addTerminalData: mockAddTerminalData,
  updateMessage: mockUpdateMessage,
  removeMessage: mockRemoveMessage,
  setCurrentRoom: mockSetCurrentRoom,
  updateReadReceipt: mockUpdateReadReceipt,
  updateReactions: mockUpdateReactions,
  evictRoom: mockEvictRoom,
}))

const mockLogout = vi.fn()
const mockAuthGetState = vi.fn(() => ({
  user: { id: 'user1', username: 'testuser', displayName: 'Test User' },
  logout: mockLogout,
}))

const mockUpdateAgent = vi.fn()
const mockAgentGetState = vi.fn(() => ({ updateAgent: mockUpdateAgent }))

vi.mock('../stores/chat.js', () => ({
  useChatStore: Object.assign(vi.fn(), { getState: mockChatGetState }),
}))

vi.mock('../stores/auth.js', () => ({
  useAuthStore: Object.assign(vi.fn(), { getState: mockAuthGetState }),
}))

vi.mock('../stores/agents.js', () => ({
  useAgentStore: Object.assign(vi.fn(), { getState: mockAgentGetState }),
}))

const mockShowNotification = vi.fn()
vi.mock('../lib/notifications.js', () => ({
  showNotification: mockShowNotification,
}))

const mockNavigate = vi.fn()
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../stores/toast.js', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

const { useWebSocket } = await import('./useWebSocket.js')

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Capture the onMessage handler registered by the hook. */
function captureMessageHandler(): (msg: ServerMessage) => void {
  let handler: ((msg: ServerMessage) => void) | null = null
  mockOnMessage.mockImplementation((h: (msg: ServerMessage) => void) => {
    handler = h
    return vi.fn()
  })
  renderHook(() => useWebSocket())
  if (!handler) throw new Error('onMessage handler was not registered')
  return handler
}

/** Capture the onReconnect handler. */
function captureReconnectHandler(): () => void {
  let handler: (() => void) | null = null
  mockOnReconnect.mockImplementation(((h: () => void) => {
    handler = h
    return vi.fn()
  }) as any)
  renderHook(() => useWebSocket())
  if (!handler) throw new Error('onReconnect handler was not registered')
  return handler
}

/** Capture the onStatusChange handler. */
function captureStatusHandler(): (status: string) => void {
  let handler: ((status: string) => void) | null = null
  mockOnStatusChange.mockImplementation((h: (status: string) => void) => {
    handler = h
    return vi.fn()
  })
  renderHook(() => useWebSocket())
  if (!handler) throw new Error('onStatusChange handler was not registered')
  return handler
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg1',
    roomId: 'room1',
    senderId: 'agent1',
    senderName: 'Agent',
    senderType: 'agent',
    type: 'text',
    content: 'Hello from agent',
    mentions: [],
    reactions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockOnMessage.mockReturnValue(vi.fn())
    mockOnReconnect.mockReturnValue(vi.fn())
    mockOnStatusChange.mockReturnValue(vi.fn())
    // Reset default state
    mockChatGetState.mockReturnValue({
      setUserOnline: mockChatSetUserOnline,
      clearStreamingState: mockChatClearStreamingState,
      clearExpiredTyping: mockClearExpiredTyping,
      cleanupStaleStreams: mockCleanupStaleStreams,
      loadRooms: mockChatLoadRooms,
      loadRoomMembers: mockChatLoadRoomMembers,
      syncMissedMessages: mockSyncMissedMessages,
      currentRoomId: null,
      rooms: [],
      joinedRooms: new Set<string>(),
      addMessage: mockAddMessage,
      addStreamChunk: mockAddStreamChunk,
      completeStream: mockCompleteStream,
      addTypingUser: mockAddTypingUser,
      addTerminalData: mockAddTerminalData,
      updateMessage: mockUpdateMessage,
      removeMessage: mockRemoveMessage,
      setCurrentRoom: mockSetCurrentRoom,
      updateReadReceipt: mockUpdateReadReceipt,
      updateReactions: mockUpdateReactions,
      evictRoom: mockEvictRoom,
    })
    mockAuthGetState.mockReturnValue({
      user: { id: 'user1', username: 'testuser', displayName: 'Test User' },
      logout: mockLogout,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Lifecycle ───────────────────────────────────────────────────────────

  it('registers onMessage, onReconnect, and onStatusChange listeners on mount', () => {
    renderHook(() => useWebSocket())
    expect(mockOnMessage).toHaveBeenCalledTimes(1)
    expect(mockOnReconnect).toHaveBeenCalledTimes(1)
    expect(mockOnStatusChange).toHaveBeenCalledTimes(1)
  })

  it('calls cleanup functions on unmount', () => {
    const cleanupMessage = vi.fn()
    const cleanupReconnect = vi.fn()
    const cleanupStatus = vi.fn()
    mockOnMessage.mockReturnValueOnce(cleanupMessage)
    mockOnReconnect.mockReturnValueOnce(cleanupReconnect)
    mockOnStatusChange.mockReturnValueOnce(cleanupStatus)

    const { unmount } = renderHook(() => useWebSocket())
    unmount()

    expect(cleanupMessage).toHaveBeenCalledTimes(1)
    expect(cleanupReconnect).toHaveBeenCalledTimes(1)
    expect(cleanupStatus).toHaveBeenCalledTimes(1)
  })

  // ── server:new_message ──────────────────────────────────────────────────

  describe('server:new_message', () => {
    it('adds the message to the chat store', () => {
      const handler = captureMessageHandler()
      const msg = makeMessage()
      handler({ type: 'server:new_message', message: msg })
      expect(mockAddMessage).toHaveBeenCalledWith(msg)
    })

    it('does not show notification for own messages', () => {
      const handler = captureMessageHandler()
      const msg = makeMessage({ senderId: 'user1', senderName: 'testuser' })
      handler({ type: 'server:new_message', message: msg })
      expect(mockShowNotification).not.toHaveBeenCalled()
    })

    it('shows notification for messages from other users in non-current room', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room2',
        rooms: [{ id: 'room1', name: 'General' }],
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({
        senderId: 'user2',
        senderName: 'OtherUser',
        roomId: 'room1',
        content: 'Hey there',
      })
      handler({ type: 'server:new_message', message: msg })
      expect(mockShowNotification).toHaveBeenCalledWith(
        'OtherUser · General',
        'Hey there',
        expect.any(Function),
      )
    })

    it('does not show notification for messages in the current room (non-mention)', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room1',
        rooms: [{ id: 'room1', name: 'General' }],
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({
        senderId: 'user2',
        senderName: 'OtherUser',
        roomId: 'room1',
        content: 'Hey',
      })
      handler({ type: 'server:new_message', message: msg })
      expect(mockShowNotification).not.toHaveBeenCalled()
    })

    it('shows mention notification even in the current room', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room1',
        rooms: [{ id: 'room1', name: 'General' }],
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({
        senderId: 'user2',
        senderName: 'OtherUser',
        roomId: 'room1',
        content: '@testuser check this',
        mentions: ['testuser'],
      })
      handler({ type: 'server:new_message', message: msg })
      expect(mockShowNotification).toHaveBeenCalledWith(
        '@OtherUser · General',
        '@testuser check this',
        expect.any(Function),
        'agentim-mention',
      )
    })

    it('shows mention notification when displayName is mentioned', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room1',
        rooms: [{ id: 'room1', name: 'General' }],
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({
        senderId: 'user2',
        senderName: 'OtherUser',
        roomId: 'room1',
        content: '@Test User look here',
        mentions: ['Test User'],
      })
      handler({ type: 'server:new_message', message: msg })
      expect(mockShowNotification).toHaveBeenCalledWith(
        '@OtherUser · General',
        expect.any(String),
        expect.any(Function),
        'agentim-mention',
      )
    })

    it('notification click navigates to the room', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room2',
        rooms: [{ id: 'room1', name: 'General' }],
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({
        senderId: 'user2',
        senderName: 'Other',
        roomId: 'room1',
        content: 'Hi',
      })
      handler({ type: 'server:new_message', message: msg })

      // The 3rd argument is the onClick callback
      const onClick = mockShowNotification.mock.calls[0][2]
      onClick()
      expect(mockSetCurrentRoom).toHaveBeenCalledWith('room1')
      expect(mockNavigate).toHaveBeenCalledWith('/room/room1')
    })

    it('falls back to roomId when room name is not found', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room2',
        rooms: [],
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({
        senderId: 'user2',
        senderName: 'Other',
        roomId: 'room1',
        content: 'Hi',
      })
      handler({ type: 'server:new_message', message: msg })
      expect(mockShowNotification).toHaveBeenCalledWith('Other · room1', 'Hi', expect.any(Function))
    })

    it('does not show notification when user is null', () => {
      mockAuthGetState.mockReturnValue({
        user: null as unknown as { id: string; username: string; displayName: string },
        logout: mockLogout,
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({ senderId: 'user2', senderName: 'Other', content: 'Hi' })
      handler({ type: 'server:new_message', message: msg })
      expect(mockShowNotification).not.toHaveBeenCalled()
    })

    it('truncates notification body to 120 characters', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room2',
        rooms: [{ id: 'room1', name: 'General' }],
      })
      const handler = captureMessageHandler()
      const longContent = 'A'.repeat(200)
      const msg = makeMessage({
        senderId: 'user2',
        senderName: 'Other',
        roomId: 'room1',
        content: longContent,
      })
      handler({ type: 'server:new_message', message: msg })
      const body = mockShowNotification.mock.calls[0][1] as string
      expect(body).toHaveLength(120)
    })
  })

  // ── server:message_chunk ────────────────────────────────────────────────

  it('calls addStreamChunk for server:message_chunk', () => {
    const handler = captureMessageHandler()
    const chunk = { type: 'text' as const, content: 'partial' }
    handler({
      type: 'server:message_chunk',
      roomId: 'room1',
      agentId: 'agent1',
      agentName: 'Claude',
      messageId: 'msg1',
      chunk,
    })
    expect(mockAddStreamChunk).toHaveBeenCalledWith('room1', 'agent1', 'Claude', 'msg1', chunk)
  })

  // ── server:message_complete ─────────────────────────────────────────────

  describe('server:message_complete', () => {
    it('calls completeStream with the message', () => {
      const handler = captureMessageHandler()
      const msg = makeMessage()
      handler({ type: 'server:message_complete', message: msg })
      expect(mockCompleteStream).toHaveBeenCalledWith(msg)
    })

    it('shows notification for completed message in non-current room', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room2',
        rooms: [{ id: 'room1', name: 'General' }],
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({ roomId: 'room1', senderName: 'Agent' })
      handler({ type: 'server:message_complete', message: msg })
      expect(mockShowNotification).toHaveBeenCalledWith(
        'Agent · General',
        expect.any(String),
        expect.any(Function),
      )
    })

    it('does not show notification for completed message in current room', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room1',
        rooms: [{ id: 'room1', name: 'General' }],
      })
      const handler = captureMessageHandler()
      const msg = makeMessage({ roomId: 'room1' })
      handler({ type: 'server:message_complete', message: msg })
      expect(mockShowNotification).not.toHaveBeenCalled()
    })
  })

  // ── server:typing ───────────────────────────────────────────────────────

  it('calls addTypingUser for server:typing', () => {
    const handler = captureMessageHandler()
    handler({
      type: 'server:typing',
      roomId: 'room1',
      userId: 'user2',
      username: 'other',
    })
    expect(mockAddTypingUser).toHaveBeenCalledWith('room1', 'user2', 'other')
  })

  // ── server:agent_status ─────────────────────────────────────────────────

  it('calls agentStore.updateAgent for server:agent_status', () => {
    const handler = captureMessageHandler()
    const agent = {
      id: 'a1',
      name: 'Claude',
      type: 'claude-code' as const,
      status: 'online' as const,
    }
    handler({ type: 'server:agent_status', agent })
    expect(mockUpdateAgent).toHaveBeenCalledWith(agent)
  })

  // ── server:terminal_data ────────────────────────────────────────────────

  it('calls addTerminalData for server:terminal_data', () => {
    const handler = captureMessageHandler()
    handler({
      type: 'server:terminal_data',
      agentId: 'a1',
      agentName: 'Claude',
      roomId: 'room1',
      data: 'ls -la\n',
    })
    expect(mockAddTerminalData).toHaveBeenCalledWith('a1', 'Claude', 'ls -la\n')
  })

  // ── server:task_update ──────────────────────────────────────────────────

  it('dispatches agentim:task_update custom event for server:task_update', () => {
    const handler = captureMessageHandler()
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const task = {
      id: 't1',
      roomId: 'room1',
      title: 'Test task',
      agentId: 'a1',
      description: 'Test',
      status: 'completed' as const,
      createdById: 'user1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    handler({ type: 'server:task_update', task })

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agentim:task_update',
        detail: task,
      }),
    )
    dispatchSpy.mockRestore()
  })

  // ── server:message_edited ───────────────────────────────────────────────

  it('calls updateMessage for server:message_edited', () => {
    const handler = captureMessageHandler()
    const msg = makeMessage({ content: 'edited content' })
    handler({ type: 'server:message_edited', message: msg })
    expect(mockUpdateMessage).toHaveBeenCalledWith(msg)
  })

  // ── server:message_deleted ──────────────────────────────────────────────

  it('calls removeMessage for server:message_deleted', () => {
    const handler = captureMessageHandler()
    handler({
      type: 'server:message_deleted',
      roomId: 'room1',
      messageId: 'msg1',
    })
    expect(mockRemoveMessage).toHaveBeenCalledWith('room1', 'msg1')
  })

  // ── server:room_update ──────────────────────────────────────────────────

  it('calls loadRooms and loadRoomMembers for server:room_update', () => {
    const handler = captureMessageHandler()
    const room = {
      id: 'room1',
      name: 'General',
      type: 'group' as const,
      broadcastMode: false,
      createdById: 'user1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    handler({ type: 'server:room_update', room })
    expect(mockChatLoadRooms).toHaveBeenCalled()
    expect(mockChatLoadRoomMembers).toHaveBeenCalledWith('room1')
  })

  // ── server:room_removed ─────────────────────────────────────────────────

  describe('server:room_removed', () => {
    it('evicts the room and reloads rooms', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room2',
      })
      const handler = captureMessageHandler()
      handler({ type: 'server:room_removed', roomId: 'room1' })
      expect(mockEvictRoom).toHaveBeenCalledWith('room1')
      expect(mockChatLoadRooms).toHaveBeenCalled()
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('navigates to / when the evicted room is the current room', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room1',
      })
      const handler = captureMessageHandler()
      handler({ type: 'server:room_removed', roomId: 'room1' })
      expect(mockEvictRoom).toHaveBeenCalledWith('room1')
      expect(mockNavigate).toHaveBeenCalledWith('/')
    })
  })

  // ── server:read_receipt ─────────────────────────────────────────────────

  it('calls updateReadReceipt for server:read_receipt', () => {
    const handler = captureMessageHandler()
    handler({
      type: 'server:read_receipt',
      roomId: 'room1',
      userId: 'user2',
      username: 'other',
      lastReadAt: '2026-02-26T00:00:00Z',
    })
    expect(mockUpdateReadReceipt).toHaveBeenCalledWith(
      'room1',
      'user2',
      'other',
      '2026-02-26T00:00:00Z',
    )
  })

  // ── server:presence ─────────────────────────────────────────────────────

  it('calls chat.setUserOnline when server:presence message is received', () => {
    const handler = captureMessageHandler()
    handler({
      type: 'server:presence',
      userId: 'user2',
      username: 'other',
      online: true,
    })
    expect(mockChatSetUserOnline).toHaveBeenCalledWith('user2', true)
  })

  // ── server:reaction_update ──────────────────────────────────────────────

  it('calls updateReactions for server:reaction_update', () => {
    const handler = captureMessageHandler()
    const reactions: MessageReaction[] = [
      { emoji: '👍', userIds: ['user1'], usernames: ['testuser'] },
    ]
    handler({
      type: 'server:reaction_update',
      roomId: 'room1',
      messageId: 'msg1',
      reactions,
    })
    expect(mockUpdateReactions).toHaveBeenCalledWith('room1', 'msg1', reactions)
  })

  // ── server:auth_result ──────────────────────────────────────────────────

  describe('server:auth_result', () => {
    it('calls auth.logout when ok=false', () => {
      const handler = captureMessageHandler()
      handler({
        type: 'server:auth_result',
        ok: false,
        error: 'Token revoked',
      })
      expect(mockLogout).toHaveBeenCalledTimes(1)
    })

    it('does not call logout when ok=true', () => {
      const handler = captureMessageHandler()
      handler({
        type: 'server:auth_result',
        ok: true,
        userId: 'user1',
      })
      expect(mockLogout).not.toHaveBeenCalled()
    })
  })

  // ── server:error ────────────────────────────────────────────────────────

  it('logs server:error without crashing', () => {
    const handler = captureMessageHandler()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    handler({
      type: 'server:error',
      code: 'RATE_LIMIT',
      message: 'Too many requests',
    })
    expect(warnSpy).toHaveBeenCalledWith('[WS Server Error]', 'RATE_LIMIT', 'Too many requests')
    warnSpy.mockRestore()
  })

  // ── Error resilience ────────────────────────────────────────────────────

  it('catches errors in individual handlers without breaking the switch', () => {
    const handler = captureMessageHandler()
    mockAddMessage.mockImplementation(() => {
      throw new Error('Store error')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Should not throw
    handler({
      type: 'server:new_message',
      message: makeMessage(),
    })

    expect(errorSpy).toHaveBeenCalledWith(
      '[WS] Error handling message:',
      'server:new_message',
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })

  // ── onStatusChange (disconnect) ─────────────────────────────────────────

  it('clears streaming state when status changes to disconnected', () => {
    const statusHandler = captureStatusHandler()
    statusHandler('disconnected')
    expect(mockChatClearStreamingState).toHaveBeenCalledTimes(1)
  })

  it('does not clear streaming state for non-disconnected statuses', () => {
    const statusHandler = captureStatusHandler()
    statusHandler('connected')
    expect(mockChatClearStreamingState).not.toHaveBeenCalled()
  })

  // ── onReconnect ─────────────────────────────────────────────────────────

  describe('onReconnect handler', () => {
    it('clears streaming state and reloads rooms on reconnect', () => {
      const reconnectHandler = captureReconnectHandler()
      reconnectHandler()
      expect(mockChatClearStreamingState).toHaveBeenCalled()
      expect(mockChatLoadRooms).toHaveBeenCalled()
    })

    it('re-joins all previously joined rooms', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        joinedRooms: new Set(['room1', 'room2', 'room3']),
      })
      const reconnectHandler = captureReconnectHandler()
      reconnectHandler()

      expect(mockWsSend).toHaveBeenCalledWith({ type: 'client:join_room', roomId: 'room1' })
      expect(mockWsSend).toHaveBeenCalledWith({ type: 'client:join_room', roomId: 'room2' })
      expect(mockWsSend).toHaveBeenCalledWith({ type: 'client:join_room', roomId: 'room3' })
    })

    it('syncs missed messages and reloads members for current room', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: 'room1',
        joinedRooms: new Set(['room1']),
      })
      const reconnectHandler = captureReconnectHandler()
      reconnectHandler()

      expect(mockSyncMissedMessages).toHaveBeenCalledWith('room1')
      expect(mockChatLoadRoomMembers).toHaveBeenCalledWith('room1')
    })

    it('does not sync missed messages when no current room', () => {
      mockChatGetState.mockReturnValue({
        ...mockChatGetState(),
        currentRoomId: null,
        joinedRooms: new Set(),
      })
      const reconnectHandler = captureReconnectHandler()
      reconnectHandler()

      expect(mockSyncMissedMessages).not.toHaveBeenCalled()
      expect(mockChatLoadRoomMembers).not.toHaveBeenCalled()
    })
  })

  // ── Timers ──────────────────────────────────────────────────────────────

  describe('periodic timers', () => {
    it('calls clearExpiredTyping every 1 second', () => {
      renderHook(() => useWebSocket())
      expect(mockClearExpiredTyping).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1000)
      expect(mockClearExpiredTyping).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1000)
      expect(mockClearExpiredTyping).toHaveBeenCalledTimes(2)
    })

    it('calls cleanupStaleStreams every 30 seconds', () => {
      renderHook(() => useWebSocket())
      expect(mockCleanupStaleStreams).not.toHaveBeenCalled()

      vi.advanceTimersByTime(30_000)
      expect(mockCleanupStaleStreams).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(30_000)
      expect(mockCleanupStaleStreams).toHaveBeenCalledTimes(2)
    })

    it('clears typing timer on unmount', () => {
      const { unmount } = renderHook(() => useWebSocket())
      unmount()

      vi.advanceTimersByTime(5000)
      // After unmount, clearExpiredTyping should not have been called
      // (it may have been called during mount cycle, so check no new calls)
      const callCount = mockClearExpiredTyping.mock.calls.length
      vi.advanceTimersByTime(5000)
      expect(mockClearExpiredTyping).toHaveBeenCalledTimes(callCount)
    })

    it('clears stale streams timer on unmount', () => {
      const { unmount } = renderHook(() => useWebSocket())
      unmount()

      const callCount = mockCleanupStaleStreams.mock.calls.length
      vi.advanceTimersByTime(60_000)
      expect(mockCleanupStaleStreams).toHaveBeenCalledTimes(callCount)
    })
  })

  // ── ws:queue_full event ─────────────────────────────────────────────────

  it('shows toast error when ws:queue_full event is dispatched', async () => {
    const { toast } = await import('../stores/toast.js')
    renderHook(() => useWebSocket())

    window.dispatchEvent(new CustomEvent('ws:queue_full'))

    expect(toast.error).toHaveBeenCalled()
  })

  it('removes ws:queue_full listener on unmount', async () => {
    const { toast } = await import('../stores/toast.js')
    const { unmount } = renderHook(() => useWebSocket())
    unmount()

    vi.mocked(toast.error).mockClear()
    window.dispatchEvent(new CustomEvent('ws:queue_full'))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
