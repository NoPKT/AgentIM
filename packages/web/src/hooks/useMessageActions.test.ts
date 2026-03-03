import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Message } from '@agentim/shared'

const mockRewindRoom = vi.fn().mockResolvedValue(undefined)

vi.mock('../stores/chat.js', () => ({
  useChatStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      rewindRoom: mockRewindRoom,
    }),
  ),
}))

vi.mock('../stores/auth.js', () => ({
  useAuthStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: { id: 'user1', username: 'testuser' } }),
  ),
}))

vi.mock('../stores/toast.js', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const { useMessageActions } = await import('./useMessageActions.js')

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg1',
    roomId: 'room1',
    senderId: 'user1',
    senderName: 'testuser',
    senderType: 'user',
    type: 'text',
    content: 'Hello world',
    mentions: [],
    reactions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('useMessageActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isOwnMessage is true when message senderId matches current user', () => {
    const message = makeMessage({ senderId: 'user1', senderType: 'user' })
    const { result } = renderHook(() => useMessageActions(message))
    expect(result.current.isOwnMessage).toBe(true)
  })

  it('isOwnMessage is false when message senderId does not match current user', () => {
    const message = makeMessage({ senderId: 'other-user', senderType: 'user' })
    const { result } = renderHook(() => useMessageActions(message))
    expect(result.current.isOwnMessage).toBe(false)
  })

  it('isOwnMessage is false for agent messages even with matching senderId', () => {
    const message = makeMessage({ senderId: 'user1', senderType: 'agent' })
    const { result } = renderHook(() => useMessageActions(message))
    expect(result.current.isOwnMessage).toBe(false)
  })

  it('canRewind is true when isOwnMessage and roomSupportsRewind', () => {
    const message = makeMessage({ senderId: 'user1', senderType: 'user' })
    const { result } = renderHook(() => useMessageActions(message, { roomSupportsRewind: true }))
    expect(result.current.canRewind).toBe(true)
  })

  it('canRewind is false when roomSupportsRewind is false', () => {
    const message = makeMessage({ senderId: 'user1', senderType: 'user' })
    const { result } = renderHook(() => useMessageActions(message, { roomSupportsRewind: false }))
    expect(result.current.canRewind).toBe(false)
  })

  it('canRewind is false when not own message', () => {
    const message = makeMessage({ senderId: 'other-user', senderType: 'user' })
    const { result } = renderHook(() => useMessageActions(message, { roomSupportsRewind: true }))
    expect(result.current.canRewind).toBe(false)
  })

  it('canRewind defaults to false when opts not provided', () => {
    const message = makeMessage({ senderId: 'user1', senderType: 'user' })
    const { result } = renderHook(() => useMessageActions(message))
    expect(result.current.canRewind).toBe(false)
  })

  it('confirmingRewind starts as false', () => {
    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))
    expect(result.current.confirmingRewind).toBe(false)
  })

  it('setConfirmingRewind toggles confirmingRewind state', () => {
    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))

    act(() => {
      result.current.setConfirmingRewind(true)
    })
    expect(result.current.confirmingRewind).toBe(true)

    act(() => {
      result.current.setConfirmingRewind(false)
    })
    expect(result.current.confirmingRewind).toBe(false)
  })

  it('handleRewind calls rewindRoom and resets state', async () => {
    const message = makeMessage({ content: 'rewind me' })
    const { result } = renderHook(() => useMessageActions(message, { roomSupportsRewind: true }))

    act(() => {
      result.current.setShowActions(true)
      result.current.setConfirmingRewind(true)
    })

    await act(async () => {
      await result.current.handleRewind()
    })

    expect(mockRewindRoom).toHaveBeenCalledWith('room1', 'msg1', 'rewind me')
    expect(result.current.confirmingRewind).toBe(false)
    expect(result.current.showActions).toBe(false)
  })

  it('handleRewind shows error toast on failure', async () => {
    mockRewindRoom.mockRejectedValueOnce(new Error('fail'))
    const { toast } = await import('../stores/toast.js')

    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message, { roomSupportsRewind: true }))

    await act(async () => {
      await result.current.handleRewind()
    })

    expect(toast.error).toHaveBeenCalled()
    expect(result.current.confirmingRewind).toBe(false)
    expect(result.current.showActions).toBe(false)
  })

  it('showActions defaults to false', () => {
    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))
    expect(result.current.showActions).toBe(false)
  })

  it('setShowActions toggles showActions state', () => {
    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))

    act(() => {
      result.current.setShowActions(true)
    })
    expect(result.current.showActions).toBe(true)

    act(() => {
      result.current.setShowActions(false)
    })
    expect(result.current.showActions).toBe(false)
  })
})
