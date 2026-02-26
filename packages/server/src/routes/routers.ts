import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { routers, users } from '../db/schema.js'
import { createRouterSchema, updateRouterSchema } from '@agentim/shared'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { createLogger } from '../lib/logger.js'
import { isRouterVisibleToUser } from '../lib/routerConfig.js'
import { logAudit, getClientIp } from '../lib/audit.js'
import { rateLimitMiddleware } from '../middleware/rateLimit.js'
import { encryptSecret, decryptSecret } from '../lib/crypto.js'
import { validateIdParams, parseJsonBody, formatZodError } from '../lib/validation.js'
import { config } from '../config.js'
import { isInternalUrl, resolvesToPrivateIp } from '../lib/ssrf.js'

const routerTestRateLimit = rateLimitMiddleware(60_000, 5, 'router-test')

const log = createLogger('Routers')

function maskApiKey(storedKey: string): string {
  const key = decryptSecret(storedKey)
  if (!key || key.length <= 8) return '••••'
  return '••••' + key.slice(-2)
}

async function isAdmin(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user?.role === 'admin'
}

function sanitizeRouter(router: typeof routers.$inferSelect) {
  return {
    ...router,
    llmApiKey: maskApiKey(router.llmApiKey),
  }
}

export const routerRoutes = new Hono<AuthEnv>()

routerRoutes.use('*', authMiddleware)
routerRoutes.use('/:id/*', validateIdParams)
routerRoutes.use('/:id', validateIdParams)

// List routers visible to current user
routerRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const admin = await isAdmin(userId)

  const ROUTER_LIMIT = 500

  if (admin) {
    const allRouters = await db.select().from(routers).limit(ROUTER_LIMIT)
    return c.json({ ok: true, data: allRouters.map(sanitizeRouter) })
  }

  // Non-admin: own personal routers + visible global routers
  const [personalRouters, globalRouters] = await Promise.all([
    db
      .select()
      .from(routers)
      .where(and(eq(routers.scope, 'personal'), eq(routers.createdById, userId)))
      .limit(ROUTER_LIMIT),
    db.select().from(routers).where(eq(routers.scope, 'global')).limit(ROUTER_LIMIT),
  ])

  const visibleGlobal = globalRouters.filter((r) => isRouterVisibleToUser(r, userId))
  const visible = [...personalRouters, ...visibleGlobal]

  return c.json({ ok: true, data: visible.map(sanitizeRouter) })
})

// Create router
routerRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = createRouterSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  // Block SSRF — reject internal/private network URLs
  if (
    isInternalUrl(parsed.data.llmBaseUrl) ||
    (await resolvesToPrivateIp(parsed.data.llmBaseUrl))
  ) {
    return c.json(
      { ok: false, error: 'LLM base URL must not point to internal or private networks' },
      400,
    )
  }

  // Only admin can create global routers
  if (parsed.data.scope === 'global') {
    if (!(await isAdmin(userId))) {
      return c.json({ ok: false, error: 'Admin access required to create global routers' }, 403)
    }
  }

  const id = nanoid()
  const now = new Date().toISOString()

  await db.insert(routers).values({
    id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    scope: parsed.data.scope,
    createdById: userId,
    llmBaseUrl: parsed.data.llmBaseUrl,
    // NOTE: llmApiKey is encrypted at application layer via AES-256-GCM before
    // storage. The column name is misleading — data is NOT stored in plaintext.
    llmApiKey: encryptSecret(parsed.data.llmApiKey),
    llmModel: parsed.data.llmModel,
    maxChainDepth: parsed.data.maxChainDepth,
    rateLimitWindow: parsed.data.rateLimitWindow,
    rateLimitMax: parsed.data.rateLimitMax,
    visibility: parsed.data.visibility,
    visibilityList: parsed.data.visibilityList,
    createdAt: now,
    updatedAt: now,
  })

  const [router] = await db.select().from(routers).where(eq(routers.id, id)).limit(1)
  logAudit({
    userId,
    action: 'router_create',
    targetId: id,
    targetType: 'router',
    ipAddress: getClientIp(c),
  })
  return c.json({ ok: true, data: sanitizeRouter(router) }, 201)
})

// Get single router
routerRoutes.get('/:id', async (c) => {
  const routerId = c.req.param('id')
  const userId = c.get('userId')

  const [router] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1)
  if (!router) {
    return c.json({ ok: false, error: 'Router not found' }, 404)
  }

  const admin = await isAdmin(userId)
  if (!admin && !isRouterVisibleToUser(router, userId)) {
    return c.json({ ok: false, error: 'Router not found' }, 404)
  }

  return c.json({ ok: true, data: sanitizeRouter(router) })
})

