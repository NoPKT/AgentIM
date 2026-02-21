import { getRedis } from './redis.js'
import { createLogger } from './logger.js'
import { config } from '../config.js'

const log = createLogger('TokenRevocation')

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

/**
 * Mark all access tokens issued before now as revoked for a user.
 * Called on logout or password change.
 *
 * Throws if Redis is unavailable — callers must handle this and return an
 * appropriate error response rather than silently allowing stale tokens.
 *
 * Note: this function and isTokenRevoked() are intentionally asymmetric:
 * - revokeUserTokens (write path): fail-closed — throws on Redis failure,
 *   ensuring logout/password-change always produces a visible error rather
 *   than silently succeeding with stale tokens still active.
 * - isTokenRevoked (read path): fail-open — returns false on Redis failure,
 *   preventing a Redis outage from DoS-ing all authenticated users.
 * This asymmetry is a deliberate security/availability trade-off: the worst
 * case of fail-open on reads is that a revoked token remains valid until it
 * expires naturally (bounded by JWT_ACCESS_EXPIRY), which is acceptable
 * compared to a complete service outage.
 */
export async function revokeUserTokens(userId: string): Promise<void> {
  try {
    const redis = getRedis()
    const key = `revoked:${userId}`
    await redis.set(key, String(Date.now()), 'EX', ACCESS_TOKEN_TTL)
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
  try {
    const redis = getRedis()
    const key = `revoked:${userId}`
    const revokedAt = await redis.get(key)
    if (!revokedAt) return false
    return iatMs < Number(revokedAt)
  } catch {
    // If Redis is down, allow by default but warn (fail-open to prevent DoS)
    log.warn('Redis unavailable for token revocation check, allowing request (fail-open)')
    return false
  }
}
