import { describe, it, expect } from 'vitest'
import type { Message, ParsedChunk } from '@agentim/shared'
import {
  addStreamChunkAction,
  completeStreamAction,
  addTerminalDataAction,
  cleanupStaleStreamsAction,
  type StreamingMessage,
  type TerminalBuffer,
} from './chat-streaming.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeStreamingMessage(overrides: Partial<StreamingMessage> = {}): StreamingMessage {
  return {
    messageId: 'sm-1',
    agentId: 'agent-1',
    agentName: 'Agent A',
    chunks: [],
    lastChunkAt: Date.now(),
    ...overrides,
  }
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    roomId: 'room-1',
    senderId: 'agent-1',
    senderType: 'agent',
    senderName: 'Agent A',
    type: 'text',
    content: 'Hello',
    createdAt: new Date().toISOString(),
    mentions: [],
    reactions: [],
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('addStreamChunkAction', () => {
  it('creates a new stream entry when none exists', () => {
    const streaming = new Map<string, StreamingMessage>()
    const chunk: ParsedChunk = { type: 'text', content: 'Hello' }
    const result = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', chunk)

    expect(result.truncated).toBe(false)
    const entry = result.streaming.get('room-1:agent-1')
    expect(entry).toBeDefined()
    expect(entry!.messageId).toBe('sm-1')
    expect(entry!.agentId).toBe('agent-1')
    expect(entry!.agentName).toBe('Agent A')
    expect(entry!.chunks).toHaveLength(1)
    expect(entry!.chunks[0]).toEqual(chunk)
    expect(entry!.lastChunkAt).toBeGreaterThan(0)
  })

  it('appends text chunks to an existing stream', () => {
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ chunks: [{ type: 'text', content: 'First' }] })],
    ])
    const chunk: ParsedChunk = { type: 'text', content: ' Second' }
    const result = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', chunk)

    expect(result.truncated).toBe(false)
    const entry = result.streaming.get('room-1:agent-1')!
    expect(entry.chunks).toHaveLength(2)
    expect(entry.chunks[0].content).toBe('First')
    expect(entry.chunks[1].content).toBe(' Second')
  })

  it('appends thinking chunks correctly', () => {
    const streaming = new Map<string, StreamingMessage>()
    const chunk: ParsedChunk = { type: 'thinking', content: 'Reasoning...' }
    const result = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', chunk)

    const entry = result.streaming.get('room-1:agent-1')!
    expect(entry.chunks).toHaveLength(1)
    expect(entry.chunks[0].type).toBe('thinking')
    expect(entry.chunks[0].content).toBe('Reasoning...')
  })

  it('appends tool_use chunks correctly', () => {
    const streaming = new Map<string, StreamingMessage>()
    const chunk: ParsedChunk = { type: 'tool_use', content: 'tool_call(...)' }
    const result = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', chunk)

    const entry = result.streaming.get('room-1:agent-1')!
    expect(entry.chunks).toHaveLength(1)
    expect(entry.chunks[0].type).toBe('tool_use')
  })

  it('accumulates content from multiple chunks', () => {
    let streaming = new Map<string, StreamingMessage>()
    ;({ streaming } = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', {
      type: 'text',
      content: 'Hello',
    }))
    ;({ streaming } = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', {
      type: 'text',
      content: ' World',
    }))
    ;({ streaming } = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', {
      type: 'text',
      content: '!',
    }))

    const entry = streaming.get('room-1:agent-1')!
    expect(entry.chunks).toHaveLength(3)
    const combined = entry.chunks.map((c) => c.content).join('')
    expect(combined).toBe('Hello World!')
  })

  it('truncates oldest chunk when exceeding MAX_CHUNKS_PER_STREAM (2000)', () => {
    const chunks: ParsedChunk[] = Array.from({ length: 2000 }, (_, i) => ({
      type: 'text' as const,
      content: `chunk-${i}`,
    }))
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ chunks })],
    ])

    const result = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', {
      type: 'text',
      content: 'overflow',
    })

    expect(result.truncated).toBe(true)
    const entry = result.streaming.get('room-1:agent-1')!
    expect(entry.chunks).toHaveLength(2000)
    expect(entry.chunks[0].content).toBe('chunk-1')
    expect(entry.chunks[entry.chunks.length - 1].content).toBe('overflow')
  })

  it('does not truncate when below MAX_CHUNKS_PER_STREAM', () => {
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ chunks: [{ type: 'text', content: 'first' }] })],
    ])

    const result = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', {
      type: 'text',
      content: 'second',
    })

    expect(result.truncated).toBe(false)
    expect(result.streaming.get('room-1:agent-1')!.chunks).toHaveLength(2)
  })

  it('does not mutate the original map', () => {
    const streaming = new Map<string, StreamingMessage>()
    addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', {
      type: 'text',
      content: 'x',
    })
    expect(streaming.size).toBe(0)
  })

  it('updates lastChunkAt on each chunk', () => {
    const oldTime = Date.now() - 10_000
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ lastChunkAt: oldTime })],
    ])

    const result = addStreamChunkAction(streaming, 'room-1', 'agent-1', 'Agent A', 'sm-1', {
      type: 'text',
      content: 'x',
    })
    expect(result.streaming.get('room-1:agent-1')!.lastChunkAt).toBeGreaterThan(oldTime)
  })
})

