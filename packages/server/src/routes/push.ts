import { Hono } from 'hono'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { parseJsonBody } from '../lib/validation.js'
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
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const { endpoint, keys } = body as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return c.json({ ok: false, error: 'Invalid subscription data' }, 400)
  }

  await saveSubscription(userId, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } })
  return c.json({ ok: true })
})

// Authenticated: remove push subscription (scoped to current user)
pushRoutes.post('/unsubscribe', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const body = await parseJsonBody(c)
  if (body instanceof Response) return body
  const { endpoint } = body as { endpoint?: string }
  if (!endpoint) {
    return c.json({ ok: false, error: 'Missing endpoint' }, 400)
  }
  // Only allow removing subscriptions owned by the requesting user
  await removeSubscription(endpoint, userId)
  return c.json({ ok: true })
})
