import { Hono } from 'hono'
import { eq, ne, and, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agents, gateways, roomMembers, users } from '../db/schema.js'
import { updateAgentSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import {
  validateIdParams,
  parseJsonBody,
  formatZodError,
  parseQueryInt,
} from '../lib/validation.js'
import { connectionManager } from '../ws/connections.js'
import {
  sendRoomContextToAllAgents,
  broadcastRoomUpdate,
  broadcastAgentStatus,
} from '../ws/gatewayHandler.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('AgentRoutes')

export const agentRoutes = new Hono<AuthEnv>()

agentRoutes.use('*', authMiddleware)
agentRoutes.use('/:id', validateIdParams)

function enrichAgents(
  agentRows: (typeof agents.$inferSelect)[],
  gatewayRows: (typeof gateways.$inferSelect)[],
) {
  const gwMap = new Map(gatewayRows.map((g) => [g.id, g]))
  return agentRows.map((agent) => {
    const gw = gwMap.get(agent.gatewayId)
    return {
      ...agent,
      capabilities: agent.capabilities ?? undefined,
      slashCommands: agent.slashCommands ?? undefined,
      mcpServers: agent.mcpServers ?? undefined,
      model: agent.model ?? undefined,
      deviceInfo: gw
        ? {
            hostname: gw.hostname ?? '',
            platform: gw.platform ?? '',
            arch: gw.arch ?? '',
            nodeVersion: gw.nodeVersion ?? '',
          }
        : undefined,
    }
  })
}

// List all agents for the current user (through their gateways)
agentRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const limit = parseQueryInt(c.req.query('limit'), 100, 1, 500)
  const offset = parseQueryInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER)

  const userGateways = await db.select().from(gateways).where(eq(gateways.userId, userId))
  if (userGateways.length === 0) {
    return c.json({ ok: true, data: [] })
  }

  const gatewayIds = userGateways.map((g) => g.id)
  const allAgents = await db
    .select()
    .from(agents)
    .where(inArray(agents.gatewayId, gatewayIds))
    .limit(limit)
    .offset(offset)

  return c.json({ ok: true, data: enrichAgents(allAgents, userGateways) })
})

// List shared agents from other users
agentRoutes.get('/shared', async (c) => {
  const userId = c.get('userId')
  const limit = parseQueryInt(c.req.query('limit'), 100, 1, 500)
  const offset = parseQueryInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER)

  // JOIN gateways to exclude current user's agents at the SQL level,
  // so pagination is consistent regardless of how many shared agents the user owns.
  const rows = await db
    .select()
    .from(agents)
    .innerJoin(gateways, eq(agents.gatewayId, gateways.id))
    .where(and(eq(agents.visibility, 'shared'), ne(gateways.userId, userId)))
    .limit(limit)
    .offset(offset)

  if (rows.length === 0) {
    return c.json({ ok: true, data: [] })
  }

  const gwRows = rows.map((r) => r.gateways)
  const agentRows = rows.map((r) => r.agents)
  const gwMap = new Map(gwRows.map((g) => [g.id, g]))

  // Get owner display names
  const ownerIds = [...new Set(gwRows.map((g) => g.userId))]
  const ownerRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ownerIds))
  const ownerMap = new Map(ownerRows.map((u) => [u.id, u.displayName]))

  const enriched = enrichAgents(agentRows, gwRows).map((agent) => {
    const gw = gwMap.get(agent.gatewayId)
    return {
      ...agent,
      ownerName: gw ? (ownerMap.get(gw.userId) ?? undefined) : undefined,
    }
  })

  return c.json({ ok: true, data: enriched })
})

// Update agent (owner only)
agentRoutes.put('/:id', async (c) => {
  const agentId = c.req.param('id')
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = updateAgentSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  // Verify ownership: agent → gateway → userId
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent) {
    return c.json({ ok: false, error: 'Agent not found' }, 404)
  }

  const [gw] = await db.select().from(gateways).where(eq(gateways.id, agent.gatewayId)).limit(1)
  if (!gw || gw.userId !== userId) {
    return c.json({ ok: false, error: 'You do not own this agent' }, 403)
  }

  const now = new Date().toISOString()
  await db
    .update(agents)
    .set({ ...parsed.data, updatedAt: now })
    .where(eq(agents.id, agentId))

  const [updated] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  const [enriched] = enrichAgents([updated], [gw])

  // Broadcast updated agent status to all rooms (e.g. after rename)
  await broadcastAgentStatus(agentId)

  return c.json({ ok: true, data: enriched })
})

