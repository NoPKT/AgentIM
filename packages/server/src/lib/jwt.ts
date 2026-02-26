import { SignJWT, jwtVerify } from 'jose'
import { nanoid } from 'nanoid'
import { config, getConfigSync } from '../config.js'

/**
 * Lazily derive the signing key from config.jwtSecret.
 * The secret is cached after the first call so there is no per-request overhead,
 * but reading it lazily (instead of at module-evaluation time) means a process
 * restart is sufficient to pick up a rotated JWT_SECRET.
 */
let _cachedSecret: Uint8Array | null = null
function getSecret(): Uint8Array {
  if (!_cachedSecret) {
    _cachedSecret = new TextEncoder().encode(config.jwtSecret)
  }
  return _cachedSecret
}

export async function signAccessToken(payload: { sub: string; username: string }): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setJti(nanoid())
    .setExpirationTime(getConfigSync<string>('jwt.accessExpiry') || config.jwtAccessExpiry)
    .setIssuedAt()
    .sign(getSecret())
}

export async function signRefreshToken(payload: {
  sub: string
  username: string
}): Promise<string> {
  return new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setJti(nanoid())
    .setExpirationTime(getConfigSync<string>('jwt.refreshExpiry') || config.jwtRefreshExpiry)
    .setIssuedAt()
    .sign(getSecret())
}

export async function verifyToken(
  token: string,
): Promise<{ sub: string; username: string; type: 'access' | 'refresh'; iat?: number }> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: 'agentim',
    audience: 'agentim',
  })
  // Runtime validation: ensure required fields are present and correctly typed
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.username !== 'string' ||
    (payload.type !== 'access' && payload.type !== 'refresh')
  ) {
    throw new Error('Invalid token payload')
  }
  return payload as { sub: string; username: string; type: 'access' | 'refresh'; iat?: number }
}
