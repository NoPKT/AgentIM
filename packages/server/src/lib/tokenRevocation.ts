import { createHmac } from 'node:crypto'
import { getRedis, isRedisEnabled } from './redis.js'
import Redis from 'ioredis'
import { eq, lt, desc } from 'drizzle-orm'
import { createLogger } from './logger.js'
import { config, getConfigSync } from '../config.js'
import { db } from '../db/index.js'
import { revokedTokens } from '../db/schema.js'

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

/** Read at call time so admin UI changes take effect without restart */
function getAccessTokenTTL(): number {
  return parseDurationToSeconds(getConfigSync<string>('jwt.accessExpiry') || config.jwtAccessExpiry)
}
const MAX_MEMORY_REVOCATIONS = 10_000
const MEMORY_REVOCATION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const DB_CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

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

// Periodically clean up expired rows from the DB revoked_tokens table
const dbCleanupTimer = setInterval(async () => {
  if (isRedisEnabled()) return
  try {
    const now = new Date()
    await db.delete(revokedTokens).where(lt(revokedTokens.expiresAt, now))
  } catch (err) {
    log.warn(`Failed to clean expired revoked tokens from DB: ${(err as Error).message}`)
  }
}, DB_CLEANUP_INTERVAL_MS)
dbCleanupTimer.unref()

/**
 * Persist a token revocation to the database (fallback when Redis is unavailable).
 */
async function persistRevocationToDb(userId: string, revokedAtMs: number): Promise<void> {
  try {
    const expiresAt = new Date(revokedAtMs + getAccessTokenTTL() * 1000)
    await db.insert(revokedTokens).values({
      userId,
      tokenHash: String(revokedAtMs),
      revokedAt: new Date(revokedAtMs),
      expiresAt,
    })
  } catch (err) {
    log.error(
      `Failed to persist token revocation to DB for user ${userId}: ${(err as Error).message}`,
    )
  }
}

/**
 * Check the database for token revocations (fallback when Redis is unavailable).
 * Returns the most recent revokedAt timestamp for the user, or null if none found.
 */
async function checkRevocationInDb(userId: string): Promise<number | null> {
  try {
    const rows = await db
      .select({ revokedAt: revokedTokens.revokedAt })
      .from(revokedTokens)
      .where(eq(revokedTokens.userId, userId))
      .orderBy(desc(revokedTokens.revokedAt))
      .limit(1)
    if (rows.length === 0) return null
    return new Date(rows[0].revokedAt).getTime()
  } catch (err) {
    log.warn(`Failed to check token revocation in DB for user ${userId}: ${(err as Error).message}`)
    return null
  }
}

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
    await persistRevocationToDb(userId, Date.now())
    log.info(
      `Token revocation for user ${userId} stored in memory + database (Redis not configured).`,
    )
    return
  }

  try {
    const redis = getRedis()
    const key = `revoked:${userId}`
    const now = String(Date.now())
    await redis.set(key, now, 'EX', getAccessTokenTTL())
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

  if (!isRedisEnabled()) {
    const dbRevokedAt = await checkRevocationInDb(userId)
    if (dbRevokedAt !== null) {
      memoryRevocations.set(userId, dbRevokedAt)
      return iatMs < dbRevokedAt
    }
    return false
  }

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
    //
    // Security note: this is an intentional trade-off for availability.
    // In production multi-process deployments, ensure Redis is highly available
    // (e.g. Redis Sentinel or managed Redis) to minimize this window.
    log.error(
      'SECURITY: Redis unavailable for token revocation check — in-memory layer passed, ' +
        'allowing request (fail-open). Cross-process revocations may be missed. ' +
        'Ensure Redis is highly available in production to prevent revoked tokens from being accepted.',
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
  clearInterval(dbCleanupTimer)
  if (subscriber) {
    await subscriber.quit()
    subscriber = null
  }
}