// Get single agent
agentRoutes.get('/:id', async (c) => {
  const agentId = c.req.param('id')
  const userId = c.get('userId')
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent) {
    return c.json({ ok: false, error: 'Agent not found' }, 404)
  }

  const [gw] = await db.select().from(gateways).where(eq(gateways.id, agent.gatewayId)).limit(1)

  // Access control: only the owner or shared agents are accessible
  const isOwner = gw && gw.userId === userId
  const isShared = agent.visibility === 'shared'
  if (!isOwner && !isShared) {
    return c.json({ ok: false, error: 'Agent not found' }, 404)
  }

  const [enriched] = enrichAgents([agent], gw ? [gw] : [])

  return c.json({ ok: true, data: enriched })
})

// Delete agent (owner only) — also removes from all rooms
agentRoutes.delete('/:id', async (c) => {
  const agentId = c.req.param('id')
  const userId = c.get('userId')

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent) {
    return c.json({ ok: false, error: 'Agent not found' }, 404)
  }

  const [gw] = await db.select().from(gateways).where(eq(gateways.id, agent.gatewayId)).limit(1)
  if (!gw || gw.userId !== userId) {
    return c.json({ ok: false, error: 'You do not own this agent' }, 403)
  }

  // Collect rooms this agent belongs to (for broadcasting updates after removal)
  const memberRows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(eq(roomMembers.memberId, agentId), eq(roomMembers.memberType, 'agent')))
  const roomIds = memberRows.map((r) => r.roomId)

  // Remove agent from all rooms and delete the agent record
  await db.transaction(async (tx) => {
    await tx
      .delete(roomMembers)
      .where(and(eq(roomMembers.memberId, agentId), eq(roomMembers.memberType, 'agent')))
    await tx.delete(agents).where(eq(agents.id, agentId))
  })

  // Notify the gateway to remove the adapter so it won't re-register on reconnect
  const delivered = connectionManager.sendToGateway(agentId, {
    type: 'server:remove_agent',
    agentId,
  })

  // If the gateway is offline, mark the agent as deleted so that
  // handleRegisterAgent rejects re-registration on reconnect.
  if (!delivered) {
    connectionManager.markAgentDeleted(agentId)
  }

  // Unregister from WebSocket connection manager (pass userId for ownership verification)
  connectionManager.unregisterAgentById(agentId, userId)

  // Notify affected rooms (both UI clients and gateway agents)
  for (const roomId of roomIds) {
    await broadcastRoomUpdate(roomId)
    await sendRoomContextToAllAgents(roomId)
  }

  return c.json({ ok: true })
})

// List gateways (excludes ephemeral gateways)
agentRoutes.get('/gateways/list', async (c) => {
  const userId = c.get('userId')
  const gwList = await db
    .select()
    .from(gateways)
    .where(and(eq(gateways.userId, userId), eq(gateways.ephemeral, false)))
  return c.json({ ok: true, data: gwList })
})

// Delete gateway (owner only) — cascade deletes all associated agents
agentRoutes.delete('/gateways/:gatewayId', async (c) => {
  const gatewayId = c.req.param('gatewayId')
  const userId = c.get('userId')

  // Verify ownership
  const [gw] = await db.select().from(gateways).where(eq(gateways.id, gatewayId)).limit(1)
  if (!gw) {
    return c.json({ ok: false, error: 'Gateway not found' }, 404)
  }
  if (gw.userId !== userId) {
    return c.json({ ok: false, error: 'You do not own this gateway' }, 403)
  }

  // Collect agents belonging to this gateway
  const agentRows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.gatewayId, gatewayId))
  const agentIds = agentRows.map((a) => a.id)

  // Atomic: collect rooms, remove memberships, delete gateway in one transaction
  let affectedRoomIds: string[] = []
  await db.transaction(async (tx) => {
    if (agentIds.length > 0) {
      const memberRows = await tx
        .select({ roomId: roomMembers.roomId })
        .from(roomMembers)
        .where(and(inArray(roomMembers.memberId, agentIds), eq(roomMembers.memberType, 'agent')))
      affectedRoomIds = [...new Set(memberRows.map((r) => r.roomId))]

      // Clean up room memberships
      await tx
        .delete(roomMembers)
        .where(and(inArray(roomMembers.memberId, agentIds), eq(roomMembers.memberType, 'agent')))
    }

    // Delete gateway (agents cascade-deleted via FK)
    await tx.delete(gateways).where(eq(gateways.id, gatewayId))
  })

  // Notify connection manager and mark agents as deleted
  for (const agentId of agentIds) {
    connectionManager.sendToGateway(agentId, {
      type: 'server:remove_agent',
      agentId,
    })
    connectionManager.markAgentDeleted(agentId)
    connectionManager.unregisterAgentById(agentId, userId)
  }

  // Broadcast room updates for affected rooms
  for (const roomId of affectedRoomIds) {
    await broadcastRoomUpdate(roomId).catch((err) => {
      log.warn(`Failed to broadcast room update for ${roomId}: ${(err as Error).message}`)
    })
    await sendRoomContextToAllAgents(roomId).catch((err) => {
      log.warn(`Failed to send room context for ${roomId}: ${(err as Error).message}`)
    })
  }

  return c.json({ ok: true })
})