describe('completeStreamAction', () => {
  it('removes the stream entry for the completed message', () => {
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage()],
      ['room-2:agent-2', makeStreamingMessage({ agentId: 'agent-2' })],
    ])

    const msg = makeMessage({ id: 'sm-1', roomId: 'room-1', senderId: 'agent-1' })
    const result = completeStreamAction(streaming, msg)

    expect(result.has('room-1:agent-1')).toBe(false)
    expect(result.has('room-2:agent-2')).toBe(true)
  })

  it('returns a new map even if key does not exist', () => {
    const streaming = new Map<string, StreamingMessage>()
    const msg = makeMessage({ roomId: 'room-1', senderId: 'agent-1' })
    const result = completeStreamAction(streaming, msg)

    expect(result).not.toBe(streaming)
    expect(result.size).toBe(0)
  })

  it('does not mutate the original map', () => {
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage()],
    ])
    const msg = makeMessage({ roomId: 'room-1', senderId: 'agent-1' })
    completeStreamAction(streaming, msg)

    expect(streaming.has('room-1:agent-1')).toBe(true)
  })
})

describe('addTerminalDataAction', () => {
  it('creates a new buffer when none exists', () => {
    const buffers = new Map<string, TerminalBuffer>()
    const result = addTerminalDataAction(buffers, 'agent-1', 'Agent A', 'line 1')

    const buf = result.get('agent-1')!
    expect(buf.agentName).toBe('Agent A')
    expect(buf.lines).toEqual(['line 1'])
    expect(buf.totalPushed).toBe(1)
  })

  it('appends data to an existing buffer', () => {
    const buffers = new Map<string, TerminalBuffer>([
      ['agent-1', { agentName: 'Agent A', lines: ['line 1'], totalPushed: 1 }],
    ])
    const result = addTerminalDataAction(buffers, 'agent-1', 'Agent A', 'line 2')

    const buf = result.get('agent-1')!
    expect(buf.lines).toEqual(['line 1', 'line 2'])
    expect(buf.totalPushed).toBe(2)
  })

  it('truncates to MAX_TERMINAL_LINES (500) when exceeded', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`)
    const buffers = new Map<string, TerminalBuffer>([
      ['agent-1', { agentName: 'Agent A', lines, totalPushed: 500 }],
    ])

    const result = addTerminalDataAction(buffers, 'agent-1', 'Agent A', 'overflow')

    const buf = result.get('agent-1')!
    expect(buf.lines).toHaveLength(500)
    expect(buf.lines[0]).toBe('line-1')
    expect(buf.lines[buf.lines.length - 1]).toBe('overflow')
    expect(buf.totalPushed).toBe(501)
  })

  it('does not truncate when at exactly MAX_TERMINAL_LINES', () => {
    const lines = Array.from({ length: 499 }, (_, i) => `line-${i}`)
    const buffers = new Map<string, TerminalBuffer>([
      ['agent-1', { agentName: 'Agent A', lines, totalPushed: 499 }],
    ])

    const result = addTerminalDataAction(buffers, 'agent-1', 'Agent A', 'last')

    const buf = result.get('agent-1')!
    expect(buf.lines).toHaveLength(500)
    expect(buf.lines[0]).toBe('line-0')
  })

  it('updates agentName on subsequent calls', () => {
    const buffers = new Map<string, TerminalBuffer>([
      ['agent-1', { agentName: 'OldName', lines: ['x'], totalPushed: 1 }],
    ])
    const result = addTerminalDataAction(buffers, 'agent-1', 'NewName', 'y')
    expect(result.get('agent-1')!.agentName).toBe('NewName')
  })

  it('does not mutate the original map', () => {
    const buffers = new Map<string, TerminalBuffer>()
    addTerminalDataAction(buffers, 'agent-1', 'Agent A', 'x')
    expect(buffers.size).toBe(0)
  })
})

describe('cleanupStaleStreamsAction', () => {
  it('removes offline agent streams after 30s grace period', () => {
    const staleTime = Date.now() - 31_000
    const freshTime = Date.now()
    const streaming = new Map<string, StreamingMessage>([
      [
        'room-1:agent-stale',
        makeStreamingMessage({ agentId: 'agent-stale', lastChunkAt: staleTime }),
      ],
      [
        'room-1:agent-fresh',
        makeStreamingMessage({ agentId: 'agent-fresh', lastChunkAt: freshTime }),
      ],
    ])

    // Neither agent is online
    const result = cleanupStaleStreamsAction(streaming, new Set())

    expect(result).not.toBeNull()
    expect(result!.next.has('room-1:agent-stale')).toBe(false)
    expect(result!.next.has('room-1:agent-fresh')).toBe(true)
    expect(result!.stale).toHaveLength(1)
    expect(result!.stale[0].agentId).toBe('agent-stale')
    expect(result!.stale[0].roomId).toBe('room-1')
  })

  it('does NOT remove online agent streams regardless of elapsed time', () => {
    const longAgo = Date.now() - 600_000 // 10 minutes
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ agentId: 'agent-1', lastChunkAt: longAgo })],
    ])

    // Agent is online
    const result = cleanupStaleStreamsAction(streaming, new Set(['agent-1']))

    expect(result).toBeNull()
  })

  it('removes online agent streams after absolute timeout (1 hour)', () => {
    const overOneHour = Date.now() - 3_601_000
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ agentId: 'agent-1', lastChunkAt: overOneHour })],
    ])

    // Agent is online but stream is over 1 hour old
    const result = cleanupStaleStreamsAction(streaming, new Set(['agent-1']))

    expect(result).not.toBeNull()
    expect(result!.stale).toHaveLength(1)
  })

  it('returns null when no streams are stale', () => {
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ lastChunkAt: Date.now() })],
    ])
    const result = cleanupStaleStreamsAction(streaming, new Set())
    expect(result).toBeNull()
  })

  it('returns null for an empty streaming map', () => {
    const streaming = new Map<string, StreamingMessage>()
    const result = cleanupStaleStreamsAction(streaming, new Set())
    expect(result).toBeNull()
  })

  it('removes all offline streams when all are stale', () => {
    const longAgo = Date.now() - 31_000
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ lastChunkAt: longAgo })],
      ['room-2:agent-2', makeStreamingMessage({ agentId: 'agent-2', lastChunkAt: longAgo })],
    ])

    const result = cleanupStaleStreamsAction(streaming, new Set())

    expect(result).not.toBeNull()
    expect(result!.next.size).toBe(0)
    expect(result!.stale).toHaveLength(2)
  })

  it('falls back to offline behavior when onlineAgentIds is not provided', () => {
    const staleTime = Date.now() - 31_000
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ lastChunkAt: staleTime })],
    ])

    // No onlineAgentIds passed — treats all agents as offline
    const result = cleanupStaleStreamsAction(streaming)

    expect(result).not.toBeNull()
    expect(result!.stale).toHaveLength(1)
  })

  it('does not mutate the original map', () => {
    const staleTime = Date.now() - 31_000
    const streaming = new Map<string, StreamingMessage>([
      ['room-1:agent-1', makeStreamingMessage({ lastChunkAt: staleTime })],
    ])
    cleanupStaleStreamsAction(streaming, new Set())
    expect(streaming.size).toBe(1)
  })
})
