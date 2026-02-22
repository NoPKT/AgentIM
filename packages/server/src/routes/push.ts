import { Hono } from 'hono'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import {
  isWebPushEnabled,
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
} from '../lib/webPush.js'

export const pushRoutes = new Hono<AuthEnv>()

// Public: return VAPID public key so clients can subscribe
pushRoutes.get('/vapid-key', async (c) => {
  if (!isWebPushEnabled()) {
    return c.json({ ok: false, error: 'Web Push is not configured' }, 404)
  }
  const publicKey = await getVapidPublicKey()
  return c.json({ ok: true, data: { publicKey } })
})

// Authenticated: save push subscription
pushRoutes.post('/subscribe', authMiddleware, async (c) => {
  if (!isWebPushEnabled()) {
    return c.json({ ok: false, error: 'Web Push is not configured' }, 404)
  }
  const userId = c.get('userId')
  const body = await c.req.json<{
    endpoint: string
    keys: { p256dh: string; auth: string }
  }>()

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ ok: false, error: 'Invalid subscription data' }, 400)
  }

  await saveSubscription(userId, body)
  return c.json({ ok: true })
})

// Authenticated: remove push subscription
pushRoutes.post('/unsubscribe', authMiddleware, async (c) => {
  const body = await c.req.json<{ endpoint: string }>()
  if (!body.endpoint) {
    return c.json({ ok: false, error: 'Missing endpoint' }, 400)
  }
  await removeSubscription(body.endpoint)
  return c.json({ ok: true })
})
