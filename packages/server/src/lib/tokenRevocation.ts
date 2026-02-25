import { createHmac } from 'node:crypto'
import { getRedis, isRedisEnabled } from './redis.js'
import Redis from 'ioredis'
import { createLogger } from './logger.js'
import { config } from '../config.js'

const log = createLogger('TokenRevocation')

const TOKEN_REVOCATION_CHANNEL = 'token-revocations'

/** Parse a duration string like '15m', '1h', '30s' to seconds (minimum 1) */
function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/^(\d+)\s*(s|m|h|d)$/i)
  if (!match) return 900 // default 15 minutes
  const value = parseInt(match[1], 10)
  let seconds: number
  switch (match[2].toLowerCase()) {
    case 's':
      seconds = value
      break
    case 'm':
      seconds = value * 60
      break
    case 'h':
      seconds = value * 3600
      break
    case 'd':
      seconds = value * 86400
      break
    default:
      seconds = 900
  }
  return seconds < 1 ? 900 : seconds
}

const ACCESS_TOKEN_TTL = parseDurationToSeconds(config.jwtAccessExpiry)
const MAX_MEMORY_REVOCATIONS = 10_000
const MEMORY_REVOCATION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Compute an HMAC-SHA256 signature over the message body using JWT_SECRET.
 * This prevents forged token-revocation pub/sub messages from an attacker
 * who gains Redis write access but not the application secret.
 */
function signMessage(body: string): string {
  return createHmac('sha256', config.jwtSecret).update(body).digest('hex')
}

function verifySignature(body: string, sig: string): boolean {
  const expected = signMessage(body)
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  return diff === 0
}

// In-memory revocation map: userId → revokedAtMs
// Serves as both a fast-path cache (checked before Redis) and a fallback when
// Redis is unavailable. Not persistent — revocations are lost on restart, but
// access tokens have a short TTL (default 15m) so the window is bounded.
//
// IMPORTANT: In multi-process deployments (cluster mode, multiple containers),
// each process maintains its own in-memory map. A revocation in one process
// will NOT propagate to others unless Redis is available. For production
// multi-process setups, Redis is strongly recommended.
const memoryRevocations = new Map<string, number>()

// Periodically clean up expired in-memory revocations
const memoryRevocationCleanupTimer = setInterval(
  () => {
    const now = Date.now()
    for (const [userId, revokedAt] of memoryRevocations) {
      if (now - revokedAt > MEMORY_REVOCATION_TTL_MS) {
        memoryRevocations.delete(userId)
      }
    }
  },
  60 * 60 * 1000,
) // Clean up every hour
memoryRevocationCleanupTimer.unref()

/**
 * Mark all access tokens issued before now as revoked for a user.
 * Called on logout or password change.
 *
 * Throws if Redis is unavailable (when configured) — callers must handle this
 * and return an appropriate error response rather than silently allowing stale tokens.
 *
 * When Redis is not configured, falls back to in-memory storage with a warning.
 */
export async function revokeUserTokens(userId: string): Promise<void> {
  // Always store in memory (dual-layer when Redis is available)
  memoryRevocations.set(userId, Date.now())
  // Enforce size limit: evict oldest entries if over capacity
  if (memoryRevocations.size > MAX_MEMORY_REVOCATIONS) {
    const entriesToRemove = memoryRevocations.size - MAX_MEMORY_REVOCATIONS
    let removed = 0
    for (const key of memoryRevocations.keys()) {
      if (removed >= entriesToRemove) break
      memoryRevocations.delete(key)
      removed++
    }
  }

  if (!isRedisEnabled()) {
    log.warn(
      `Token revocation for user ${userId} stored in memory only (Redis not configured). ` +
        `Revocation will be lost on server restart, but tokens expire within ${config.jwtAccessExpiry}. ` +
        `WARNING: In multi-process deployments, revocations will NOT propagate across processes. ` +
        `Enable Redis for production use.`,
    )
    return
  }

  try {
    const redis = getRedis()
    const key = `revoked:${userId}`
    const now = String(Date.now())
    await redis.set(key, now, 'EX', ACCESS_TOKEN_TTL)
    // Broadcast to other processes so they update their in-memory maps.
    // Messages are HMAC-signed to prevent forged revocations from Redis-level attacks.
    const body = JSON.stringify({ userId, revokedAt: now })
    const sig = signMessage(body)
    await redis.publish(TOKEN_REVOCATION_CHANNEL, JSON.stringify({ body, sig }))
  } catch (err) {
    log.error(`Failed to set token revocation for user ${userId}: ${(err as Error).message}`)
    throw err
  }
}

/**
 * Check if a token issued at `iatMs` has been revoked for the given user.
 * Returns true if revoked.
 */
export async function isTokenRevoked(userId: string, iatMs: number): Promise<boolean> {
  // Check in-memory first (always available, covers no-Redis case)
  const memoryRevokedAt = memoryRevocations.get(userId)
  if (memoryRevokedAt && iatMs < memoryRevokedAt) return true

  if (!isRedisEnabled()) return false

  try {
    const redis = getRedis()
    const key = `revoked:${userId}`
    const revokedAt = await redis.get(key)
    if (!revokedAt) return false
    return iatMs < Number(revokedAt)
  } catch {
    // If Redis is down, the in-memory layer (checked above) still catches
    // revocations made by THIS process. Only cross-process revocations are
    // missed. Fail-open here to prevent a Redis outage from locking out all
    // users; the short access token TTL bounds the exposure window.
    log.warn(
      'Redis unavailable for token revocation check — in-memory layer passed, ' +
        'allowing request (fail-open). Cross-process revocations may be missed.',
    )
    return false
  }
}

let subscriber: Redis | null = null

/**
 * Subscribe to token revocation events from other processes via Redis pub/sub.
 * Call once at server startup. No-op when Redis is not configured.
 */
export async function initTokenRevocationSubscriber(): Promise<void> {
  if (!isRedisEnabled()) return

  try {
    // Create a dedicated connection for subscribing (ioredis requirement)
    subscriber = getRedis().duplicate()
    await subscriber.subscribe(TOKEN_REVOCATION_CHANNEL)
    subscriber.on('message', (_channel: string, raw: string) => {
      try {
        const envelope = JSON.parse(raw) as { body?: string; sig?: string }

        // Support both signed (new) and unsigned (legacy) message formats
        if (envelope.body && envelope.sig) {
          if (!verifySignature(envelope.body, envelope.sig)) {
            log.warn('Rejected token revocation message with invalid HMAC signature')
            return
          }
          const { userId, revokedAt } = JSON.parse(envelope.body) as {
            userId: string
            revokedAt: string
          }
          memoryRevocations.set(userId, Number(revokedAt))
        } else {
          // Legacy unsigned format — accept but log warning
          const { userId, revokedAt } = envelope as unknown as {
            userId: string
            revokedAt: string
          }
          if (userId && revokedAt) {
            log.warn('Accepted unsigned token revocation message (legacy format)')
            memoryRevocations.set(userId, Number(revokedAt))
          }
        }
      } catch (err) {
        log.warn(`Failed to parse token revocation message: ${(err as Error).message}`)
      }
    })
    log.info('Token revocation subscriber initialized')
  } catch (err) {
    log.warn(`Failed to init token revocation subscriber: ${(err as Error).message}`)
  }
}

/** Clean up timers and subscriber connection. Call on graceful shutdown. */
export async function stopTokenRevocation(): Promise<void> {
  clearInterval(memoryRevocationCleanupTimer)
  if (subscriber) {
    await subscriber.quit()
    subscriber = null
  }
}
