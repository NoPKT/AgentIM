import { Hono } from 'hono'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agents, gateways } from '../db/schema.js'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'

export const agentRoutes = new Hono<AuthEnv>()

agentRoutes.use('*', authMiddleware)

// List all agents for the current user (through their gateways)
agentRoutes.get('/', async (c) => {
  const userId = c.get('userId')

  const userGateways = await db.select().from(gateways).where(eq(gateways.userId, userId))
  if (userGateways.length === 0) {
    return c.json({ ok: true, data: [] })
  }

  const gatewayIds = userGateways.map((g) => g.id)
  const allAgents = await db
    .select()
    .from(agents)
    .where(inArray(agents.gatewayId, gatewayIds))

  return c.json({ ok: true, data: allAgents })
})

// Get single agent
agentRoutes.get('/:id', async (c) => {
  const agentId = c.req.param('id')
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent) {
    return c.json({ ok: false, error: 'Agent not found' }, 404)
  }

  return c.json({ ok: true, data: agent })
})

// List gateways
agentRoutes.get('/gateways/list', async (c) => {
  const userId = c.get('userId')
  const gwList = await db.select().from(gateways).where(eq(gateways.userId, userId))
  return c.json({ ok: true, data: gwList })
})
