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

  if (!isRedisEnabled()) {
    log.warn(
      `Token revocation for user ${userId} stored in memory only (Redis not configured). ` +
        `Revocation will be lost on server restart, but tokens expire within ${config.jwtAccessExpiry}.`,
    )
    return
  }

  try {
    const redis = getRedis()
    const key = `revoked:${userId}`
    const now = String(Date.now())
    await redis.set(key, now, 'EX', ACCESS_TOKEN_TTL)
    // Broadcast to other processes so they update their in-memory maps
    await redis.publish(TOKEN_REVOCATION_CHANNEL, JSON.stringify({ userId, revokedAt: now }))
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
    subscriber.on('message', (_channel: string, message: string) => {
      try {
        const { userId, revokedAt } = JSON.parse(message) as {
          userId: string
          revokedAt: string
        }
        memoryRevocations.set(userId, Number(revokedAt))
      } catch (err) {
        log.warn(`Failed to parse token revocation message: ${(err as Error).message}`)
      }
    })
    log.info('Token revocation subscriber initialized')
  } catch (err) {
    log.warn(`Failed to init token revocation subscriber: ${(err as Error).message}`)
  }
}
