import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rooms, roomMembers } from '../db/schema.js'

/** Database or transaction — both share the same query builder interface. */
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

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
  // Room-creator shortcut only applies to users
  if (memberType === 'user') {
    const [room] = await trx
      .select({ createdById: rooms.createdById })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1)
    if (!room) return false
    if (room.createdById === memberId) return true
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

  return !!membership
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

  return (membership?.role as 'owner' | 'admin' | 'member') ?? null
}

/**
 * Check if a user has owner or admin role in a room.
 */
export async function isRoomAdmin(userId: string, roomId: string): Promise<boolean> {
  const role = await getRoomMemberRole(userId, roomId)
  return role === 'owner' || role === 'admin'
}
