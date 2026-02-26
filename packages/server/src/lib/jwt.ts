import { SignJWT, jwtVerify } from 'jose'
import { nanoid } from 'nanoid'
import { config, getConfigSync } from '../config.js'

const secret = new TextEncoder().encode(config.jwtSecret)

export async function signAccessToken(payload: { sub: string; username: string }): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setJti(nanoid())
    .setExpirationTime(getConfigSync<string>('jwt.accessExpiry') || config.jwtAccessExpiry)
    .setIssuedAt()
    .sign(secret)
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
    .sign(secret)
}

export async function verifyToken(
  token: string,
): Promise<{ sub: string; username: string; type: 'access' | 'refresh'; iat?: number }> {
  const { payload } = await jwtVerify(token, secret, {
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
