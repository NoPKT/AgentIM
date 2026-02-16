import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rooms, roomMembers } from '../db/schema.js'

/**
 * Check if a user is a member of a room (or is the room creator).
 * Returns true if access is granted.
 */
export async function isRoomMember(userId: string, roomId: string): Promise<boolean> {
  const [room] = await db
    .select({ createdById: rooms.createdById })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1)
  if (!room) return false
  if (room.createdById === userId) return true

  const [membership] = await db
    .select({ memberId: roomMembers.memberId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, userId)))
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
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.memberId, userId)))
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
