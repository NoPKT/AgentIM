import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { existsSync, mkdirSync, accessSync, constants } from 'node:fs'
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
import { closeRedis, getRedis, ensureRedisConnected } from './lib/redis.js'
import { sql, lt } from 'drizzle-orm'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { roomRoutes } from './routes/rooms.js'
import { messageRoutes } from './routes/messages.js'
import { agentRoutes } from './routes/agents.js'
import { taskRoutes } from './routes/tasks.js'
import { refreshTokens } from './db/schema.js'
import { uploadRoutes, startOrphanCleanup, stopOrphanCleanup } from './routes/uploads.js'
import { routerRoutes } from './routes/routers.js'
import { docsRoutes } from './routes/docs.js'
import { connectionManager } from './ws/connections.js'
import { handleClientMessage, handleClientDisconnect } from './ws/clientHandler.js'
import { handleGatewayMessage, handleGatewayDisconnect } from './ws/gatewayHandler.js'

// Verify Redis connectivity before proceeding
await ensureRedisConnected()

// Run migrations on startup
await migrate()

// Seed admin user from env vars
async function seedAdmin() {
  if (!config.adminPassword) {
    log.warn('ADMIN_PASSWORD not set — no admin user will be seeded.')
    return
  }
  // Validate admin password meets complexity requirements (same as user passwords)
  if (config.adminPassword.length < 8) {
    log.warn('ADMIN_PASSWORD is shorter than 8 characters — consider using a stronger password.')
  } else if (
    !/[a-z]/.test(config.adminPassword) ||
    !/[A-Z]/.test(config.adminPassword) ||
    !/[0-9]/.test(config.adminPassword)
  ) {
    log.warn('ADMIN_PASSWORD should contain lowercase, uppercase, and digit characters.')
  }
  const { nanoid } = await import('nanoid')
  const { hash, verify } = await import('argon2')
  const { eq } = await import('drizzle-orm')
  const { users } = await import('./db/schema.js')

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.username, config.adminUsername))
    .limit(1)

  const now = new Date().toISOString()

  if (existing) {
    // Only update if the env-var password has changed or role is not admin
    const passwordChanged = !(await verify(existing.passwordHash, config.adminPassword))
    const roleChanged = existing.role !== 'admin'
    if (passwordChanged || roleChanged) {
      const updates: Record<string, unknown> = { role: 'admin', updatedAt: now }
      if (passwordChanged) {
        updates.passwordHash = await hash(config.adminPassword)
      }
      await db.update(users).set(updates).where(eq(users.id, existing.id))
      log.info(`Admin user updated: ${config.adminUsername}`)
    }
  } else {
    // Create admin user (handle race condition with concurrent instances)
    const id = nanoid()
    const passwordHash = await hash(config.adminPassword)
    try {
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
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') {
        // UNIQUE constraint violation — another instance already created the admin
        log.info(`Admin user already exists (concurrent seed): ${config.adminUsername}`)
      } else {
        throw err
      }
    }
  }
}

await seedAdmin()

// Ensure upload directory exists
const uploadDir = resolve(config.uploadDir)
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true })
  log.info(`Upload directory created: ${uploadDir}`)
}
try {
  accessSync(uploadDir, constants.W_OK)
} catch {
  log.fatal(`Upload directory is not writable: ${uploadDir}`)
  process.exit(1)
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
            connectSrc: ["'self'", 'wss:'],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            workerSrc: ["'self'"],
            manifestSrc: ["'self'"],
            upgradeInsecureRequests: [],
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
// Body size limit: uploadBodyLimit for uploads, apiBodyLimit for other API routes
app.use('/api/*', async (c, next) => {
  const limit = c.req.path.startsWith('/api/upload') ? config.uploadBodyLimit : config.apiBodyLimit
  return bodyLimit({ maxSize: limit })(c, next)
})

// Global error handler
app.onError((err, c) => {
  captureException(err)
  log.error(`Unhandled error: ${err.message}${(err as Error).stack ? `\n${(err as Error).stack}` : ''}`)
  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500
  return c.json(
    { ok: false, error: config.isProduction ? 'Internal server error' : err.message },
    status as ContentfulStatusCode,
  )
})

// Health check (verifies DB + Redis + filesystem connectivity)
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

  try {
    accessSync(uploadDir, constants.W_OK)
    checks.filesystem = true
  } catch {
    checks.filesystem = false
  }

  const healthy = Object.values(checks).every(Boolean)
  const mem = process.memoryUsage()
  return c.json({
    ok: healthy,
    timestamp: new Date().toISOString(),
    checks,
    system: {
      memoryMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    },
  }, healthy ? 200 : 503)
})

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/users', userRoutes)
app.route('/api/rooms', roomRoutes)
app.route('/api/messages', messageRoutes)
app.route('/api/agents', agentRoutes)
app.route('/api/tasks', taskRoutes)
app.route('/api/upload', uploadRoutes)
app.route('/api/routers', routerRoutes)
app.route('/api/docs', docsRoutes)

