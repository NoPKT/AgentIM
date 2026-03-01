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
/** Grace period after an agent goes offline before cleaning up its stream. */
const OFFLINE_STALE_TIMEOUT = 30_000 // 30 seconds
/** Absolute safety-net timeout regardless of agent status (zombie stream protection). */
const ABSOLUTE_STALE_TIMEOUT = 3_600_000 // 1 hour

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
  if (existing && existing.messageId === messageId) {
    // Same message — append chunk
    truncated = existing.chunks.length >= MAX_CHUNKS_PER_STREAM
    const chunks = truncated
      ? [...existing.chunks.slice(-MAX_CHUNKS_PER_STREAM + 1), chunk]
      : [...existing.chunks, chunk]
    next.set(key, { ...existing, chunks, lastChunkAt: now })
  } else {
    // New stream or different messageId — start fresh
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

export interface StaleStreamEntry extends StreamingMessage {
  roomId: string
}

/**
 * Determine which streams are stale based on agent online status:
 * - Agent online/busy → stream is NOT stale (agent is still working)
 * - Agent offline/error → stale after OFFLINE_STALE_TIMEOUT (30s grace period)
 * - Safety net: any stream older than ABSOLUTE_STALE_TIMEOUT (1h) regardless of status
 *
 * @param onlineAgentIds - Set of agent IDs currently online or busy
 */
export function cleanupStaleStreamsAction(
  streaming: Map<string, StreamingMessage>,
  onlineAgentIds?: Set<string>,
): { next: Map<string, StreamingMessage>; stale: StaleStreamEntry[] } | null {
  const now = Date.now()
  const next = new Map(streaming)
  const stale: StaleStreamEntry[] = []
  for (const [key, stream] of next) {
    const elapsed = now - stream.lastChunkAt
    const isAgentOnline = onlineAgentIds?.has(stream.agentId) ?? false

    // Agent still online/busy — only clean up after absolute timeout (zombie protection)
    // Agent offline — clean up after short grace period
    const isStale = isAgentOnline
      ? elapsed > ABSOLUTE_STALE_TIMEOUT
      : elapsed > OFFLINE_STALE_TIMEOUT

    if (isStale) {
      // Key format is "roomId:agentId" — extract roomId
      const separatorIdx = key.indexOf(':')
      const roomId = separatorIdx > 0 ? key.slice(0, separatorIdx) : key
      stale.push({ ...stream, roomId })
      next.delete(key)
    }
  }
  return stale.length > 0 ? { next, stale } : null
}
