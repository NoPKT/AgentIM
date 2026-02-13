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

  const userGateways = db.select().from(gateways).where(eq(gateways.userId, userId)).all()
  if (userGateways.length === 0) {
    return c.json({ ok: true, data: [] })
  }

  const gatewayIds = userGateways.map((g) => g.id)
  const allAgents = db
    .select()
    .from(agents)
    .where(inArray(agents.gatewayId, gatewayIds))
    .all()

  return c.json({ ok: true, data: allAgents })
})

// Get single agent
agentRoutes.get('/:id', async (c) => {
  const agentId = c.req.param('id')
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get()
  if (!agent) {
    return c.json({ ok: false, error: 'Agent not found' }, 404)
  }

  return c.json({ ok: true, data: agent })
})

// List gateways
agentRoutes.get('/gateways/list', async (c) => {
  const userId = c.get('userId')
  const gwList = db.select().from(gateways).where(eq(gateways.userId, userId)).all()
  return c.json({ ok: true, data: gwList })
})
