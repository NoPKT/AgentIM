import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Message } from '@agentim/shared'

const mockSetReplyTo = vi.fn()
const mockEditMessage = vi.fn().mockResolvedValue(undefined)
const mockDeleteMessage = vi.fn().mockResolvedValue(undefined)
const mockToggleReaction = vi.fn().mockResolvedValue(undefined)

vi.mock('../stores/chat.js', () => ({
  useChatStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setReplyTo: mockSetReplyTo,
      editMessage: mockEditMessage,
      deleteMessage: mockDeleteMessage,
      toggleReaction: mockToggleReaction,
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

vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  },
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

  it('handleEdit sets isEditing to true and populates editContent', () => {
    const message = makeMessage({ content: 'original content' })
    const { result } = renderHook(() => useMessageActions(message))

    act(() => {
      result.current.handleEdit()
    })

    expect(result.current.isEditing).toBe(true)
    expect(result.current.editContent).toBe('original content')
  })

  it('handleEditCancel sets isEditing to false', () => {
    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))

    act(() => {
      result.current.handleEdit()
    })
    expect(result.current.isEditing).toBe(true)

    act(() => {
      result.current.handleEditCancel()
    })
    expect(result.current.isEditing).toBe(false)
  })

  it('handleEditSave calls editMessage store action with trimmed content', async () => {
    const message = makeMessage({ content: 'original' })
    const { result } = renderHook(() => useMessageActions(message))

    act(() => {
      result.current.handleEdit()
      result.current.setEditContent('  updated content  ')
    })

    await act(async () => {
      await result.current.handleEditSave()
    })

    expect(mockEditMessage).toHaveBeenCalledWith('msg1', 'updated content')
    expect(result.current.isEditing).toBe(false)
  })

  it('handleEditSave does not call editMessage when content is unchanged', async () => {
    const message = makeMessage({ content: 'same content' })
    const { result } = renderHook(() => useMessageActions(message))

    act(() => {
      result.current.handleEdit()
      result.current.setEditContent('same content')
    })

    await act(async () => {
      await result.current.handleEditSave()
    })

    expect(mockEditMessage).not.toHaveBeenCalled()
    expect(result.current.isEditing).toBe(false)
  })

  it('handleDelete calls deleteMessage store action', async () => {
    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))

    await act(async () => {
      await result.current.handleDelete()
    })

    expect(mockDeleteMessage).toHaveBeenCalledWith('msg1')
  })

  it('handleReaction calls toggleReaction and closes emoji picker', async () => {
    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))

    act(() => {
      result.current.setShowEmojiPicker(true)
    })
    expect(result.current.showEmojiPicker).toBe(true)

    await act(async () => {
      result.current.handleReaction('👍')
    })

    expect(mockToggleReaction).toHaveBeenCalledWith('msg1', '👍')
    expect(result.current.showEmojiPicker).toBe(false)
  })

  it('handleReply calls setReplyTo with the message', () => {
    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))

    act(() => {
      result.current.handleReply()
    })

    expect(mockSetReplyTo).toHaveBeenCalledWith(message)
  })

  it('toggleEditHistory shows history on first call', async () => {
    const { api } = await import('../lib/api.js')
    vi.mocked(api.get).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 'h1', previousContent: 'old', editedAt: new Date().toISOString() }],
    })

    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))

    expect(result.current.showEditHistory).toBe(false)

    await act(async () => {
      await result.current.toggleEditHistory()
    })

    expect(result.current.showEditHistory).toBe(true)
  })

  it('toggleEditHistory hides history on second call', async () => {
    const { api } = await import('../lib/api.js')
    vi.mocked(api.get).mockResolvedValue({ ok: true, data: [] })

    const message = makeMessage()
    const { result } = renderHook(() => useMessageActions(message))

    await act(async () => {
      await result.current.toggleEditHistory()
    })
    expect(result.current.showEditHistory).toBe(true)

    await act(async () => {
      await result.current.toggleEditHistory()
    })
    expect(result.current.showEditHistory).toBe(false)
  })
})
