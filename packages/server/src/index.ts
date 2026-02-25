import { nanoid } from 'nanoid'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { existsSync, mkdirSync, accessSync, constants, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config, getConfigSync, _setSettingsModule } from './config.js'
import { createLogger } from './lib/logger.js'
import { initSentry, captureException } from './lib/sentry.js'
import { loggerMiddleware } from './middleware/logger.js'
import { verifyToken } from './lib/jwt.js'

const log = createLogger('Server')

// Initialize Sentry (if SENTRY_DSN is set)
await initSentry()
import { apiRateLimit, wsUpgradeRateLimit, stopRateLimitCleanup } from './middleware/rateLimit.js'
import { migrate, closeDb, db } from './db/index.js'
import { closeRedis, getRedis, ensureRedisConnected, isRedisEnabled } from './lib/redis.js'
import { sql, lt } from 'drizzle-orm'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { roomRoutes } from './routes/rooms.js'
import { messageRoutes } from './routes/messages.js'
import { agentRoutes } from './routes/agents.js'
import { taskRoutes } from './routes/tasks.js'
import { refreshTokens } from './db/schema.js'
import { uploadRoutes, startOrphanCleanup, stopOrphanCleanup } from './routes/uploads.js'
import { startGatewayCleanup, stopGatewayCleanup } from './lib/gatewayCleanup.js'
import { routerRoutes } from './routes/routers.js'
import serviceAgentsRoutes from './routes/serviceAgents.js'
import { docsRoutes } from './routes/docs.js'
import { settingsRoutes } from './routes/settings.js'
import { connectionManager } from './ws/connections.js'
import {
  handleClientMessage,
  handleClientDisconnect,
  stopClientHandlerCleanup,
} from './ws/clientHandler.js'
import {
  handleGatewayMessage,
  handleGatewayDisconnect,
  stopStreamTrackerCleanup,
  stopAgentRateCleanup,
  stopVisitedFallbackCleanup,
} from './ws/gatewayHandler.js'
import { bookmarkRoutes } from './routes/bookmarks.js'
import { pushRoutes } from './routes/push.js'
import { stopPermissionCleanup } from './lib/permission-store.js'
import { stopCacheCleanup } from './lib/cache.js'
import { initWebPush } from './lib/webPush.js'
import { initTokenRevocationSubscriber } from './lib/tokenRevocation.js'
import {
  renderPrometheusMetrics,
  setActiveRoomsGetter,
  getCountersSnapshot,
  getHistogramsSnapshot,
  getActiveRooms,
} from './lib/metrics.js'

// Verify Redis connectivity before proceeding
await ensureRedisConnected()

// Run migrations on startup (can be disabled via RUN_MIGRATIONS=false)
if (config.runMigrations) {
  await migrate()
  log.info('Database migrations completed')
} else {
  log.info('Skipping migrations (RUN_MIGRATIONS=false)')
}

// Preload settings from DB into cache and inject settings module into config bridge
import { preloadSettings, getSettingSync, getSettingTypedSync } from './lib/settings.js'
import { _setStorageSettingsReader } from './storage/index.js'
await preloadSettings()
_setSettingsModule({ getSettingSync, getSettingTypedSync })
_setStorageSettingsReader(getSettingSync)

// Seed admin user from env vars
async function seedAdmin() {
  if (!config.adminPassword) {
    log.warn('ADMIN_PASSWORD not set — no admin user will be seeded.')
    return
  }
  // Validate admin password meets complexity requirements (same as user passwords)
  const pwTooShort = config.adminPassword.length < 8
  const pwTooWeak =
    !/[a-z]/.test(config.adminPassword) ||
    !/[A-Z]/.test(config.adminPassword) ||
    !/[0-9]/.test(config.adminPassword)
  if (config.isProduction && (pwTooShort || pwTooWeak)) {
    log.fatal(
      'ADMIN_PASSWORD does not meet minimum complexity requirements: must be at least 8 characters with lowercase, uppercase, and a digit. Example: ADMIN_PASSWORD=$(openssl rand -base64 16)',
    )
    process.exit(1)
  } else if (pwTooShort) {
    log.warn('ADMIN_PASSWORD is shorter than 8 characters — consider using a stronger password.')
  } else if (pwTooWeak) {
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
      const pgCode =
        (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
      if (pgCode === '23505') {
        // UNIQUE constraint violation — another instance already created the admin
        log.info(`Admin user already exists (concurrent seed): ${config.adminUsername}`)
      } else {
        throw err
      }
    }
  }
}

