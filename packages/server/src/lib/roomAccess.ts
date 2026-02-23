import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rooms, roomMembers } from '../db/schema.js'
import { cacheGet, cacheSet, cacheDel } from './cache.js'

/** Database or transaction — both share the same query builder interface. */
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

const MEMBER_CHECK_TTL = 60 // seconds

function memberCheckKey(memberId: string, roomId: string, memberType: string): string {
  return `access:member:${memberId}:${roomId}:${memberType}`
}

function adminCheckKey(userId: string, roomId: string): string {
  return `access:admin:${userId}:${roomId}`
}

/**
 * Invalidate per-user room access caches for a specific member.
 * Call whenever membership or role changes.
 */
export async function invalidateRoomAccessCache(memberId: string, roomId: string): Promise<void> {
  await cacheDel(
    memberCheckKey(memberId, roomId, 'user'),
    memberCheckKey(memberId, roomId, 'agent'),
    adminCheckKey(memberId, roomId),
  )
}

/**
 * Check if a member belongs to a room (or is the room creator).
 * Returns true if access is granted.
 *
 * @param memberType — defaults to 'user'. Pass 'agent' when validating agent assignees.
 *   The room-creator shortcut only applies to user checks (agents cannot be room creators).
 */
export async function isRoomMember(
  memberId: string,
  roomId: string,
  trx: DbOrTx = db,
  memberType: 'user' | 'agent' = 'user',
): Promise<boolean> {
  // Only cache when not inside a transaction (trx === db means default, no transaction)
  const useCache = trx === db
  if (useCache) {
    const cached = await cacheGet<boolean>(memberCheckKey(memberId, roomId, memberType))
    if (cached !== null) return cached
  }

  // Room-creator shortcut only applies to users
  if (memberType === 'user') {
    const [room] = await trx
      .select({ createdById: rooms.createdById })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1)
    if (!room) {
      if (useCache)
        await cacheSet(memberCheckKey(memberId, roomId, memberType), false, MEMBER_CHECK_TTL)
      return false
    }
    if (room.createdById === memberId) {
      if (useCache)
        await cacheSet(memberCheckKey(memberId, roomId, memberType), true, MEMBER_CHECK_TTL)
      return true
    }
  }

  const [membership] = await trx
    .select({ memberId: roomMembers.memberId })
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.memberId, memberId),
        eq(roomMembers.memberType, memberType),
      ),
    )
    .limit(1)

  const result = !!membership
  if (useCache)
    await cacheSet(memberCheckKey(memberId, roomId, memberType), result, MEMBER_CHECK_TTL)
  return result
}

/**
 * Get a user's role in a room.
 * Returns 'owner' | 'admin' | 'member' | null (null = not a member).
 */
export async function getRoomMemberRole(
  userId: string,
  roomId: string,
): Promise<'owner' | 'admin' | 'member' | null> {
  const [membership] = await db
    .select({ role: roomMembers.role })
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.memberId, userId),
        eq(roomMembers.memberType, 'user'),
      ),
    )
    .limit(1)

  if (membership) return membership.role as 'owner' | 'admin' | 'member'

  // Room-creator shortcut: creator is always 'owner' even without a roomMembers record
  const [room] = await db
    .select({ createdById: rooms.createdById })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1)
  if (room && room.createdById === userId) return 'owner'

  return null
}

/**
 * Check if a user has owner or admin role in a room.
 * Result is cached in Redis for MEMBER_CHECK_TTL seconds.
 */
export async function isRoomAdmin(userId: string, roomId: string): Promise<boolean> {
  const cached = await cacheGet<boolean>(adminCheckKey(userId, roomId))
  if (cached !== null) return cached

  const role = await getRoomMemberRole(userId, roomId)
  const result = role === 'owner' || role === 'admin'
  await cacheSet(adminCheckKey(userId, roomId), result, MEMBER_CHECK_TTL)
  return result
}
