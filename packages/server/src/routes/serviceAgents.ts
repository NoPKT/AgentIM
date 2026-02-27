import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { createServiceAgentSchema, updateServiceAgentSchema } from '@agentim/shared'
import { db } from '../db/index.js'
import { serviceAgents } from '../db/schema.js'
import { authMiddleware, adminMiddleware, type AuthEnv } from '../middleware/auth.js'
import { encryptSecret, decryptSecret } from '../lib/crypto.js'
import { createLogger } from '../lib/logger.js'
import { getProvider, listProviders } from '../lib/providers/registry.js'
import { zodToJsonSchema } from '../lib/providers/schema-utils.js'
import { parseJsonBody, validateIdParams } from '../lib/validation.js'

const log = createLogger('ServiceAgents')

const app = new Hono<AuthEnv>()

// All routes require authentication and admin role
app.use('*', authMiddleware)
app.use('*', adminMiddleware)
app.use('/:id', validateIdParams)

// GET /api/service-agents/providers - List available provider types
app.get('/providers', (c) => {
  const metas = listProviders().map((meta) => ({
    type: meta.type,
    displayName: meta.displayName,
    category: meta.category,
    description: meta.description,
    configSchema: zodToJsonSchema(meta.configSchema),
  }))
  return c.json({ ok: true, data: metas })
})

// GET /api/service-agents - List all service agents
app.get('/', async (c) => {
  const rows = await db.select().from(serviceAgents)
  // Strip config from list response
  const result = rows.map(({ configEncrypted: _, ...rest }) => rest)
  return c.json({ ok: true, data: result })
})

// GET /api/service-agents/:id - Get single service agent (with decrypted config)
app.get('/:id', async (c) => {
  const { id } = c.req.param()
  const [row] = await db.select().from(serviceAgents).where(eq(serviceAgents.id, id)).limit(1)
  if (!row) return c.json({ ok: false, error: 'Service agent not found' }, 404)

  // Decrypt config
  let config: Record<string, unknown> = {}
  try {
    const decrypted = decryptSecret(row.configEncrypted)
    if (decrypted) config = JSON.parse(decrypted)
    // Mask the API key
    if (config.apiKey && typeof config.apiKey === 'string') {
      config.apiKey = config.apiKey.slice(0, 4) + '••••••••'
    }
  } catch {
    log.warn(`Failed to decrypt config for service agent ${id}`)
  }

  const { configEncrypted: _, ...rest } = row
  return c.json({ ok: true, data: { ...rest, config } })
})

// POST /api/service-agents - Create service agent
app.post('/', async (c) => {
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = createServiceAgentSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      400,
    )
  }

  const { config, ...data } = parsed.data

  // Validate config against provider schema
  const provider = getProvider(data.type)
  if (provider) {
    const parseResult = provider.meta.configSchema.safeParse(config)
    if (!parseResult.success) {
      return c.json(
        {
          ok: false,
          error: 'Invalid provider config',
          fields: parseResult.error.issues.map((i) => ({
            field: `config.${i.path.join('.')}`,
            message: i.message,
          })),
        },
        400,
      )
    }
  }

  // Derive category from provider if not explicitly provided
  const category = data.category ?? provider?.meta.category ?? 'chat'

  const userId = c.get('userId')
  const id = nanoid()
  const now = new Date().toISOString()

  const encryptedConfig = encryptSecret(JSON.stringify(config))

  await db.insert(serviceAgents).values({
    id,
    name: data.name,
    type: data.type,
    category,
    description: data.description,
    status: 'active',
    configEncrypted: encryptedConfig,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  const { configEncrypted: _, ...result } = (
    await db.select().from(serviceAgents).where(eq(serviceAgents.id, id)).limit(1)
  )[0]
  return c.json({ ok: true, data: result }, 201)
})

// PUT /api/service-agents/:id - Update service agent
app.put('/:id', async (c) => {
  const { id } = c.req.param()
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = updateServiceAgentSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      400,
    )
  }

  const [existing] = await db.select().from(serviceAgents).where(eq(serviceAgents.id, id)).limit(1)
  if (!existing) return c.json({ ok: false, error: 'Service agent not found' }, 404)

  const { config, ...data } = parsed.data
  const now = new Date().toISOString()

  const updateData: Record<string, unknown> = { updatedAt: now }
  if (data.name !== undefined) updateData.name = data.name
  if (data.type !== undefined) updateData.type = data.type
  if (data.category !== undefined) updateData.category = data.category
  if (data.description !== undefined) updateData.description = data.description
  if (data.status !== undefined) updateData.status = data.status

  if (config) {
    // Merge with existing config
    let existingConfig: Record<string, unknown> = {}
    try {
      const decrypted = decryptSecret(existing.configEncrypted)
      if (decrypted) existingConfig = JSON.parse(decrypted)
    } catch {
      /* use empty */
    }

    const mergedConfig = { ...existingConfig, ...config }

    // Validate merged config against provider schema
    const type = (data.type ?? existing.type) as string
    const provider = getProvider(type)
    if (provider) {
      const parseResult = provider.meta.configSchema.safeParse(mergedConfig)
      if (!parseResult.success) {
        return c.json(
          {
            ok: false,
            error: 'Invalid provider config',
            fields: parseResult.error.issues.map((i) => ({
              field: `config.${i.path.join('.')}`,
              message: i.message,
            })),
          },
          400,
        )
      }
    }

    updateData.configEncrypted = encryptSecret(JSON.stringify(mergedConfig))
  }

  await db.update(serviceAgents).set(updateData).where(eq(serviceAgents.id, id))

  const { configEncrypted: _enc, ...result } = (
    await db.select().from(serviceAgents).where(eq(serviceAgents.id, id)).limit(1)
  )[0]
  return c.json({ ok: true, data: result })
})

// DELETE /api/service-agents/:id - Delete service agent
app.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const [existing] = await db.select().from(serviceAgents).where(eq(serviceAgents.id, id)).limit(1)
  if (!existing) return c.json({ ok: false, error: 'Service agent not found' }, 404)

  await db.delete(serviceAgents).where(eq(serviceAgents.id, id))
  return c.json({ ok: true })
})

// POST /api/service-agents/:id/validate - Validate provider config
app.post('/:id/validate', async (c) => {
  const { id } = c.req.param()
  const [row] = await db.select().from(serviceAgents).where(eq(serviceAgents.id, id)).limit(1)
  if (!row) return c.json({ ok: false, error: 'Service agent not found' }, 404)

  const provider = getProvider(row.type)
  if (!provider?.validateConfig) {
    return c.json({ ok: true, data: { valid: true, message: 'No validation available' } })
  }

  let config: Record<string, unknown> = {}
  try {
    const decrypted = decryptSecret(row.configEncrypted)
    if (decrypted) config = JSON.parse(decrypted)
  } catch {
    return c.json({ ok: true, data: { valid: false, error: 'Failed to decrypt config' } })
  }

  const result = await provider.validateConfig(config)
  return c.json({ ok: true, data: result })
})

export default app
