/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Message } from '@agentim/shared'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../stores/auth.js', () => ({
  useAuthStore: vi.fn((sel?: (s: unknown) => unknown) =>
    sel ? sel({ user: { id: 'user-1', username: 'admin' } }) : {},
  ),
}))

vi.mock('../lib/ws.js', () => ({
  wsClient: { send: vi.fn(), status: 'connected', onMessage: vi.fn(), onReconnect: vi.fn() },
}))

vi.mock('../stores/agents.js', () => ({
  useAgentStore: Object.assign(
    vi.fn(() => ({ agents: [] })),
    {
      getState: () => ({ agents: [] }),
    },
  ),
}))

// Minimal mock for useChatStore — overridden per test
const mockChatState = {
  currentRoomId: 'room-1',
  messages: new Map<string, Message[]>(),
  hasMore: new Map<string, boolean>(),
  loadMessages: vi.fn(),
  loadingMessages: new Set<string>(),
  streaming: new Map(),
  readReceipts: new Map(),
}

vi.mock('../stores/chat.js', () => ({
  useChatStore: Object.assign(
    vi.fn((sel?: (s: unknown) => unknown) => (sel ? sel(mockChatState) : mockChatState)),
    { getState: () => mockChatState },
  ),
}))

vi.mock('./StreamingMessage.js', () => ({
  StreamingMessage: () => null,
}))

vi.mock('./MessageItem.js', () => ({
  MessageItem: ({ message, showHeader }: { message: Message; showHeader: boolean }) => (
    <div data-testid={`msg-${message.id}`} data-show-header={showHeader}>
      <span data-testid={`sender-${message.id}`}>{message.senderName}</span>
      <span data-testid={`time-${message.id}`}>{message.createdAt}</span>
      <span data-testid={`content-${message.id}`}>{message.content}</span>
    </div>
  ),
}))

// Mock @tanstack/react-virtual to render items without actual virtualisation
// so we can inspect the DOM ordering deterministically.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: {
    count: number
    estimateSize: (i: number) => number
    getItemKey: (i: number) => string | number
  }) => {
    const items = Array.from({ length: opts.count }, (_, i) => ({
      index: i,
      key: opts.getItemKey(i),
      start: i * 80,
      size: 80,
    }))
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * 80,
      measure: vi.fn(),
      measureElement: vi.fn(),
      scrollToIndex: vi.fn(),
    }
  },
}))

vi.mock('zustand/shallow', () => ({
  useShallow: (fn: (...args: unknown[]) => unknown) => fn,
}))

