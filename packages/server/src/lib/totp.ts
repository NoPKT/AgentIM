import { TOTP, Secret } from 'otpauth'
import { hash, verify } from 'argon2'
import { getConfigSync } from '../config.js'
import { randomBytes } from 'node:crypto'

/** Generate a random base32-encoded TOTP secret. */
export function generateTotpSecret(): string {
  const secret = new Secret({ size: 20 })
  return secret.base32
}

/** Build an otpauth:// URI for QR code generation. */
export function getTotpUri(secret: string, username: string): string {
  const totp = new TOTP({
    issuer: getConfigSync<string>('totp.issuer') || 'AgentIM',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  })
  return totp.toString()
}

/** Verify a 6-digit TOTP code (window=1 to tolerate ±30s clock drift). */
export function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new TOTP({
    issuer: getConfigSync<string>('totp.issuer') || 'AgentIM',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  })
  const delta = totp.validate({ token: code, window: 1 })
  return delta !== null
}

/** Generate 10 random backup codes and their argon2 hashes. */
export async function generateBackupCodes(): Promise<{
  plainCodes: string[]
  hashedCodes: string[]
}> {
  const plainCodes: string[] = []
  const hashedCodes: string[] = []

  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString('hex') // 8-char hex code
    plainCodes.push(code)
    hashedCodes.push(await hash(code))
  }

  return { plainCodes, hashedCodes }
}

/** Verify a backup code against a list of hashed codes. Returns remaining codes. */
export async function verifyBackupCode(
  code: string,
  hashedCodes: string[],
): Promise<{ valid: boolean; remainingCodes: string[] }> {
  for (let i = 0; i < hashedCodes.length; i++) {
    const match = await verify(hashedCodes[i], code).catch(() => false)
    if (match) {
      const remainingCodes = [...hashedCodes.slice(0, i), ...hashedCodes.slice(i + 1)]
      return { valid: true, remainingCodes }
    }
  }
  return { valid: false, remainingCodes: hashedCodes }
}
