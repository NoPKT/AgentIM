import { lt, and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { gateways, agents, roomMembers } from '../db/schema.js'
import { config } from '../config.js'
import { createLogger } from './logger.js'
import { connectionManager } from '../ws/connections.js'
import { broadcastRoomUpdate, sendRoomContextToAllAgents } from '../ws/gatewayHandler.js'

const log = createLogger('GatewayCleanup')

/**
 * Remove gateways that have been offline for longer than the configured threshold.
 * Agents are cascade-deleted via the FK constraint. Orphaned roomMembers are cleaned up.
 */
async function cleanupZombieGateways(): Promise<void> {
  const cutoff = new Date(
    Date.now() - config.gatewayMaxOfflineDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  // Find zombie gateways: disconnected before cutoff
  const zombies = await db
    .select({ id: gateways.id })
    .from(gateways)
    .where(and(isNotNull(gateways.disconnectedAt), lt(gateways.disconnectedAt, cutoff)))

  if (zombies.length === 0) return

  const zombieIds = zombies.map((g) => g.id)

  // Find agents belonging to zombie gateways
  const zombieAgents = await db
    .select({ id: agents.id })
    .from(agents)
    .where(inArray(agents.gatewayId, zombieIds))
  const zombieAgentIds = zombieAgents.map((a) => a.id)

  // Find rooms affected by these agents (for broadcasting updates after cleanup)
  let affectedRoomIds: string[] = []
  if (zombieAgentIds.length > 0) {
    const memberRows = await db
      .select({ roomId: roomMembers.roomId })
      .from(roomMembers)
      .where(
        and(inArray(roomMembers.memberId, zombieAgentIds), eq(roomMembers.memberType, 'agent')),
      )
    affectedRoomIds = [...new Set(memberRows.map((r) => r.roomId))]

    // Remove agent roomMembers before deleting gateways (cascade handles agents)
    await db
      .delete(roomMembers)
      .where(
        and(inArray(roomMembers.memberId, zombieAgentIds), eq(roomMembers.memberType, 'agent')),
      )
  }

  // Delete zombie gateways (agents cascade-deleted via FK)
  await db.delete(gateways).where(inArray(gateways.id, zombieIds))

  log.info(`Cleaned up ${zombieIds.length} zombie gateway(s) and ${zombieAgentIds.length} agent(s)`)

  // Broadcast room updates for affected rooms
  for (const roomId of affectedRoomIds) {
    await broadcastRoomUpdate(roomId).catch((err) => {
      log.warn(`Failed to broadcast room update for ${roomId}: ${(err as Error).message}`)
    })
    await sendRoomContextToAllAgents(roomId).catch((err) => {
      log.warn(`Failed to send room context for ${roomId}: ${(err as Error).message}`)
    })
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function startGatewayCleanup(): void {
  cleanupTimer = setInterval(() => {
    cleanupZombieGateways().catch((err) => {
      log.error(`Gateway cleanup failed: ${(err as Error).message}`)
    })
  }, config.gatewayCleanupInterval)
  // Run once at startup after a short delay
  setTimeout(() => {
    cleanupZombieGateways().catch((err) => {
      log.error(`Initial gateway cleanup failed: ${(err as Error).message}`)
    })
  }, 30_000)
}

export function stopGatewayCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}
