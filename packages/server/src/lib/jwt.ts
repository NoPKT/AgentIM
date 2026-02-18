import { SignJWT, jwtVerify } from 'jose'
import { config } from '../config.js'

const secret = new TextEncoder().encode(config.jwtSecret)

function parseExpiry(expiry: string): string {
  return expiry
}

export async function signAccessToken(payload: { sub: string; username: string }): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('agentim')
    .setAudience('agentim')
    .setExpirationTime(parseExpiry(config.jwtAccessExpiry))
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
    .setExpirationTime(parseExpiry(config.jwtRefreshExpiry))
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
  return payload as { sub: string; username: string; type: 'access' | 'refresh'; iat?: number }
}
