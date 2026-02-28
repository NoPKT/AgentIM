import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock idb before importing message-cache
const mockStore: Record<string, unknown> = {}
const mockDb = {
  put: vi.fn((_storeName: string, value: any) => {
    mockStore[value.id ?? value.roomId] = value
    return Promise.resolve()
  }),
  get: vi.fn((_storeName: string, key: string) => {
    return Promise.resolve(mockStore[key])
  }),
  getAll: vi.fn(() => Promise.resolve(Object.values(mockStore))),
  getAllFromIndex: vi.fn(() => Promise.resolve([])),
  getAllKeysFromIndex: vi.fn(() => Promise.resolve([])),
  delete: vi.fn((_storeName: string, key: string) => {
    delete mockStore[key]
    return Promise.resolve()
  }),
  transaction: vi.fn(() => ({
    objectStore: vi.fn(() => ({
      clear: vi.fn(() => Promise.resolve()),
      put: vi.fn((val: any) => {
        mockStore[val.id ?? val.roomId] = val
        return Promise.resolve()
      }),
      index: vi.fn(() => ({
        openCursor: vi.fn(() => Promise.resolve(null)),
      })),
    })),
    done: Promise.resolve(),
  })),
  objectStoreNames: {
    contains: vi.fn(() => true),
  },
}

vi.mock('idb', () => ({
  openDB: vi.fn(() => Promise.resolve(mockDb)),
}))

vi.mock('@agentim/shared', () => ({
  MAX_MESSAGES_PER_ROOM_CACHE: 200,
}))