import { MessageList } from './MessageList.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    roomId: 'room-1',
    senderId: 'user-1',
    senderType: 'user',
    senderName: 'admin',
    type: 'text',
    content: 'hello',
    createdAt: '2024-01-01T00:00:00Z',
    mentions: [],
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MessageList', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockChatState.currentRoomId = 'room-1'
    mockChatState.messages = new Map()
    mockChatState.hasMore = new Map()
    mockChatState.loadingMessages = new Set()
    mockChatState.streaming = new Map()
    mockChatState.readReceipts = new Map()
  })

  it('renders messages in DOM order matching data order', () => {
    const msgs: Message[] = [
      makeMsg({ id: 'a', createdAt: '2024-01-01T00:00:00Z', content: 'first' }),
      makeMsg({ id: 'b', createdAt: '2024-01-02T00:00:00Z', content: 'second' }),
      makeMsg({ id: 'c', createdAt: '2024-01-03T00:00:00Z', content: 'third' }),
    ]
    mockChatState.messages = new Map([['room-1', msgs]])

    render(<MessageList />)

    const elements = screen.getAllByTestId(/^msg-/)
    expect(elements).toHaveLength(3)
    expect(elements[0].dataset.testid).toBe('msg-a')
    expect(elements[1].dataset.testid).toBe('msg-b')
    expect(elements[2].dataset.testid).toBe('msg-c')
  })

  it('renders no duplicate DOM elements for unique messages', () => {
    const msgs: Message[] = [
      makeMsg({ id: 'x', createdAt: '2024-01-01T00:00:00Z' }),
      makeMsg({ id: 'y', createdAt: '2024-01-02T00:00:00Z' }),
    ]
    mockChatState.messages = new Map([['room-1', msgs]])

    render(<MessageList />)

    const elements = screen.getAllByTestId(/^msg-/)
    const ids = elements.map((el) => el.dataset.testid)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  it('shows header for first message and different senders', () => {
    const msgs: Message[] = [
      makeMsg({ id: 'm1', senderId: 'user-1', createdAt: '2024-01-01T00:00:00Z' }),
      makeMsg({ id: 'm2', senderId: 'user-1', createdAt: '2024-01-01T00:01:00Z' }),
      makeMsg({
        id: 'm3',
        senderId: 'agent-1',
        senderType: 'agent',
        createdAt: '2024-01-01T00:02:00Z',
      }),
    ]
    mockChatState.messages = new Map([['room-1', msgs]])

    render(<MessageList />)

    // First message always shows header
    expect(screen.getByTestId('msg-m1').dataset.showHeader).toBe('true')
    // Same sender within 5 min: no header
    expect(screen.getByTestId('msg-m2').dataset.showHeader).toBe('false')
    // Different sender: header
    expect(screen.getByTestId('msg-m3').dataset.showHeader).toBe('true')
  })

  it('shows header when time gap exceeds 5 minutes', () => {
    const msgs: Message[] = [
      makeMsg({ id: 'm1', senderId: 'user-1', createdAt: '2024-01-01T00:00:00Z' }),
      makeMsg({ id: 'm2', senderId: 'user-1', createdAt: '2024-01-01T00:06:00Z' }),
    ]
    mockChatState.messages = new Map([['room-1', msgs]])

    render(<MessageList />)

    expect(screen.getByTestId('msg-m1').dataset.showHeader).toBe('true')
    expect(screen.getByTestId('msg-m2').dataset.showHeader).toBe('true')
  })

  it('system messages always get header', () => {
    const msgs: Message[] = [
      makeMsg({ id: 'm1', senderId: 'user-1', createdAt: '2024-01-01T00:00:00Z' }),
      makeMsg({
        id: 'm2',
        senderId: 'system',
        senderType: 'system',
        createdAt: '2024-01-01T00:00:01Z',
      }),
      makeMsg({ id: 'm3', senderId: 'user-1', createdAt: '2024-01-01T00:00:02Z' }),
    ]
    mockChatState.messages = new Map([['room-1', msgs]])

    render(<MessageList />)

    expect(screen.getByTestId('msg-m2').dataset.showHeader).toBe('true')
    // Message after system message also gets header
    expect(screen.getByTestId('msg-m3').dataset.showHeader).toBe('true')
  })

  it('renders empty state when no messages', () => {
    mockChatState.messages = new Map([['room-1', []]])

    render(<MessageList />)

    expect(screen.getByText('chat.noMessages')).toBeTruthy()
  })

  it('renders many messages without duplicate keys', () => {
    const msgs: Message[] = Array.from({ length: 50 }, (_, i) =>
      makeMsg({
        id: `msg-${String(i).padStart(3, '0')}`,
        createdAt: `2024-01-01T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
        content: `Message ${i}`,
      }),
    )
    mockChatState.messages = new Map([['room-1', msgs]])

    render(<MessageList />)

    const elements = screen.getAllByTestId(/^msg-/)
    expect(elements).toHaveLength(50)

    // Verify DOM order matches data order
    for (let i = 0; i < 50; i++) {
      const expectedId = `msg-${String(i).padStart(3, '0')}`
      expect(elements[i].dataset.testid).toBe(`msg-${expectedId}`)
    }
  })

  it('renders messages from multiple senders in correct interleaved order', () => {
    const msgs: Message[] = [
      makeMsg({
        id: 'u1',
        senderId: 'user-1',
        senderName: 'admin',
        createdAt: '2024-01-01T01:38:00Z',
        content: '@gemini hi',
      }),
      makeMsg({
        id: 'a1',
        senderId: 'agent-1',
        senderType: 'agent',
        senderName: 'gemini',
        createdAt: '2024-01-01T01:38:01Z',
        content: '[Model: gemini]',
      }),
      makeMsg({
        id: 'u2',
        senderId: 'user-1',
        senderName: 'admin',
        createdAt: '2024-01-01T02:26:00Z',
        content: '@Gemini hello',
      }),
      makeMsg({
        id: 'a2',
        senderId: 'agent-1',
        senderType: 'agent',
        senderName: 'Gemini',
        createdAt: '2024-01-01T02:26:30Z',
        content: 'Hi! How can I help?',
      }),
      makeMsg({
        id: 'u3',
        senderId: 'user-1',
        senderName: 'admin',
        createdAt: '2024-01-01T02:27:00Z',
        content: '@Gemini another',
      }),
    ]
    mockChatState.messages = new Map([['room-1', msgs]])

    render(<MessageList />)

    const elements = screen.getAllByTestId(/^msg-/)
    expect(elements.map((el) => el.dataset.testid)).toEqual([
      'msg-u1',
      'msg-a1',
      'msg-u2',
      'msg-a2',
      'msg-u3',
    ])
  })
})
