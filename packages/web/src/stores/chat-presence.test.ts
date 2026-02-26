import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  addTypingUserAction,
  clearExpiredTypingAction,
  setUserOnlineAction,
  updateReadReceiptAction,
  selectTypingNamesFromState,
  type ReadReceipt,
} from './chat-presence.js'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('addTypingUserAction', () => {
  it('adds a typing user to the map', () => {
    const typing = new Map<string, { username: string; expiresAt: number }>()
    const result = addTypingUserAction(typing, 'room-1', 'user-1', 'Alice')

    const entry = result.get('room-1:user-1')
    expect(entry).toBeDefined()
    expect(entry!.username).toBe('Alice')
    expect(entry!.expiresAt).toBeGreaterThan(Date.now())
  })

  it('does not duplicate same user — overwrites with updated expiry', () => {
    let typing = new Map<string, { username: string; expiresAt: number }>()
    typing = addTypingUserAction(typing, 'room-1', 'user-1', 'Alice')
    const firstExpiry = typing.get('room-1:user-1')!.expiresAt

    typing = addTypingUserAction(typing, 'room-1', 'user-1', 'Alice')
    const secondExpiry = typing.get('room-1:user-1')!.expiresAt

    let count = 0
    for (const key of typing.keys()) {
      if (key === 'room-1:user-1') count++
    }
    expect(count).toBe(1)
    expect(secondExpiry).toBeGreaterThanOrEqual(firstExpiry)
  })

  it('allows different users in the same room', () => {
    let typing = new Map<string, { username: string; expiresAt: number }>()
    typing = addTypingUserAction(typing, 'room-1', 'user-1', 'Alice')
    typing = addTypingUserAction(typing, 'room-1', 'user-2', 'Bob')

    expect(typing.has('room-1:user-1')).toBe(true)
    expect(typing.has('room-1:user-2')).toBe(true)
    expect(typing.size).toBe(2)
  })

  it('allows same user in different rooms', () => {
    let typing = new Map<string, { username: string; expiresAt: number }>()
    typing = addTypingUserAction(typing, 'room-1', 'user-1', 'Alice')
    typing = addTypingUserAction(typing, 'room-2', 'user-1', 'Alice')

    expect(typing.has('room-1:user-1')).toBe(true)
    expect(typing.has('room-2:user-1')).toBe(true)
    expect(typing.size).toBe(2)
  })

  it('enforces MAX_TYPING_ENTRIES (500) cap', () => {
    let typing = new Map<string, { username: string; expiresAt: number }>()
    for (let i = 0; i < 501; i++) {
      typing = addTypingUserAction(typing, 'room-1', `user-${i}`, `User ${i}`)
    }
    expect(typing.size).toBeLessThanOrEqual(500)
  })

  it('does not mutate the original map', () => {
    const typing = new Map<string, { username: string; expiresAt: number }>()
    addTypingUserAction(typing, 'room-1', 'user-1', 'Alice')
    expect(typing.size).toBe(0)
  })
})

describe('clearExpiredTypingAction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('removes expired typing indicators', () => {
    const expired = Date.now() - 1000
    const fresh = Date.now() + 5000
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-1:user-1', { username: 'Alice', expiresAt: expired }],
      ['room-1:user-2', { username: 'Bob', expiresAt: fresh }],
    ])

    const result = clearExpiredTypingAction(typing)

    expect(result).not.toBeNull()
    expect(result!.has('room-1:user-1')).toBe(false)
    expect(result!.has('room-1:user-2')).toBe(true)
  })

  it('returns null when no entries are expired', () => {
    const future = Date.now() + 10_000
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-1:user-1', { username: 'Alice', expiresAt: future }],
    ])

    const result = clearExpiredTypingAction(typing)
    expect(result).toBeNull()
  })

  it('returns null for an empty map', () => {
    const typing = new Map<string, { username: string; expiresAt: number }>()
    const result = clearExpiredTypingAction(typing)
    expect(result).toBeNull()
  })

  it('removes all entries when all are expired', () => {
    const expired = Date.now() - 1000
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-1:user-1', { username: 'Alice', expiresAt: expired }],
      ['room-1:user-2', { username: 'Bob', expiresAt: expired }],
    ])

    const result = clearExpiredTypingAction(typing)
    expect(result).not.toBeNull()
    expect(result!.size).toBe(0)
  })

  it('does not mutate the original map', () => {
    const expired = Date.now() - 1000
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-1:user-1', { username: 'Alice', expiresAt: expired }],
    ])
    clearExpiredTypingAction(typing)
    expect(typing.size).toBe(1)
  })
})

describe('setUserOnlineAction', () => {
  it('adds a user to the online set when online=true', () => {
    const onlineUsers = new Set<string>()
    const result = setUserOnlineAction(onlineUsers, 'user-1', true)
    expect(result.has('user-1')).toBe(true)
  })

  it('removes a user from the online set when online=false', () => {
    const onlineUsers = new Set<string>(['user-1', 'user-2'])
    const result = setUserOnlineAction(onlineUsers, 'user-1', false)
    expect(result.has('user-1')).toBe(false)
    expect(result.has('user-2')).toBe(true)
  })

  it('is idempotent for adding same user twice', () => {
    let onlineUsers = new Set<string>()
    onlineUsers = setUserOnlineAction(onlineUsers, 'user-1', true)
    onlineUsers = setUserOnlineAction(onlineUsers, 'user-1', true)
    expect(onlineUsers.size).toBe(1)
  })

  it('is a no-op when removing a non-existent user', () => {
    const onlineUsers = new Set<string>(['user-1'])
    const result = setUserOnlineAction(onlineUsers, 'user-999', false)
    expect(result.size).toBe(1)
    expect(result.has('user-1')).toBe(true)
  })

  it('does not mutate the original set', () => {
    const onlineUsers = new Set<string>()
    setUserOnlineAction(onlineUsers, 'user-1', true)
    expect(onlineUsers.size).toBe(0)
  })
})

