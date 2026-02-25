/**
 * Presence (typing, online status, read receipts) actions extracted from
 * chat store. Pure helper functions with no store coupling.
 */

export interface ReadReceipt {
  userId: string
  username: string
  lastReadAt: string
}

const MAX_TYPING_ENTRIES = 500
const MAX_RECEIPTS_PER_ROOM = 100

export function addTypingUserAction(
  typingUsers: Map<string, { username: string; expiresAt: number }>,
  roomId: string,
  userId: string,
  username: string,
): Map<string, { username: string; expiresAt: number }> {
  const key = `${roomId}:${userId}`
  const next = new Map(typingUsers)
  next.set(key, { username, expiresAt: Date.now() + 4000 })
  // Safety cap — clearExpiredTyping handles normal cleanup
  if (next.size > MAX_TYPING_ENTRIES) {
    const entries = [...next.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    return new Map(entries.slice(-MAX_TYPING_ENTRIES))
  }
  return next
}

export function clearExpiredTypingAction(
  typingUsers: Map<string, { username: string; expiresAt: number }>,
): Map<string, { username: string; expiresAt: number }> | null {
  const now = Date.now()
  const next = new Map(typingUsers)
  let changed = false
  for (const [key, value] of next) {
    if (value.expiresAt < now) {
      next.delete(key)
      changed = true
    }
  }
  return changed ? next : null
}

export function setUserOnlineAction(
  onlineUsers: Set<string>,
  userId: string,
  online: boolean,
): Set<string> {
  const next = new Set(onlineUsers)
  if (online) next.add(userId)
  else next.delete(userId)
  return next
}

export function updateReadReceiptAction(
  readReceipts: Map<string, ReadReceipt[]>,
  roomId: string,
  userId: string,
  username: string,
  lastReadAt: string,
): Map<string, ReadReceipt[]> {
  const next = new Map(readReceipts)
  const existing = next.get(roomId) ?? []
  const byUser = new Map(existing.map((r) => [r.userId, r]))
  byUser.set(userId, { userId, username, lastReadAt })
  let receipts = [...byUser.values()]
  if (receipts.length > MAX_RECEIPTS_PER_ROOM) {
    receipts = receipts.slice(-MAX_RECEIPTS_PER_ROOM)
  }
  next.set(roomId, receipts)
  return next
}

/**
 * Derive typing user names for a room, excluding the current user.
 */
export function selectTypingNamesFromState(
  typingUsers: Map<string, { username: string; expiresAt: number }>,
  roomId: string | null,
  excludeUserId: string | undefined,
): string[] {
  if (!roomId) return EMPTY_NAMES
  const names: string[] = []
  const now = Date.now()
  for (const [key, value] of typingUsers) {
    if (key.startsWith(`${roomId}:`) && value.expiresAt > now) {
      if (!excludeUserId || !key.endsWith(`:${excludeUserId}`)) {
        names.push(value.username)
      }
    }
  }
  return names.length === 0 ? EMPTY_NAMES : names
}

const EMPTY_NAMES: string[] = []
