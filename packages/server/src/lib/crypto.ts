import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('Crypto')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function getEncryptionKey(): Buffer | null {
  const key = process.env.ENCRYPTION_KEY
  if (!key) return null
  // Accept base64-encoded 32-byte keys (original format, backward-compatible)
  const b64 = Buffer.from(key, 'base64')
  if (b64.length === 32) return b64
  // Accept any string by deriving a 32-byte AES key via SHA-256.
  // ENCRYPTION_KEY is designed to be a machine-generated high-entropy random
  // value (e.g. `openssl rand -base64 32`), not a user-supplied password.
  // SHA-256 is safe for length-normalising high-entropy keys — a KDF such as
  // PBKDF2 or scrypt is only needed when the input has low entropy (e.g. a
  // human-chosen passphrase). config.ts already enforces a minimum of 32
  // characters in production, which is sufficient for a random key but would
  // not be sufficient for a low-entropy password — do not use a passphrase here.
  return createHash('sha256').update(key).digest()
}

/**
 * Encrypt a plaintext string. Returns `enc:<iv>:<ciphertext>:<tag>` hex format.
 * If ENCRYPTION_KEY is not set, returns plaintext unchanged (dev-only; production
 * rejects startup without ENCRYPTION_KEY via config.ts validation).
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  if (!key) {
    log.warn(
      'ENCRYPTION_KEY not set — storing secret as plaintext. Set ENCRYPTION_KEY for production use.',
    )
    return plaintext
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`
}

/**
 * Decrypt a previously encrypted string. If the value doesn't start with `enc:`,
 * it's treated as plaintext (backwards compatible).
 * Returns null on failure so callers can distinguish success from decryption errors.
 */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith('enc:')) return stored

  const key = getEncryptionKey()
  if (!key) {
    log.warn('Encrypted value found but ENCRYPTION_KEY not set. Cannot decrypt.')
    return null
  }

  try {
    const parts = stored.slice(4).split(':')
    if (parts.length !== 3) return null

    const iv = Buffer.from(parts[0], 'hex')
    const encrypted = Buffer.from(parts[1], 'hex')
    const tag = Buffer.from(parts[2], 'hex')

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf8')
  } catch (err) {
    const prefix = stored.length > 20 ? stored.slice(0, 20) + '...' : stored
    log.warn(`Failed to decrypt secret (prefix="${prefix}"): ${(err as Error).message}`)
    return null
  }
}
