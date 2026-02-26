import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Message, MessageAttachment } from '@agentim/shared'

// ── Mock chat store ─────────────────────────────────────────────────────────

let mockMessages = new Map<string, Message[]>()

vi.mock('../stores/chat.js', () => ({
  useChatStore: vi.fn((selector: (s: { messages: Map<string, Message[]> }) => unknown) =>
    selector({ messages: mockMessages }),
  ),
}))

const { useLightbox } = await import('./useLightbox.js')

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: 'att1',
    messageId: 'msg1',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    url: '/uploads/photo.jpg',
    ...overrides,
  }
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg1',
    roomId: 'room1',
    senderId: 'user1',
    senderName: 'testuser',
    senderType: 'user',
    type: 'text',
    content: '',
    mentions: [],
    reactions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useLightbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessages = new Map()
  })

  it('returns initial state with lightbox closed', () => {
    const { result } = renderHook(() => useLightbox('room1'))
    expect(result.current.isOpen).toBe(false)
    expect(result.current.images).toEqual([])
    expect(result.current.currentIndex).toBe(0)
  })

  it('returns empty images for null roomId', () => {
    const { result } = renderHook(() => useLightbox(null))
    expect(result.current.images).toEqual([])
  })

  it('returns empty images when room has no messages', () => {
    mockMessages.set('room1', [])
    const { result } = renderHook(() => useLightbox('room1'))
    expect(result.current.images).toEqual([])
  })

  it('extracts image URLs from message attachments', () => {
    mockMessages.set('room1', [
      makeMessage({
        id: 'msg1',
        attachments: [
          makeAttachment({ url: '/uploads/a.jpg', mimeType: 'image/jpeg' }),
          makeAttachment({ url: '/uploads/b.png', mimeType: 'image/png' }),
        ],
      }),
      makeMessage({
        id: 'msg2',
        attachments: [makeAttachment({ url: '/uploads/c.gif', mimeType: 'image/gif' })],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))
    expect(result.current.images).toEqual(['/uploads/a.jpg', '/uploads/b.png', '/uploads/c.gif'])
  })

  it('excludes non-image attachments', () => {
    mockMessages.set('room1', [
      makeMessage({
        attachments: [
          makeAttachment({ url: '/uploads/photo.jpg', mimeType: 'image/jpeg' }),
          makeAttachment({ url: '/uploads/doc.pdf', mimeType: 'application/pdf' }),
          makeAttachment({ url: '/uploads/video.mp4', mimeType: 'video/mp4' }),
        ],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))
    expect(result.current.images).toEqual(['/uploads/photo.jpg'])
  })

  it('handles messages with no attachments', () => {
    mockMessages.set('room1', [
      makeMessage({ id: 'msg1' }),
      makeMessage({
        id: 'msg2',
        attachments: [makeAttachment({ url: '/uploads/a.jpg', mimeType: 'image/jpeg' })],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))
    expect(result.current.images).toEqual(['/uploads/a.jpg'])
  })

  it('openLightbox sets isOpen=true and finds correct index', () => {
    mockMessages.set('room1', [
      makeMessage({
        attachments: [
          makeAttachment({ url: '/uploads/a.jpg', mimeType: 'image/jpeg' }),
          makeAttachment({ url: '/uploads/b.png', mimeType: 'image/png' }),
          makeAttachment({ url: '/uploads/c.gif', mimeType: 'image/gif' }),
        ],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))

    act(() => {
      result.current.openLightbox('/uploads/b.png')
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.currentIndex).toBe(1)
  })

  it('openLightbox defaults to index 0 for unknown URL', () => {
    mockMessages.set('room1', [
      makeMessage({
        attachments: [makeAttachment({ url: '/uploads/a.jpg', mimeType: 'image/jpeg' })],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))

    act(() => {
      result.current.openLightbox('/uploads/unknown.jpg')
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.currentIndex).toBe(0)
  })

  it('closeLightbox sets isOpen=false', () => {
    mockMessages.set('room1', [
      makeMessage({
        attachments: [makeAttachment({ url: '/uploads/a.jpg', mimeType: 'image/jpeg' })],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))

    act(() => {
      result.current.openLightbox('/uploads/a.jpg')
    })
    expect(result.current.isOpen).toBe(true)

    act(() => {
      result.current.closeLightbox()
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('navigateTo sets currentIndex within bounds', () => {
    mockMessages.set('room1', [
      makeMessage({
        attachments: [
          makeAttachment({ url: '/uploads/a.jpg', mimeType: 'image/jpeg' }),
          makeAttachment({ url: '/uploads/b.png', mimeType: 'image/png' }),
          makeAttachment({ url: '/uploads/c.gif', mimeType: 'image/gif' }),
        ],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))

    act(() => {
      result.current.navigateTo(2)
    })
    expect(result.current.currentIndex).toBe(2)

    act(() => {
      result.current.navigateTo(0)
    })
    expect(result.current.currentIndex).toBe(0)
  })

  it('navigateTo ignores out-of-bounds index (negative)', () => {
    mockMessages.set('room1', [
      makeMessage({
        attachments: [makeAttachment({ url: '/uploads/a.jpg', mimeType: 'image/jpeg' })],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))

    act(() => {
      result.current.navigateTo(-1)
    })
    expect(result.current.currentIndex).toBe(0)
  })

  it('navigateTo ignores out-of-bounds index (too large)', () => {
    mockMessages.set('room1', [
      makeMessage({
        attachments: [
          makeAttachment({ url: '/uploads/a.jpg', mimeType: 'image/jpeg' }),
          makeAttachment({ url: '/uploads/b.png', mimeType: 'image/png' }),
        ],
      }),
    ])

    const { result } = renderHook(() => useLightbox('room1'))

    act(() => {
      result.current.navigateTo(5)
    })
    expect(result.current.currentIndex).toBe(0)
  })
})