describe('updateReadReceiptAction', () => {
  it('adds a new read receipt for a room', () => {
    const receipts = new Map<string, ReadReceipt[]>()
    const result = updateReadReceiptAction(
      receipts,
      'room-1',
      'user-1',
      'Alice',
      '2024-01-01T00:00:00Z',
    )

    const roomReceipts = result.get('room-1')!
    expect(roomReceipts).toHaveLength(1)
    expect(roomReceipts[0].userId).toBe('user-1')
    expect(roomReceipts[0].username).toBe('Alice')
    expect(roomReceipts[0].lastReadAt).toBe('2024-01-01T00:00:00Z')
  })

  it('updates existing receipt for same user (no duplicates)', () => {
    const receipts = new Map<string, ReadReceipt[]>([
      ['room-1', [{ userId: 'user-1', username: 'Alice', lastReadAt: '2024-01-01T00:00:00Z' }]],
    ])

    const result = updateReadReceiptAction(
      receipts,
      'room-1',
      'user-1',
      'Alice',
      '2024-01-02T00:00:00Z',
    )

    const roomReceipts = result.get('room-1')!
    expect(roomReceipts).toHaveLength(1)
    expect(roomReceipts[0].lastReadAt).toBe('2024-01-02T00:00:00Z')
  })

  it('adds receipts for different users in the same room', () => {
    let receipts = new Map<string, ReadReceipt[]>()
    receipts = updateReadReceiptAction(
      receipts,
      'room-1',
      'user-1',
      'Alice',
      '2024-01-01T00:00:00Z',
    )
    receipts = updateReadReceiptAction(receipts, 'room-1', 'user-2', 'Bob', '2024-01-01T00:00:00Z')

    expect(receipts.get('room-1')!).toHaveLength(2)
  })

  it('caps receipts at MAX_RECEIPTS_PER_ROOM (100)', () => {
    const existing: ReadReceipt[] = Array.from({ length: 100 }, (_, i) => ({
      userId: `user-${i}`,
      username: `User ${i}`,
      lastReadAt: '2024-01-01T00:00:00Z',
    }))
    const receipts = new Map<string, ReadReceipt[]>([['room-1', existing]])

    const result = updateReadReceiptAction(
      receipts,
      'room-1',
      'user-new',
      'New User',
      '2024-01-02T00:00:00Z',
    )

    expect(result.get('room-1')!.length).toBeLessThanOrEqual(100)
  })

  it('does not mutate the original map', () => {
    const receipts = new Map<string, ReadReceipt[]>()
    updateReadReceiptAction(receipts, 'room-1', 'user-1', 'Alice', '2024-01-01T00:00:00Z')
    expect(receipts.size).toBe(0)
  })
})

describe('selectTypingNamesFromState', () => {
  it('returns typing names for a specific room', () => {
    const future = Date.now() + 5000
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-1:user-1', { username: 'Alice', expiresAt: future }],
      ['room-1:user-2', { username: 'Bob', expiresAt: future }],
      ['room-2:user-3', { username: 'Charlie', expiresAt: future }],
    ])

    const names = selectTypingNamesFromState(typing, 'room-1', undefined)
    expect(names).toContain('Alice')
    expect(names).toContain('Bob')
    expect(names).not.toContain('Charlie')
  })

  it('excludes the current user from typing names', () => {
    const future = Date.now() + 5000
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-1:user-1', { username: 'Alice', expiresAt: future }],
      ['room-1:user-2', { username: 'Bob', expiresAt: future }],
    ])

    const names = selectTypingNamesFromState(typing, 'room-1', 'user-1')
    expect(names).not.toContain('Alice')
    expect(names).toContain('Bob')
  })

  it('returns empty array when roomId is null', () => {
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-1:user-1', { username: 'Alice', expiresAt: Date.now() + 5000 }],
    ])

    const names = selectTypingNamesFromState(typing, null, undefined)
    expect(names).toEqual([])
  })

  it('returns empty array when no users are typing in the room', () => {
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-2:user-1', { username: 'Alice', expiresAt: Date.now() + 5000 }],
    ])

    const names = selectTypingNamesFromState(typing, 'room-1', undefined)
    expect(names).toEqual([])
  })

  it('excludes expired typing entries', () => {
    const expired = Date.now() - 1000
    const fresh = Date.now() + 5000
    const typing = new Map<string, { username: string; expiresAt: number }>([
      ['room-1:user-1', { username: 'Alice', expiresAt: expired }],
      ['room-1:user-2', { username: 'Bob', expiresAt: fresh }],
    ])

    const names = selectTypingNamesFromState(typing, 'room-1', undefined)
    expect(names).not.toContain('Alice')
    expect(names).toContain('Bob')
  })

  it('returns empty array for empty typing map', () => {
    const typing = new Map<string, { username: string; expiresAt: number }>()
    const names = selectTypingNamesFromState(typing, 'room-1', undefined)
    expect(names).toEqual([])
  })

  it('returns same reference for empty result (referential stability)', () => {
    const typing = new Map<string, { username: string; expiresAt: number }>()
    const names1 = selectTypingNamesFromState(typing, 'room-1', undefined)
    const names2 = selectTypingNamesFromState(typing, 'room-1', undefined)
    expect(names1).toBe(names2)
  })
})
