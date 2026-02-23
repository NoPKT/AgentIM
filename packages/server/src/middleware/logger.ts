import { createMiddleware } from 'hono/factory'
import { nanoid } from 'nanoid'
import { createLogger } from '../lib/logger.js'
import { observeHttpDuration } from '../lib/metrics.js'

const log = createLogger('HTTP')

export const loggerMiddleware = createMiddleware(async (c, next) => {
  const requestId = (c.req.header('X-Request-ID') || nanoid(12)).slice(0, 32)
  c.set('requestId', requestId)
  c.header('X-Request-ID', requestId)

  const start = Date.now()
  await next()
  const ms = Date.now() - start
  log.info(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`, { requestId })
  observeHttpDuration(c.req.method, c.req.path, ms / 1000)
})