// Update router
routerRoutes.put('/:id', async (c) => {
  const routerId = c.req.param('id')
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const parsed = updateRouterSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Validation failed', fields: formatZodError(parsed.error) },
      400,
    )
  }

  const [router] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1)
  if (!router) {
    return c.json({ ok: false, error: 'Router not found' }, 404)
  }

  const admin = await isAdmin(userId)
  if (router.createdById !== userId && !admin) {
    return c.json({ ok: false, error: 'Only the router owner or admin can update' }, 403)
  }

  // Block SSRF on update
  if (
    parsed.data.llmBaseUrl !== undefined &&
    (isInternalUrl(parsed.data.llmBaseUrl) || (await resolvesToPrivateIp(parsed.data.llmBaseUrl)))
  ) {
    return c.json(
      { ok: false, error: 'LLM base URL must not point to internal or private networks' },
      400,
    )
  }

  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { updatedAt: now }

  if (parsed.data.name !== undefined) updateData.name = parsed.data.name
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description
  if (parsed.data.llmBaseUrl !== undefined) updateData.llmBaseUrl = parsed.data.llmBaseUrl
  // NOTE: llmApiKey is encrypted at application layer (see POST handler comment)
  if (parsed.data.llmApiKey !== undefined)
    updateData.llmApiKey = encryptSecret(parsed.data.llmApiKey)
  if (parsed.data.llmModel !== undefined) updateData.llmModel = parsed.data.llmModel
  if (parsed.data.maxChainDepth !== undefined) updateData.maxChainDepth = parsed.data.maxChainDepth
  if (parsed.data.rateLimitWindow !== undefined)
    updateData.rateLimitWindow = parsed.data.rateLimitWindow
  if (parsed.data.rateLimitMax !== undefined) updateData.rateLimitMax = parsed.data.rateLimitMax
  // Visibility fields only apply to global routers — ignore for personal scope
  if (router.scope === 'global') {
    if (parsed.data.visibility !== undefined) updateData.visibility = parsed.data.visibility
    if (parsed.data.visibilityList !== undefined)
      updateData.visibilityList = parsed.data.visibilityList
  }

  await db.update(routers).set(updateData).where(eq(routers.id, routerId))

  logAudit({
    userId,
    action: 'router_update',
    targetId: routerId,
    targetType: 'router',
    ipAddress: getClientIp(c),
  })

  const [updated] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1)
  return c.json({ ok: true, data: sanitizeRouter(updated) })
})

// Delete router
routerRoutes.delete('/:id', async (c) => {
  const routerId = c.req.param('id')
  const userId = c.get('userId')

  const [router] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1)
  if (!router) {
    return c.json({ ok: false, error: 'Router not found' }, 404)
  }

  const admin = await isAdmin(userId)
  if (router.createdById !== userId && !admin) {
    return c.json({ ok: false, error: 'Only the router owner or admin can delete' }, 403)
  }

  await db.delete(routers).where(eq(routers.id, routerId))
  logAudit({
    userId,
    action: 'router_delete',
    targetId: routerId,
    targetType: 'router',
    metadata: { name: router.name },
    ipAddress: getClientIp(c),
  })
  return c.json({ ok: true })
})

// Test LLM connection
routerRoutes.post('/:id/test', routerTestRateLimit, async (c) => {
  const routerId = c.req.param('id')
  const userId = c.get('userId')

  const [router] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1)
  if (!router) {
    return c.json({ ok: false, error: 'Router not found' }, 404)
  }

  const admin = await isAdmin(userId)
  if (!admin && !isRouterVisibleToUser(router, userId)) {
    return c.json({ ok: false, error: 'Router not found' }, 404)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.routerTestTimeoutMs)
  try {
    const apiKey = decryptSecret(router.llmApiKey)
    if (!apiKey) {
      log.error(`Failed to decrypt API key for router ${routerId}. Check ENCRYPTION_KEY.`)
      return c.json({ ok: false, error: 'Router configuration error' }, 500)
    }
    const res = await fetch(`${router.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: router.llmModel,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    })

    if (res.ok) {
      return c.json({ ok: true, data: { success: true } })
    } else {
      log.warn(`Router test failed for router ${routerId}: HTTP ${res.status}`)
      return c.json({ ok: false, error: `LLM API returned HTTP ${res.status}` })
    }
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? `Connection timeout (${config.routerTestTimeoutMs / 1000}s)`
        : 'Connection failed'
    return c.json({ ok: false, error: message })
  } finally {
    clearTimeout(timeout)
  }
})
