import { Hono } from 'hono'
import { authMiddleware, adminMiddleware, type AuthEnv } from '../middleware/auth.js'
import {
  getAllSettings,
  setSetting,
  getSettingDefinition,
  invalidateCache,
  SETTING_DEFINITIONS,
} from '../lib/settings.js'
import { reinitSentry } from '../lib/sentry.js'
import { logAudit, getClientIp } from '../lib/audit.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('SettingsRoute')

export const settingsRoutes = new Hono<AuthEnv>()

// All settings routes require admin
settingsRoutes.use('*', authMiddleware)
settingsRoutes.use('*', adminMiddleware)

// GET /api/admin/settings — return all settings grouped with metadata
settingsRoutes.get('/', async (c) => {
  try {
    const groups = await getAllSettings()
    return c.json({ ok: true, data: groups })
  } catch (err) {
    log.error(`Failed to load settings: ${(err as Error).message}`)
    return c.json({ ok: false, error: 'Failed to load settings' }, 500)
  }
})

// PUT /api/admin/settings — batch update settings
settingsRoutes.put('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ changes: Record<string, string> }>()

  if (!body.changes || typeof body.changes !== 'object') {
    return c.json({ ok: false, error: 'Missing "changes" object' }, 400)
  }

  const errors: string[] = []
  const updated: string[] = []

  for (const [key, value] of Object.entries(body.changes)) {
    const def = getSettingDefinition(key)
    if (!def) {
      errors.push(`Unknown setting: ${key}`)
      continue
    }

    const result = await setSetting(key, String(value), userId)
    if (result.ok) {
      updated.push(key)
    } else {
      errors.push(result.error ?? `Failed to update ${key}`)
    }
  }

  // Audit log
  if (updated.length > 0) {
    logAudit({
      userId,
      action: 'setting_update',
      targetType: 'user',
      metadata: { keys: updated },
      ipAddress: getClientIp(c),
    })
  }

  // Trigger side effects for specific settings
  if (updated.includes('sentry.dsn')) {
    try {
      const { getSetting } = await import('../lib/settings.js')
      const dsn = await getSetting('sentry.dsn')
      await reinitSentry(dsn)
    } catch (err) {
      log.warn(`Failed to reinit Sentry: ${(err as Error).message}`)
    }
  }

  // Reinitialize Web Push when VAPID settings change
  if (updated.some((k) => k.startsWith('push.vapid'))) {
    try {
      const { initWebPush } = await import('../lib/webPush.js')
      await initWebPush()
    } catch (err) {
      log.warn(`Failed to reinit Web Push: ${(err as Error).message}`)
    }
  }

  if (errors.length > 0) {
    return c.json({ ok: false, error: errors.join('; '), data: { updated } }, 400)
  }

  return c.json({ ok: true, data: { updated } })
})