await seedAdmin()

// Initialize Web Push (no-op if VAPID keys are not configured in admin settings)
await initWebPush()

// Subscribe to cross-process token revocation events (no-op if Redis is not configured)
await initTokenRevocationSubscriber()

// Ensure upload directory exists (local storage only)
const uploadDir = resolve(config.uploadDir)
if (config.storageProvider === 'local') {
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
}

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

// Global middleware
app.use(
  '*',
  secureHeaders(
    config.isProduction
      ? {
          strictTransportSecurity: 'max-age=15552000; includeSubDomains',
          permissionsPolicy: {
            camera: [] as string[],
            microphone: [] as string[],
            geolocation: [] as string[],
            payment: [] as string[],
          },
          contentSecurityPolicy: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
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
    origin: (requestOrigin) => {
      // Dynamic CORS: reads from DB settings cache (or env var fallback)
      const allowed = getConfigSync<string>('cors.origin') || config.corsOrigin
      if (!allowed) return requestOrigin || '*'
      const origins = allowed.split(',').map((s) => s.trim())
      return origins.includes(requestOrigin) ? requestOrigin : origins[0]
    },
    credentials: true,
  }),
)
app.use('*', loggerMiddleware)
app.use('/api/*', apiRateLimit)
// Body size limit: pre-created instances to avoid per-request allocation
const uploadBodyLimiter = bodyLimit({ maxSize: config.uploadBodyLimit })
const apiBodyLimiter = bodyLimit({ maxSize: config.apiBodyLimit })
app.use('/api/upload/*', uploadBodyLimiter)
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/upload')) return next()
  return apiBodyLimiter(c, next)
})

// Global error handler
app.onError((err, c) => {
  const errorId = nanoid()
  captureException(err)
  log.error(
    `Unhandled error [${errorId}]: ${err.message}${(err as Error).stack ? `\n${(err as Error).stack}` : ''}`,
  )
  const rawStatus = 'status' in err && typeof err.status === 'number' ? err.status : 500
  // Only allow valid HTTP client/server error codes; default to 500 for anything else
  const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500
  return c.json(
    {
      ok: false,
      error: config.isProduction ? 'Internal server error' : err.message,
      errorId,
    },
    status as ContentfulStatusCode,
  )
})

// Health check (verifies DB + Redis + filesystem connectivity)
// Cached for 5 seconds to avoid excessive DB/Redis probes under frequent polling
let healthCache: { result: Record<string, unknown>; healthy: boolean; expiresAt: number } | null =
  null
const HEALTH_CACHE_TTL_MS = 5_000

app.get('/api/health', async (c) => {
  const now = Date.now()
  if (healthCache && now < healthCache.expiresAt) {
    return c.json(healthCache.result, healthCache.healthy ? 200 : 503)
  }

  const checks: Record<string, boolean> = {}

  try {
    await db.execute(sql`SELECT 1`)
    checks.database = true
  } catch {
    checks.database = false
  }

  if (isRedisEnabled()) {
    try {
      await getRedis().ping()
      checks.redis = true
    } catch {
      checks.redis = false
    }
  }
  // When Redis is not configured, omit it from health checks entirely

  if (config.storageProvider === 'local') {
    try {
      accessSync(uploadDir, constants.W_OK)
      checks.filesystem = true
    } catch {
      checks.filesystem = false
    }
  } else {
    checks.filesystem = true // S3 mode — no local filesystem dependency
  }

  const healthy = Object.values(checks).every(Boolean)
  const mem = process.memoryUsage()
  const result = {
    ok: healthy,
    timestamp: new Date().toISOString(),
    checks,
    system: {
      memoryMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    },
  }

  healthCache = { result, healthy, expiresAt: now + HEALTH_CACHE_TTL_MS }
  return c.json(result, healthy ? 200 : 503)
})

