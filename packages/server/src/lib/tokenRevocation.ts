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
 * This is consistent with isTokenRevoked() which also fails closed (returns
 * true) on Redis failure, ensuring symmetric fail-secure behavior.
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
    // If Redis is down, deny by default (fail-secure)
    return true
  }
}
