import webPush from 'web-push'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { pushSubscriptions } from '../db/schema.js'
import { getSetting } from './settings.js'
import { createLogger } from './logger.js'

const log = createLogger('WebPush')

let initialized = false

/**
 * Initialize (or reinitialize) Web Push from DB-backed settings.
 * Called at startup and whenever VAPID settings change in the admin panel.
 */
export async function initWebPush() {
  const publicKey = await getSetting('push.vapidPublicKey')
  const privateKey = await getSetting('push.vapidPrivateKey')

  if (!publicKey || !privateKey) {
    initialized = false
    log.info('VAPID keys not configured — Web Push disabled')
    return
  }

  const subject = (await getSetting('push.vapidSubject')) || 'mailto:noreply@agentim.app'

  try {
    webPush.setVapidDetails(subject, publicKey, privateKey)
    initialized = true
    log.info('Web Push initialized with VAPID keys')
  } catch (err) {
    initialized = false
    log.warn(`Failed to initialize Web Push: ${(err as Error).message}`)
  }
}

export function isWebPushEnabled(): boolean {
  return initialized
}

export async function getVapidPublicKey(): Promise<string> {
  return getSetting('push.vapidPublicKey')
}

export async function saveSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  const id = nanoid()
  const now = new Date().toISOString()
  await db
    .insert(pushSubscriptions)
    .values({
      id,
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        createdAt: now,
      },
    })
}

export async function removeSubscription(endpoint: string, userId?: string) {
  if (userId) {
    // Scoped delete: only remove if the subscription belongs to this user
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
  } else {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
  }
}

export async function sendPushToUser(userId: string, payload: Record<string, unknown>) {
  if (!initialized) return

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  if (subs.length === 0) return

  const payloadStr = JSON.stringify(payload)

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }
      try {
        await webPush.sendNotification(subscription, payloadStr)
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id))
            .catch((deleteErr) => {
              log.warn(
                `Failed to delete expired push subscription: ${(deleteErr as Error).message}`,
              )
            })
          log.debug(`Removed expired push subscription for user ${userId}`)
          return
        }
        // Retry once after 500ms for transient failures
        await new Promise((resolve) => setTimeout(resolve, 500))
        try {
          await webPush.sendNotification(subscription, payloadStr)
        } catch (retryErr: unknown) {
          const retryStatus = (retryErr as { statusCode?: number }).statusCode
          if (retryStatus === 404 || retryStatus === 410) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, sub.id))
              .catch((deleteErr) => {
                log.warn(
                  `Failed to delete expired push subscription: ${(deleteErr as Error).message}`,
                )
              })
            log.debug(`Removed expired push subscription for user ${userId}`)
          } else {
            log.warn(
              `Failed to send push to user ${userId} after retry: ${(retryErr as Error).message}`,
            )
          }
        }
      }
    }),
  )

  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length > 0) {
    log.warn(`${failed.length}/${subs.length} push notification(s) failed for user ${userId}`)
  }
}
