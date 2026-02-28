/**
 * Streaming and terminal buffer actions extracted from chat store.
 * These are pure helper functions that operate on state snapshots
 * and return partial state updates — no store coupling.
 */
import type { Message, ParsedChunk } from '@agentim/shared'

export interface StreamingMessage {
  messageId: string
  agentId: string
  agentName: string
  chunks: ParsedChunk[]
  lastChunkAt: number
}

export interface TerminalBuffer {
  agentName: string
  lines: string[]
  /** Monotonic counter — total lines ever pushed (survives slice truncation). */
  totalPushed: number
}

const MAX_CHUNKS_PER_STREAM = 2000
const MAX_TERMINAL_LINES = 500
const STALE_TIMEOUT = 30_000 // 30 seconds

export function addStreamChunkAction(
  streaming: Map<string, StreamingMessage>,
  roomId: string,
  agentId: string,
  agentName: string,
  messageId: string,
  chunk: ParsedChunk,
): { streaming: Map<string, StreamingMessage>; truncated: boolean } {
  const next = new Map(streaming)
  const key = `${roomId}:${agentId}`
  const existing = next.get(key)
  const now = Date.now()
  let truncated = false
  if (existing) {
    truncated = existing.chunks.length >= MAX_CHUNKS_PER_STREAM
    const chunks = truncated
      ? [...existing.chunks.slice(-MAX_CHUNKS_PER_STREAM + 1), chunk]
      : [...existing.chunks, chunk]
    next.set(key, { ...existing, chunks, lastChunkAt: now })
  } else {
    next.set(key, { messageId, agentId, agentName, chunks: [chunk], lastChunkAt: now })
  }
  return { streaming: next, truncated }
}

export function completeStreamAction(
  streaming: Map<string, StreamingMessage>,
  message: Message,
): Map<string, StreamingMessage> {
  const next = new Map(streaming)
  next.delete(`${message.roomId}:${message.senderId}`)
  return next
}

export function addTerminalDataAction(
  terminalBuffers: Map<string, TerminalBuffer>,
  agentId: string,
  agentName: string,
  data: string,
): Map<string, TerminalBuffer> {
  const next = new Map(terminalBuffers)
  const existing = next.get(agentId)
  if (existing) {
    const lines = [...existing.lines, data]
    next.set(agentId, {
      agentName,
      lines: lines.length > MAX_TERMINAL_LINES ? lines.slice(-MAX_TERMINAL_LINES) : lines,
      totalPushed: existing.totalPushed + 1,
    })
  } else {
    next.set(agentId, { agentName, lines: [data], totalPushed: 1 })
  }
  return next
}

export function cleanupStaleStreamsAction(
  streaming: Map<string, StreamingMessage>,
): Map<string, StreamingMessage> | null {
  const now = Date.now()
  const next = new Map(streaming)
  let changed = false
  for (const [key, stream] of next) {
    if (now - stream.lastChunkAt > STALE_TIMEOUT) {
      next.delete(key)
      changed = true
    }
  }
  return changed ? next : null
}
