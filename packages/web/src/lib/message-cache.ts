import { openDB, type IDBPDatabase } from 'idb'
import type { Room, Message } from '@agentim/shared'
import { MAX_MESSAGES_PER_ROOM_CACHE } from '@agentim/shared'

const DB_NAME = 'agentim-cache'
const DB_VERSION = 3

const IDB_TIMEOUT_MS = 5000
const IDB_MAX_RETRIES = 2
const IDB_RETRY_DELAY_MS = 300

function withIdbTimeout<T>(promise: Promise<T>, ms = IDB_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB operation timed out')), ms)
    promise.then(
      (val) => {
        clearTimeout(timer)
        resolve(val)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Retry wrapper for IDB operations. Retries on timeout or transient errors
 * with a short delay. Non-retryable errors (e.g. QuotaExceededError) are
 * thrown immediately.
 */
async function withIdbRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= IDB_MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // Don't retry quota errors
      if (err instanceof DOMException && err.name === 'QuotaExceededError') throw err
      if (attempt < IDB_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, IDB_RETRY_DELAY_MS * (attempt + 1)))
      }
    }
  }
  throw lastErr
}

interface RoomMeta {
  roomId: string
  lastMessage: LastMessageInfo
  unread: number
}

interface LastMessageInfo {
  content: string
  senderName: string
  createdAt: string
}

export interface PendingMessage {
  id: string
  roomId: string
  content: string
  mentions: string[]
  replyToId?: string
  attachmentIds?: string[]
  createdAt: string
}

interface DraftEntry {
  roomId: string
  content: string
}

interface CacheDB {
  messages: {
    key: string
    value: Message & { roomId: string }
    indexes: { 'by-room': [string, string] }
  }
  rooms: {
    key: string
    value: Room
  }
  'room-meta': {
    key: string
    value: RoomMeta
  }
  'pending-messages': {
    key: string
    value: PendingMessage
    indexes: { 'by-room': string }
  }
  drafts: {
    key: string
    value: DraftEntry
  }
}

let dbPromise: Promise<IDBPDatabase<CacheDB>> | null = null

function getDb(): Promise<IDBPDatabase<CacheDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' })
          msgStore.createIndex('by-room', ['roomId', 'createdAt'])
        }
        if (!db.objectStoreNames.contains('rooms')) {
          db.createObjectStore('rooms', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('room-meta')) {
          db.createObjectStore('room-meta', { keyPath: 'roomId' })
        }
        // v2: pending messages for offline queue
        if (!db.objectStoreNames.contains('pending-messages')) {
          const pendingStore = db.createObjectStore('pending-messages', { keyPath: 'id' })
          pendingStore.createIndex('by-room', 'roomId')
        }
        // v3: drafts persisted in IndexedDB instead of sessionStorage
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'roomId' })
        }
      },
    })
  }
  return dbPromise
}

// ─── Message Cache ───

export async function getCachedMessages(roomId: string): Promise<Message[]> {
  try {
    const db = await getDb()
    const range = IDBKeyRange.bound([roomId, ''], [roomId, '\uffff'])
    return await withIdbTimeout(db.getAllFromIndex('messages', 'by-room', range))
  } catch (err) {
    console.warn('[MessageCache] Failed to get cached messages', err)
    return []
  }
}

export async function setCachedMessages(roomId: string, messages: Message[]): Promise<void> {
  try {
    await withIdbRetry(async () => {
      const db = await getDb()
      await withIdbTimeout(
        (async () => {
          const tx = db.transaction('messages', 'readwrite')
          const store = tx.objectStore('messages')

          // Remove existing messages for this room
          const idx = store.index('by-room')
          const range = IDBKeyRange.bound([roomId, ''], [roomId, '\uffff'])
          let cursor = await idx.openCursor(range)
          while (cursor) {
            await cursor.delete()
            cursor = await cursor.continue()
          }

          // Keep only the latest N messages
          const trimmed = messages.slice(-MAX_MESSAGES_PER_ROOM_CACHE)
          for (const msg of trimmed) {
            await store.put(msg)
          }

          await tx.done
        })(),
      )
    })
  } catch (err) {
    console.warn('[MessageCache] Failed to set cached messages', err)
  }
}

export async function addCachedMessage(message: Message): Promise<void> {
  try {
    const db = await getDb()
    await db.put('messages', message)

    // Trim if over limit
    const range = IDBKeyRange.bound([message.roomId, ''], [message.roomId, '\uffff'])
    const all = await db.getAllKeysFromIndex('messages', 'by-room', range)
    if (all.length > MAX_MESSAGES_PER_ROOM_CACHE) {
      const tx = db.transaction('messages', 'readwrite')
      const store = tx.objectStore('messages')
      const idx = store.index('by-room')
      let cursor = await idx.openCursor(range)
      let toDelete = all.length - MAX_MESSAGES_PER_ROOM_CACHE
      while (cursor && toDelete > 0) {
        await cursor.delete()
        toDelete--
        cursor = await cursor.continue()
      }
      await tx.done
    }
  } catch (err) {
    console.warn('[MessageCache] Failed to add cached message', err)
  }
}