// Serve uploaded files with security headers
app.use('/uploads/*', async (c, next) => {
  await next()
  // Prevent MIME sniffing
  c.header('X-Content-Type-Options', 'nosniff')
  // Force download for non-safe types (prevent SVG XSS, HTML injection, etc.)
  const contentType = c.res.headers.get('Content-Type') ?? ''
  const safeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!safeTypes.some((t) => contentType.startsWith(t))) {
    c.header('Content-Disposition', 'attachment')
  }
})
app.use(
  '/uploads/*',
  serveStatic({
    root: uploadDir,
    rewriteRequestPath: (path) => path.replace(/^\/uploads/, ''),
  }),
)

// WebSocket endpoints
// Custom close codes (4000-4999 are reserved for application use per RFC 6455):
//   4001 — Authentication timeout: client/gateway did not authenticate within the allowed window
// Standard close codes used:
//   1008 — Policy violation: session revoked (logout / password change while connected)
const WS_AUTH_TIMEOUT_MS = config.wsAuthTimeoutMs
const WS_CLOSE_AUTH_TIMEOUT = 4001
const wsAuthTimers = new WeakMap<object, ReturnType<typeof setTimeout>>()

app.get(
  '/ws/client',
  upgradeWebSocket(() => ({
    onOpen(_, ws) {
      wsAuthTimers.set(ws, setTimeout(() => {
        // If still not authenticated after timeout, close the connection
        const client = connectionManager.getClient(ws)
        if (!client) {
          try { ws.close(WS_CLOSE_AUTH_TIMEOUT, 'Authentication timeout') } catch {}
        }
      }, WS_AUTH_TIMEOUT_MS))
    },
    async onMessage(evt, ws) {
      const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
      await handleClientMessage(ws, raw)
      // Clear auth timer once the client has been successfully authenticated
      if (wsAuthTimers.has(ws) && connectionManager.getClient(ws)) {
        clearTimeout(wsAuthTimers.get(ws)!)
        wsAuthTimers.delete(ws)
      }
    },
    onClose(_, ws) {
      const timer = wsAuthTimers.get(ws)
      if (timer) {
        clearTimeout(timer)
        wsAuthTimers.delete(ws)
      }
      handleClientDisconnect(ws)
    },
  })),
)

app.get(
  '/ws/gateway',
  upgradeWebSocket(() => ({
    onOpen(_, ws) {
      wsAuthTimers.set(ws, setTimeout(() => {
        const gw = connectionManager.getGateway(ws)
        if (!gw) {
          try { ws.close(WS_CLOSE_AUTH_TIMEOUT, 'Authentication timeout') } catch {}
        }
      }, WS_AUTH_TIMEOUT_MS))
    },
    async onMessage(evt, ws) {
      const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
      await handleGatewayMessage(ws, raw)
      // Clear auth timer once the gateway has been successfully authenticated
      if (wsAuthTimers.has(ws) && connectionManager.getGateway(ws)) {
        clearTimeout(wsAuthTimers.get(ws)!)
        wsAuthTimers.delete(ws)
      }
    },
    onClose(_, ws) {
      const timer = wsAuthTimers.get(ws)
      if (timer) {
        clearTimeout(timer)
        wsAuthTimers.delete(ws)
      }
      handleGatewayDisconnect(ws)
    },
  })),
)

// Serve static files (Web UI) in production
const webDistPath = resolve(import.meta.dirname, '../../web/dist')
if (existsSync(webDistPath)) {
  // Serve all static files from the web dist directory (assets, PWA files, icons, etc.)
  app.use('*', serveStatic({ root: webDistPath }))
  // SPA fallback: serve index.html for non-API, non-WS, non-upload routes
  // that didn't match a physical file above
  app.get('*', async (c) => {
    const reqPath = c.req.path
    if (
      reqPath.startsWith('/api/') ||
      reqPath.startsWith('/ws/') ||
      reqPath.startsWith('/uploads/')
    ) {
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
const SHUTDOWN_TIMEOUT_MS = 10_000

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down gracefully...`)
  stopOrphanCleanup()
  stopTokenCleanup()
  // Notify connected WS clients about the shutdown
  connectionManager.broadcastToAll({
    type: 'server:error',
    code: 'SERVER_SHUTDOWN',
    message: 'Server is shutting down',
  })
  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      log.warn('Shutdown timeout reached, forcing close')
      resolve()
    }, SHUTDOWN_TIMEOUT_MS)
    forceTimer.unref()
    server.close(() => {
      clearTimeout(forceTimer)
      log.info('HTTP server closed')
      resolve()
    })
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
