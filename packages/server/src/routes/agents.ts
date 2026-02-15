import { Hono } from 'hono'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agents, gateways } from '../db/schema.js'
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
      try { capabilities = JSON.parse(agent.capabilities) } catch { /* ignore */ }
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

// Get single agent
agentRoutes.get('/:id', async (c) => {
  const agentId = c.req.param('id')
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent) {
    return c.json({ ok: false, error: 'Agent not found' }, 404)
  }

  const [gw] = await db.select().from(gateways).where(eq(gateways.id, agent.gatewayId)).limit(1)
  const [enriched] = enrichAgents([agent], gw ? [gw] : [])

  return c.json({ ok: true, data: enriched })
})

// List gateways
agentRoutes.get('/gateways/list', async (c) => {
  const userId = c.get('userId')
  const gwList = await db.select().from(gateways).where(eq(gateways.userId, userId))
  return c.json({ ok: true, data: gwList })
})