export async function updateCachedMessage(message: Message): Promise<void> {
  try {
    const db = await getDb()
    await db.put('messages', message)
  } catch (err) {
    console.warn('[MessageCache] Failed to update cached message', err)
  }
}

export async function removeCachedMessage(roomId: string, messageId: string): Promise<void> {
  try {
    const db = await getDb()
    await db.delete('messages', messageId)
  } catch (err) {
    console.warn('[MessageCache] Failed to remove cached message', err)
  }
}

async function deleteMessagesForRoom(roomId: string): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction('messages', 'readwrite')
    const store = tx.objectStore('messages')
    const idx = store.index('by-room')
    const range = IDBKeyRange.bound([roomId, ''], [roomId, '\uffff'])
    let cursor = await idx.openCursor(range)
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
  } catch (err) {
    console.warn('[MessageCache] Failed to delete messages for room', err)
  }
}

// ─── Room Cache ───

export async function getCachedRooms(): Promise<Room[]> {
  try {
    const db = await getDb()
    return await db.getAll('rooms')
  } catch (err) {
    console.warn('[MessageCache] Failed to get cached rooms', err)
    return []
  }
}

export async function setCachedRooms(rooms: Room[]): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction('rooms', 'readwrite')
    await tx.objectStore('rooms').clear()
    for (const room of rooms) {
      await tx.objectStore('rooms').put(room)
    }
    await tx.done
  } catch (err) {
    console.warn('[MessageCache] Failed to set cached rooms', err)
  }
}

// ─── Room Meta Cache ───

export async function getCachedRoomMeta(): Promise<
  Map<string, { lastMessage: LastMessageInfo; unread: number }>
> {
  try {
    const db = await getDb()
    const all = await db.getAll('room-meta')
    const map = new Map<string, { lastMessage: LastMessageInfo; unread: number }>()
    for (const item of all) {
      map.set(item.roomId, { lastMessage: item.lastMessage, unread: item.unread })
    }
    return map
  } catch (err) {
    console.warn('[MessageCache] Failed to get cached room meta', err)
    return new Map()
  }
}

export async function setCachedRoomMeta(
  roomId: string,
  meta: { lastMessage: LastMessageInfo; unread: number },
): Promise<void> {
  try {
    const db = await getDb()
    await db.put('room-meta', { roomId, ...meta })
  } catch (err) {
    console.warn('[MessageCache] Failed to set cached room meta', err)
  }
}

// ─── Cleanup ───

export async function clearRoomCache(roomId: string): Promise<void> {
  await deleteMessagesForRoom(roomId)
  try {
    const db = await getDb()
    await db.delete('room-meta', roomId)
    await db.delete('rooms', roomId)
  } catch (err) {
    console.warn('[MessageCache] Failed to clear room cache', err)
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction(
      ['messages', 'rooms', 'room-meta', 'pending-messages', 'drafts'],
      'readwrite',
    )
    await tx.objectStore('messages').clear()
    await tx.objectStore('rooms').clear()
    await tx.objectStore('room-meta').clear()
    await tx.objectStore('pending-messages').clear()
    await tx.objectStore('drafts').clear()
    await tx.done
  } catch (err) {
    console.warn('[MessageCache] Failed to clear cache', err)
  }
}

// ─── Pending Messages (Offline Queue) ───

export async function addPendingMessage(msg: PendingMessage): Promise<void> {
  try {
    await withIdbRetry(async () => {
      const db = await getDb()
      await db.put('pending-messages', msg)
    })
  } catch (err) {
    console.warn('[MessageCache] Failed to add pending message', err)
  }
}

export async function getPendingMessages(): Promise<PendingMessage[]> {
  try {
    const db = await getDb()
    return await db.getAll('pending-messages')
  } catch (err) {
    console.warn('[MessageCache] Failed to get pending messages', err)
    return []
  }
}

export async function removePendingMessage(id: string): Promise<void> {
  try {
    const db = await getDb()
    await db.delete('pending-messages', id)
  } catch (err) {
    console.warn('[MessageCache] Failed to remove pending message', err)
  }
}

// ─── Drafts ───

export async function getDraft(roomId: string): Promise<string | null> {
  try {
    const db = await getDb()
    const entry = await db.get('drafts', roomId)
    return entry?.content ?? null
  } catch (err) {
    console.warn('[MessageCache] Failed to get draft', err)
    return null
  }
}

export async function setDraft(roomId: string, content: string): Promise<void> {
  try {
    const db = await getDb()
    if (content) {
      await db.put('drafts', { roomId, content })
    } else {
      await db.delete('drafts', roomId)
    }
  } catch (err) {
    console.warn('[MessageCache] Failed to set draft', err)
  }
}

export async function clearAllDrafts(): Promise<void> {
  try {
    const db = await getDb()
    await db.clear('drafts')
  } catch (err) {
    console.warn('[MessageCache] Failed to clear drafts', err)
  }
}
