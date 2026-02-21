import { openDB, type IDBPDatabase } from 'idb'
import type { Room, Message } from '@agentim/shared'

const DB_NAME = 'agentim-cache'
const DB_VERSION = 1
const MAX_MESSAGES_PER_ROOM = 200

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
    return await db.getAllFromIndex('messages', 'by-room', range)
  } catch {
    return []
  }
}

export async function setCachedMessages(roomId: string, messages: Message[]): Promise<void> {
  try {
    const db = await getDb()
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
    const trimmed = messages.slice(-MAX_MESSAGES_PER_ROOM)
    for (const msg of trimmed) {
      await store.put(msg)
    }

    await tx.done
  } catch {
    // Silently fail
  }
}

export async function addCachedMessage(message: Message): Promise<void> {
  try {
    const db = await getDb()
    await db.put('messages', message)

    // Trim if over limit
    const range = IDBKeyRange.bound([message.roomId, ''], [message.roomId, '\uffff'])
    const all = await db.getAllKeysFromIndex('messages', 'by-room', range)
    if (all.length > MAX_MESSAGES_PER_ROOM) {
      const tx = db.transaction('messages', 'readwrite')
      const store = tx.objectStore('messages')
      const idx = store.index('by-room')
      let cursor = await idx.openCursor(range)
      let toDelete = all.length - MAX_MESSAGES_PER_ROOM
      while (cursor && toDelete > 0) {
        await cursor.delete()
        toDelete--
        cursor = await cursor.continue()
      }
      await tx.done
    }
  } catch {
    // Silently fail
  }
}

export async function updateCachedMessage(message: Message): Promise<void> {
  try {
    const db = await getDb()
    await db.put('messages', message)
  } catch {
    // Silently fail
  }
}

export async function removeCachedMessage(roomId: string, messageId: string): Promise<void> {
  try {
    const db = await getDb()
    await db.delete('messages', messageId)
  } catch {
    // Silently fail
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
  } catch {
    // Silently fail
  }
}

// ─── Room Cache ───

export async function getCachedRooms(): Promise<Room[]> {
  try {
    const db = await getDb()
    return await db.getAll('rooms')
  } catch {
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
  } catch {
    // Silently fail
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
  } catch {
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
  } catch {
    // Silently fail
  }
}

// ─── Cleanup ───

export async function clearRoomCache(roomId: string): Promise<void> {
  await deleteMessagesForRoom(roomId)
  try {
    const db = await getDb()
    await db.delete('room-meta', roomId)
    await db.delete('rooms', roomId)
  } catch {
    // Silently fail
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction(['messages', 'rooms', 'room-meta'], 'readwrite')
    await tx.objectStore('messages').clear()
    await tx.objectStore('rooms').clear()
    await tx.objectStore('room-meta').clear()
    await tx.done
  } catch {
    // Silently fail
  }
}