describe('message-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear mock store
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key]
    }
  })

  describe('getCachedMessages', () => {
    it('returns empty array when no messages cached', async () => {
      const { getCachedMessages } = await import('./message-cache.js')
      const msgs = await getCachedMessages('room-1')
      expect(msgs).toEqual([])
    })
  })

  describe('addCachedMessage', () => {
    it('adds a message to the cache', async () => {
      const { addCachedMessage } = await import('./message-cache.js')
      const msg = {
        id: 'msg-1',
        roomId: 'room-1',
        senderId: 'user-1',
        senderType: 'user' as const,
        senderName: 'Alice',
        type: 'text' as const,
        content: 'Hello',
        createdAt: new Date().toISOString(),
        mentions: [],
        reactions: [],
      }

      await addCachedMessage(msg)
      expect(mockDb.put).toHaveBeenCalledWith('messages', msg)
    })
  })

  describe('setCachedRooms', () => {
    it('calls transaction to clear and re-add rooms', async () => {
      const { setCachedRooms } = await import('./message-cache.js')
      const rooms = [
        { id: 'r1', name: 'Room 1' },
        { id: 'r2', name: 'Room 2' },
      ]

      await setCachedRooms(rooms as any)
      expect(mockDb.transaction).toHaveBeenCalled()
    })
  })

  describe('clearCache', () => {
    it('clears all object stores', async () => {
      const { clearCache } = await import('./message-cache.js')
      await clearCache()
      expect(mockDb.transaction).toHaveBeenCalled()
    })
  })

  describe('pending messages', () => {
    it('addPendingMessage stores a pending message', async () => {
      const { addPendingMessage } = await import('./message-cache.js')
      const pending = {
        id: 'pending-1',
        roomId: 'room-1',
        content: 'Offline message',
        mentions: [],
        createdAt: new Date().toISOString(),
      }

      await addPendingMessage(pending)
      expect(mockDb.put).toHaveBeenCalledWith('pending-messages', pending)
    })

    it('removePendingMessage deletes from store', async () => {
      const { removePendingMessage } = await import('./message-cache.js')
      await removePendingMessage('pending-1')
      expect(mockDb.delete).toHaveBeenCalledWith('pending-messages', 'pending-1')
    })
  })

  describe('withIdbTimeout behavior', () => {
    it('handles errors gracefully in getCachedMessages', async () => {
      // Force the db to reject
      mockDb.getAllFromIndex.mockRejectedValueOnce(new Error('IDB error'))
      const { getCachedMessages } = await import('./message-cache.js')
      const msgs = await getCachedMessages('room-fail')
      // Should return empty array on error (graceful degradation)
      expect(msgs).toEqual([])
    })
  })

  describe('clearRoomCache', () => {
    it('clears messages and metadata for a specific room', async () => {
      const { clearRoomCache } = await import('./message-cache.js')
      await clearRoomCache('room-1')
      expect(mockDb.delete).toHaveBeenCalled()
    })
  })

  describe('getDraft / setDraft', () => {
    it('stores and retrieves a draft', async () => {
      const { setDraft } = await import('./message-cache.js')
      await setDraft('room-1', 'hello draft')
      expect(mockDb.put).toHaveBeenCalledWith(
        'drafts',
        expect.objectContaining({ roomId: 'room-1', content: 'hello draft' }),
      )
    })

    it('getDraft returns null when no draft exists', async () => {
      mockDb.get.mockResolvedValueOnce(undefined)
      const { getDraft } = await import('./message-cache.js')
      const result = await getDraft('room-missing')
      expect(result).toBeNull()
    })
  })

  describe('getCachedRooms', () => {
    it('returns rooms from cache', async () => {
      mockDb.getAll.mockResolvedValueOnce([{ id: 'r1', name: 'Room 1' }])
      const { getCachedRooms } = await import('./message-cache.js')
      const rooms = await getCachedRooms()
      expect(rooms).toEqual([{ id: 'r1', name: 'Room 1' }])
    })
  })

  describe('getCachedRoomMeta / setCachedRoomMeta', () => {
    it('stores and retrieves room metadata', async () => {
      const { setCachedRoomMeta } = await import('./message-cache.js')
      const meta = {
        lastMessage: { content: 'hi', senderName: 'Alice', createdAt: '2026-01-01' },
        unread: 3,
      }
      await setCachedRoomMeta('room-1', meta)
      expect(mockDb.put).toHaveBeenCalledWith(
        'room-meta',
        expect.objectContaining({ roomId: 'room-1' }),
      )
    })
  })

  describe('updateCachedMessage', () => {
    it('updates a message in the cache', async () => {
      const { updateCachedMessage } = await import('./message-cache.js')
      const msg = {
        id: 'msg-1',
        roomId: 'room-1',
        senderId: 'user-1',
        senderType: 'user' as const,
        senderName: 'Alice',
        type: 'text' as const,
        content: 'Updated',
        createdAt: new Date().toISOString(),
        mentions: [],
        reactions: [],
      }
      await updateCachedMessage(msg)
      expect(mockDb.put).toHaveBeenCalledWith('messages', msg)
    })
  })

  describe('removeCachedMessage', () => {
    it('removes a message from the cache', async () => {
      const { removeCachedMessage } = await import('./message-cache.js')
      await removeCachedMessage('room-1', 'msg-1')
      expect(mockDb.delete).toHaveBeenCalledWith('messages', 'msg-1')
    })
  })

  describe('getPendingMessages', () => {
    it('returns all pending messages', async () => {
      mockDb.getAll.mockResolvedValueOnce([{ id: 'p1', roomId: 'room-1', content: 'Pending' }])
      const { getPendingMessages } = await import('./message-cache.js')
      const result = await getPendingMessages()
      expect(result).toEqual([{ id: 'p1', roomId: 'room-1', content: 'Pending' }])
    })
  })

  describe('setCachedMessages', () => {
    it('clears old messages and sets new ones', async () => {
      const { setCachedMessages } = await import('./message-cache.js')
      const msgs = [
        {
          id: 'msg-1',
          roomId: 'room-1',
          senderId: 'user-1',
          senderType: 'user' as const,
          senderName: 'Alice',
          type: 'text' as const,
          content: 'Hello',
          createdAt: new Date().toISOString(),
          mentions: [],
          reactions: [],
        },
      ]
      await setCachedMessages('room-1', msgs)
      expect(mockDb.transaction).toHaveBeenCalled()
    })
  })
})