// Register active rooms getter for Prometheus metrics
setActiveRoomsGetter(() => connectionManager.getStats().activeRooms)

// Prometheus-compatible metrics (unauthenticated; does not expose user data)
app.get('/api/metrics', (c) => {
  const ws = connectionManager.getStats()
  const mem = process.memoryUsage()
  const lines = [
    '# HELP agentim_ws_client_connections Number of active client WebSocket connections',
    '# TYPE agentim_ws_client_connections gauge',
    `agentim_ws_client_connections ${ws.clientConnections}`,
    '# HELP agentim_ws_gateway_connections Number of active gateway WebSocket connections',
    '# TYPE agentim_ws_gateway_connections gauge',
    `agentim_ws_gateway_connections ${ws.gatewayConnections}`,
    '# HELP agentim_online_users Number of users with at least one active client connection',
    '# TYPE agentim_online_users gauge',
    `agentim_online_users ${ws.onlineUsers}`,
    '# HELP agentim_connected_agents Number of agents registered via active gateways',
    '# TYPE agentim_connected_agents gauge',
    `agentim_connected_agents ${ws.connectedAgents}`,
    '# HELP process_uptime_seconds Server uptime in seconds',
    '# TYPE process_uptime_seconds counter',
    `process_uptime_seconds ${Math.round(process.uptime())}`,
    '# HELP process_heap_bytes Node.js heap used bytes',
    '# TYPE process_heap_bytes gauge',
    `process_heap_bytes ${mem.heapUsed}`,
    '# HELP process_rss_bytes Node.js resident set size bytes',
    '# TYPE process_rss_bytes gauge',
    `process_rss_bytes ${mem.rss}`,
  ]

  // Append dynamic metrics (counters, histograms, active rooms gauge)
  const dynamicMetrics = renderPrometheusMetrics()
  const output = lines.join('\n') + '\n' + dynamicMetrics
  return c.text(output, 200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  })
})

// Admin metrics endpoint (JSON format for dashboard)
app.get('/api/admin/metrics', async (c) => {
  // Require valid JWT with admin role
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401)
  }
  try {
    const payload = await verifyToken(token)
    const { eq } = await import('drizzle-orm')
    const { users } = await import('./db/schema.js')
    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1)
    if (!user || user.role !== 'admin') {
      return c.json({ ok: false, error: 'Forbidden' }, 403)
    }
  } catch {
    return c.json({ ok: false, error: 'Invalid or expired token' }, 401)
  }

  const ws = connectionManager.getStats()
  const mem = process.memoryUsage()
  const histSnap = getHistogramsSnapshot()
  return c.json({
    ok: true,
    data: {
      connections: {
        clients: ws.clientConnections,
        gateways: ws.gatewayConnections,
        onlineUsers: ws.onlineUsers,
        connectedAgents: ws.connectedAgents,
      },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        heapUsedBytes: mem.heapUsed,
        rssBytes: mem.rss,
      },
      infrastructure: {
        redisEnabled: config.redisEnabled,
      },
      activity: {
        messagesTotal: getCountersSnapshot(),
        activeRooms: getActiveRooms(),
      },
      performance: {
        agentResponse: histSnap['agentim_agent_response_duration_seconds'] ?? {},
        httpRequest: histSnap['agentim_http_request_duration_seconds'] ?? {},
      },
      timestamp: new Date().toISOString(),
    },
  })
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
app.route('/api/service-agents', serviceAgentsRoutes)
app.route('/api/docs', docsRoutes)
app.route('/api/admin/settings', settingsRoutes)
app.route('/api/bookmarks', bookmarkRoutes)
app.route('/api/push', pushRoutes)

