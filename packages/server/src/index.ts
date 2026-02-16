import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from './config.js'
import { createLogger } from './lib/logger.js'
import { initSentry, captureException } from './lib/sentry.js'
import { loggerMiddleware } from './middleware/logger.js'

const log = createLogger('Server')

// Initialize Sentry (if SENTRY_DSN is set)
await initSentry()
import { apiRateLimit } from './middleware/rateLimit.js'
import { migrate, closeDb, db } from './db/index.js'
import { closeRedis, getRedis } from './lib/redis.js'
import { sql, lt } from 'drizzle-orm'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { roomRoutes } from './routes/rooms.js'
import { messageRoutes } from './routes/messages.js'
import { agentRoutes } from './routes/agents.js'
import { taskRoutes } from './routes/tasks.js'
import { refreshTokens } from './db/schema.js'
import { uploadRoutes, startOrphanCleanup, stopOrphanCleanup } from './routes/uploads.js'
import { docsRoutes } from './routes/docs.js'
import { handleClientMessage, handleClientDisconnect } from './ws/clientHandler.js'
import { handleGatewayMessage, handleGatewayDisconnect } from './ws/gatewayHandler.js'

// Run migrations on startup
await migrate()

// Seed admin user from env vars
async function seedAdmin() {
  if (!config.adminPassword) {
    log.warn('ADMIN_PASSWORD not set — no admin user will be seeded.')
    return
  }
  const { nanoid } = await import('nanoid')
  const { hash } = await import('argon2')
  const { eq } = await import('drizzle-orm')
  const { users } = await import('./db/schema.js')

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.username, config.adminUsername))
    .limit(1)

  const now = new Date().toISOString()

  if (existing) {
    // Update password and ensure role is admin
    const passwordHash = await hash(config.adminPassword)
    await db
      .update(users)
      .set({ passwordHash, role: 'admin', updatedAt: now })
      .where(eq(users.id, existing.id))
    log.info(`Admin user updated: ${config.adminUsername}`)
  } else {
    // Create admin user
    const id = nanoid()
    const passwordHash = await hash(config.adminPassword)
    await db.insert(users).values({
      id,
      username: config.adminUsername,
      passwordHash,
      displayName: config.adminUsername,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    })
    log.info(`Admin user created: ${config.adminUsername}`)
  }
}

await seedAdmin()

// Ensure upload directory exists
const uploadDir = resolve(config.uploadDir)
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true })
  log.info(`Upload directory created: ${uploadDir}`)
}

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

// Global middleware
app.use(
  '*',
  secureHeaders(
    config.isProduction
      ? {
          contentSecurityPolicy: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
          },
        }
      : {},
  ),
)
app.use(
  '*',
  cors({
    origin: config.corsOrigin,
    credentials: true,
  }),
)
app.use('*', loggerMiddleware)
app.use('/api/*', apiRateLimit)
// Body size limit: 12MB for uploads, 1MB for other API routes
app.use('/api/*', async (c, next) => {
  const limit = c.req.path.startsWith('/api/upload') ? 12 * 1024 * 1024 : 1024 * 1024
  return bodyLimit({ maxSize: limit })(c, next)
})

// Global error handler
app.onError((err, c) => {
  captureException(err)
  log.error(`Unhandled error: ${err.message}`)
  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500
  return c.json(
    { ok: false, error: config.isProduction ? 'Internal server error' : err.message },
    status as any,
  )
})

// Health check (verifies DB + Redis connectivity)
app.get('/api/health', async (c) => {
  const checks: Record<string, boolean> = {}

  try {
    await db.execute(sql`SELECT 1`)
    checks.database = true
  } catch {
    checks.database = false
  }

  try {
    await getRedis().ping()
    checks.redis = true
  } catch {
    checks.redis = false
  }

  const healthy = Object.values(checks).every(Boolean)
  return c.json(
    { ok: healthy, timestamp: new Date().toISOString(), checks },
    healthy ? 200 : 503,
  )
})

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/users', userRoutes)
app.route('/api/rooms', roomRoutes)
app.route('/api/messages', messageRoutes)
app.route('/api/agents', agentRoutes)
app.route('/api/tasks', taskRoutes)
app.route('/api/upload', uploadRoutes)
app.route('/api/docs', docsRoutes)

// Serve uploaded files
app.use(
  '/uploads/*',
  serveStatic({
    root: uploadDir,
    rewriteRequestPath: (path) => path.replace(/^\/uploads/, ''),
  }),
)

// WebSocket endpoints
app.get(
  '/ws/client',
  upgradeWebSocket(() => ({
    onMessage(evt, ws) {
      const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
      handleClientMessage(ws, raw)
    },
    onClose(_, ws) {
      handleClientDisconnect(ws)
    },
  })),
)

app.get(
  '/ws/gateway',
  upgradeWebSocket(() => ({
    onMessage(evt, ws) {
      const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
      handleGatewayMessage(ws, raw)
    },
    onClose(_, ws) {
      handleGatewayDisconnect(ws)
    },
  })),
)

// Serve static files (Web UI) in production
const webDistPath = resolve(import.meta.dirname, '../../web/dist')
if (existsSync(webDistPath)) {
  app.use('/assets/*', serveStatic({ root: webDistPath }))
  app.use('/manifest.json', serveStatic({ root: webDistPath }))
  // SPA fallback: serve index.html for non-API, non-WS routes
  app.get('*', async (c) => {
    const reqPath = c.req.path
    if (reqPath.startsWith('/api/') || reqPath.startsWith('/ws/') || reqPath.startsWith('/uploads/')) {
      return c.notFound()
    }
    const { readFileSync } = await import('node:fs')
    const html = readFileSync(resolve(webDistPath, 'index.html'), 'utf-8')
    return c.html(html)
  })
}

log.info(`Starting on ${config.host}:${config.port}`)

const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
})

injectWebSocket(server)
startOrphanCleanup()

// Periodic cleanup: remove expired refresh tokens
let tokenCleanupTimer: ReturnType<typeof setInterval> | null = null

function startTokenCleanup() {
  tokenCleanupTimer = setInterval(async () => {
    try {
      const now = new Date().toISOString()
      await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now))
    } catch (err) {
      log.error(`Failed to clean up expired refresh tokens: ${(err as Error).message}`)
    }
  }, config.tokenCleanupInterval)
}

function stopTokenCleanup() {
  if (tokenCleanupTimer) {
    clearInterval(tokenCleanupTimer)
    tokenCleanupTimer = null
  }
}

startTokenCleanup()

log.info(`Running at http://${config.host}:${config.port}`)

// Graceful shutdown
async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down gracefully...`)
  stopOrphanCleanup()
  stopTokenCleanup()
  server.close(() => {
    log.info('HTTP server closed')
  })
  await closeDb()
  log.info('Database connection closed')
  await closeRedis()
  log.info('Redis connection closed')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('uncaughtException', (err) => {
  captureException(err)
  log.fatal(`Uncaught exception: ${err.message}`)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  captureException(reason)
  log.error(`Unhandled rejection: ${reason}`)
})
