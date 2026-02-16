import { Hono } from 'hono'
import { eq, ne, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agents, gateways, users } from '../db/schema.js'
import { updateAgentSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'

export const agentRoutes = new Hono<AuthEnv>()

agentRoutes.use('*', authMiddleware)

function enrichAgents(
  agentRows: (typeof agents.$inferSelect)[],
  gatewayRows: (typeof gateways.$inferSelect)[],
) {
  const gwMap = new Map(gatewayRows.map((g) => [g.id, g]))
  return agentRows.map((agent) => {
    const gw = gwMap.get(agent.gatewayId)
    let capabilities: string[] | undefined
    if (agent.capabilities) {
      try {
        capabilities = JSON.parse(agent.capabilities)
      } catch {
        /* ignore */
      }
    }
    return {
      ...agent,
      capabilities,
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
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 500)
  const offset = Number(c.req.query('offset')) || 0

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

  // Get all shared agents
  const sharedAgents = await db.select().from(agents).where(eq(agents.visibility, 'shared'))

  if (sharedAgents.length === 0) {
    return c.json({ ok: true, data: [] })
  }

  // Get their gateways
  const gatewayIds = [...new Set(sharedAgents.map((a) => a.gatewayId))]
  const gwRows = await db.select().from(gateways).where(inArray(gateways.id, gatewayIds))

  const gwMap = new Map(gwRows.map((g) => [g.id, g]))

  // Filter out current user's own agents
  const otherAgents = sharedAgents.filter((a) => {
    const gw = gwMap.get(a.gatewayId)
    return gw && gw.userId !== userId
  })

  if (otherAgents.length === 0) {
    return c.json({ ok: true, data: [] })
  }

  // Get owner display names
  const ownerIds = [...new Set(otherAgents.map((a) => gwMap.get(a.gatewayId)!.userId))]
  const ownerRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ownerIds))
  const ownerMap = new Map(ownerRows.map((u) => [u.id, u.displayName]))

  const enriched = enrichAgents(otherAgents, gwRows).map((agent) => {
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
  const body = await c.req.json()
  const parsed = updateAgentSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten() }, 400)
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

// List gateways
agentRoutes.get('/gateways/list', async (c) => {
  const userId = c.get('userId')
  const gwList = await db.select().from(gateways).where(eq(gateways.userId, userId))
  return c.json({ ok: true, data: gwList })
})