// Auth guard for uploaded files: require a valid JWT (Bearer header or ?token= query param).
// This prevents unauthenticated access to uploaded files.
// Note: access tokens have a short TTL (default 15m). The web client appends the current
// access token to upload URLs so that browser image requests carry auth credentials.
app.use('/uploads/*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (c.req.query('token') ?? '')

  if (!token) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401)
  }

  try {
    await verifyToken(token)
  } catch {
    return c.json({ ok: false, error: 'Invalid or expired token' }, 401)
  }

  await next()
  // Prevent MIME sniffing
  c.header('X-Content-Type-Options', 'nosniff')
  // Strict CSP for uploaded content: prevent any script/style execution
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  // Force download for non-safe types (prevent SVG XSS, HTML injection, etc.)
  const contentType = c.res.headers.get('Content-Type') ?? ''
  const safeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!safeTypes.some((t) => contentType.startsWith(t))) {
    c.header('Content-Disposition', 'attachment')
  }
})
if (config.storageProvider === 's3') {
  // S3 mode: proxy file reads from S3
  const { getStorage } = await import('./storage/index.js')
  const MIME_LOOKUP: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
  }
  app.get('/uploads/:filename', async (c) => {
    const filename = c.req.param('filename')
    try {
      const {
        stream,
        contentType: s3ContentType,
        contentLength,
      } = await getStorage().readStream(filename)
      const ext = filename.includes('.') ? '.' + filename.split('.').pop() : ''
      const contentType = s3ContentType || MIME_LOOKUP[ext] || 'application/octet-stream'
      const headers: Record<string, string> = { 'Content-Type': contentType }
      if (contentLength != null) {
        headers['Content-Length'] = String(contentLength)
      }
      return new Response(stream, { status: 200, headers })
    } catch {
      return c.json({ ok: false, error: 'File not found' }, 404)
    }
  })
} else {
  // Local mode: serve from filesystem
  app.use(
    '/uploads/*',
    serveStatic({
      root: uploadDir,
      rewriteRequestPath: (path) => path.replace(/^\/uploads/, ''),
    }),
  )
}

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
  wsUpgradeRateLimit,
  upgradeWebSocket(() => ({
    onOpen(_, ws) {
      wsAuthTimers.set(
        ws,
        setTimeout(() => {
          // If still not authenticated after timeout, close the connection
          const client = connectionManager.getClient(ws)
          if (!client) {
            try {
              ws.close(WS_CLOSE_AUTH_TIMEOUT, 'Authentication timeout')
            } catch {
              // Connection may already be closed
            }
          }
        }, WS_AUTH_TIMEOUT_MS),
      )
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
  wsUpgradeRateLimit,
  upgradeWebSocket(() => ({
    onOpen(_, ws) {
      wsAuthTimers.set(
        ws,
        setTimeout(() => {
          const gw = connectionManager.getGateway(ws)
          if (!gw) {
            try {
              ws.close(WS_CLOSE_AUTH_TIMEOUT, 'Authentication timeout')
            } catch {
              // Connection may already be closed
            }
          }
        }, WS_AUTH_TIMEOUT_MS),
      )
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
  // Cache index.html once at startup to avoid per-request readFileSync calls
  const indexHtmlPath = resolve(webDistPath, 'index.html')
  const indexHtml = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, 'utf-8') : null

  // Serve all static files from the web dist directory (assets, PWA files, icons, etc.)
  app.use('*', serveStatic({ root: webDistPath }))
  // SPA fallback: serve index.html for non-API, non-WS, non-upload routes
  // that didn't match a physical file above
  app.get('*', (c) => {
    const reqPath = c.req.path
    if (
      reqPath.startsWith('/api/') ||
      reqPath.startsWith('/ws/') ||
      reqPath.startsWith('/uploads/')
    ) {
      return c.notFound()
    }
    if (!indexHtml) return c.notFound()
    return c.html(indexHtml)
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
startGatewayCleanup()
await connectionManager.initPubSub()

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
  stopGatewayCleanup()
  stopTokenCleanup()
  // Stop all module-level interval timers to allow clean process exit
  stopStreamTrackerCleanup()
  stopAgentRateCleanup()
  stopVisitedFallbackCleanup()
  stopClientHandlerCleanup()
  stopRateLimitCleanup()
  stopPermissionCleanup()
  stopCacheCleanup()
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
  await connectionManager.closePubSub()
  log.info('Pub/Sub closed')
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
