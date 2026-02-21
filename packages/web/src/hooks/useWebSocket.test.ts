import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ServerMessage } from '@agentim/shared'

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

const mockChatSetUserOnline = vi.fn()
const mockChatClearStreamingState = vi.fn()
const mockChatLoadRooms = vi.fn()
const mockChatGetState = vi.fn(() => ({
  setUserOnline: mockChatSetUserOnline,
  clearStreamingState: mockChatClearStreamingState,
  loadRooms: mockChatLoadRooms,
  currentRoomId: null,
  joinedRooms: new Set<string>(),
  syncMissedMessages: vi.fn(),
  loadRoomMembers: vi.fn(),
  cleanupStaleStreams: vi.fn(),
  clearExpiredTyping: vi.fn(),
  addMessage: vi.fn(),
  addStreamChunk: vi.fn(),
  completeStream: vi.fn(),
  addTypingUser: vi.fn(),
  updateMessage: vi.fn(),
  removeMessage: vi.fn(),
  updateReadReceipt: vi.fn(),
  updateReactions: vi.fn(),
  evictRoom: vi.fn(),
}))

const mockAuthGetState = vi.fn(() => ({ user: { id: 'user1' }, logout: vi.fn() }))
const mockAgentGetState = vi.fn(() => ({ updateAgent: vi.fn() }))

vi.mock('../stores/chat.js', () => ({
  useChatStore: Object.assign(vi.fn(), { getState: mockChatGetState }),
}))

vi.mock('../stores/auth.js', () => ({
  useAuthStore: Object.assign(vi.fn(), { getState: mockAuthGetState }),
}))

vi.mock('../stores/agents.js', () => ({
  useAgentStore: Object.assign(vi.fn(), { getState: mockAgentGetState }),
}))

vi.mock('../lib/notifications.js', () => ({
  showNotification: vi.fn(),
}))

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const { useWebSocket } = await import('./useWebSocket.js')

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockOnMessage.mockReturnValue(vi.fn())
    mockOnReconnect.mockReturnValue(vi.fn())
    mockOnStatusChange.mockReturnValue(vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('calls chat.setUserOnline when server:presence message is received', () => {
    let capturedHandler: ((msg: ServerMessage) => void) | null = null
    mockOnMessage.mockImplementation((handler: (msg: ServerMessage) => void) => {
      capturedHandler = handler
      return vi.fn()
    })

    renderHook(() => useWebSocket())
    ;(capturedHandler as ((msg: ServerMessage) => void) | null)?.({
      type: 'server:presence',
      userId: 'user2',
      username: 'other',
      online: true,
    })

    expect(mockChatSetUserOnline).toHaveBeenCalledWith('user2', true)
  })

  it('calls auth.logout when server:auth_result with ok=false is received', () => {
    let capturedHandler: ((msg: ServerMessage) => void) | null = null
    mockOnMessage.mockImplementation((handler: (msg: ServerMessage) => void) => {
      capturedHandler = handler
      return vi.fn()
    })

    const mockLogout = vi.fn()
    mockAuthGetState.mockReturnValue({ user: { id: 'user1' }, logout: mockLogout })

    renderHook(() => useWebSocket())
    ;(capturedHandler as ((msg: ServerMessage) => void) | null)?.({
      type: 'server:auth_result',
      ok: false,
      error: 'Token revoked',
    })

    expect(mockLogout).toHaveBeenCalledTimes(1)
  })

  it('clears streaming state when status changes to disconnected', () => {
    let capturedStatusHandler: ((status: string) => void) | null = null
    mockOnStatusChange.mockImplementation((handler: (status: string) => void) => {
      capturedStatusHandler = handler
      return vi.fn()
    })

    renderHook(() => useWebSocket())
    ;(capturedStatusHandler as ((status: string) => void) | null)?.('disconnected')

    expect(mockChatClearStreamingState).toHaveBeenCalledTimes(1)
  })
})
