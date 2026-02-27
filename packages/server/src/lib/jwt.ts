import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'
import { nanoid } from 'nanoid'
import { config, getConfigSync } from '../config.js'

/**
 * Compute a short key ID from a secret (first 8 hex chars of SHA-256).
 * Used as the `kid` header to help identify which key signed a token.
 */
async function computeKid(secret: Uint8Array): Promise<string> {
  const buf = new Uint8Array(secret).buffer as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

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

let _cachedKid: string | null = null
async function getKid(): Promise<string> {
  if (!_cachedKid) {
    _cachedKid = await computeKid(getSecret())
  }
  return _cachedKid
}

/** Previous secret for key rotation (null when not configured). */
let _cachedPreviousSecret: Uint8Array | null | undefined = undefined
function getPreviousSecret(): Uint8Array | null {
  if (_cachedPreviousSecret === undefined) {
    _cachedPreviousSecret = config.jwtSecretPrevious
      ? new TextEncoder().encode(config.jwtSecretPrevious)
      : null
  }
  return _cachedPreviousSecret
}

export async function signAccessToken(payload: { sub: string; username: string }): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256', kid: await getKid() })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setJti(nanoid())
    .setExpirationTime(getConfigSync<string>('jwt.accessExpiry') ?? config.jwtAccessExpiry)
    .setIssuedAt()
    .sign(getSecret())
}

export async function signRefreshToken(payload: {
  sub: string
  username: string
}): Promise<string> {
  return new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256', kid: await getKid() })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setJti(nanoid())
    .setExpirationTime(getConfigSync<string>('jwt.refreshExpiry') ?? config.jwtRefreshExpiry)
    .setIssuedAt()
    .sign(getSecret())
}

/**
 * Sign a short-lived TOTP challenge token (5 minute expiry).
 * Issued after password verification when 2FA is enabled,
 * to be exchanged (with a valid TOTP code) for real tokens.
 */
export async function signTotpChallengeToken(payload: {
  sub: string
  username: string
}): Promise<string> {
  return new SignJWT({ ...payload, type: 'totp_challenge' as string })
    .setProtectedHeader({ alg: 'HS256', kid: await getKid() })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setJti(nanoid())
    .setExpirationTime('5m')
    .setIssuedAt()
    .sign(getSecret())
}

type TokenPayload = {
  sub: string
  username: string
  type: 'access' | 'refresh' | 'totp_challenge'
  iat?: number
}

/** Validate that the JWT payload has the expected shape. */
function validatePayload(payload: Record<string, unknown>): payload is TokenPayload {
  return (
    typeof payload.sub === 'string' &&
    typeof payload.username === 'string' &&
    (payload.type === 'access' || payload.type === 'refresh' || payload.type === 'totp_challenge')
  )
}

const jwtVerifyOpts = { issuer: 'agentim', audience: 'agentim' }

export async function verifyToken(token: string): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), jwtVerifyOpts)
    if (!validatePayload(payload as Record<string, unknown>)) {
      throw new Error('Invalid token payload')
    }
    return payload as unknown as TokenPayload
  } catch (err) {
    // On signature verification failure, try the previous secret for key rotation
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      const prevSecret = getPreviousSecret()
      if (prevSecret) {
        const { payload } = await jwtVerify(token, prevSecret, jwtVerifyOpts)
        if (!validatePayload(payload as Record<string, unknown>)) {
          throw new Error('Invalid token payload')
        }
        return payload as unknown as TokenPayload
      }
    }
    throw err
  }
}
