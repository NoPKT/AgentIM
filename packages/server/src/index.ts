import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from './config.js'
import { loggerMiddleware } from './middleware/logger.js'
import { apiRateLimit } from './middleware/rateLimit.js'
import { migrate } from './db/index.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { roomRoutes } from './routes/rooms.js'
import { messageRoutes } from './routes/messages.js'
import { agentRoutes } from './routes/agents.js'
import { taskRoutes } from './routes/tasks.js'
import { handleClientMessage, handleClientDisconnect } from './ws/clientHandler.js'
import { handleGatewayMessage, handleGatewayDisconnect } from './ws/gatewayHandler.js'

// Run migrations on startup
migrate()

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

// Global middleware
app.use('*', secureHeaders())
app.use(
  '*',
  cors({
    origin: config.corsOrigin,
    credentials: true,
  }),
)
app.use('*', loggerMiddleware)
app.use('/api/*', apiRateLimit)

// Health check
app.get('/api/health', (c) => c.json({ ok: true, timestamp: new Date().toISOString() }))

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/users', userRoutes)
app.route('/api/rooms', roomRoutes)
app.route('/api/messages', messageRoutes)
app.route('/api/agents', agentRoutes)
app.route('/api/tasks', taskRoutes)

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
    if (reqPath.startsWith('/api/') || reqPath.startsWith('/ws/')) {
      return c.notFound()
    }
    const { readFileSync } = await import('node:fs')
    const html = readFileSync(resolve(webDistPath, 'index.html'), 'utf-8')
    return c.html(html)
  })
}

console.log(`AgentIM Server starting on ${config.host}:${config.port}`)

const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
})

injectWebSocket(server)

console.log(`AgentIM Server running at http://${config.host}:${config.port}`)
