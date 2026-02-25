import { homedir, hostname, userInfo } from 'node:os'
import { createHash, createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'

// Application-specific fixed salt for PBKDF2 key derivation.
// This is NOT a secret; it prevents rainbow-table attacks and ensures
// AgentIM key derivation is domain-separated from other applications
// that might hash the same machine identifiers.
const PBKDF2_SALT = Buffer.from('AgentIM-machine-key-v1-2024', 'utf8')

// OWASP recommends >= 600,000 for PBKDF2-SHA256 as of 2023.
// We use 600,000 to meet the OWASP minimum recommendation. This runs
// once per encrypt/decrypt call on a CLI tool (startup and save), so
// the ~200ms overhead is acceptable for security compliance.
const PBKDF2_ITERATIONS = 600_000

// Module-level cache for the expensive PBKDF2 key derivation.
let _cachedMachineKey: Buffer | null = null

/**
 * Derive a machine-scoped 256-bit key using PBKDF2 from stable host identifiers.
 * This key is NOT secret but binds the stored tokens to this specific machine/user.
 *
 * Uses PBKDF2 with a fixed application-specific salt to make brute-force
 * enumeration of machine identifiers computationally expensive.
 *
 * The result is cached after the first call since the inputs (hostname, username,
 * homedir) are stable for the lifetime of a process.
 */
export function getMachineKey(): Buffer {
  if (_cachedMachineKey) return _cachedMachineKey
  const info = userInfo()
  const material = `${hostname()}:${info.username}:${homedir()}`
  _cachedMachineKey = pbkdf2Sync(material, PBKDF2_SALT, PBKDF2_ITERATIONS, 32, 'sha256')
  return _cachedMachineKey
}

/**
 * Derive the legacy machine key using plain SHA-256.
 * Used only for backward-compatible decryption of tokens encrypted
 * before the PBKDF2 migration.
 */
function getLegacyMachineKey(): Buffer {
  const info = userInfo()
  const material = `${hostname()}:${info.username}:${homedir()}`
  return createHash('sha256').update(material).digest()
}

/**
 * Encrypt a plaintext token with AES-256-GCM.
 * Output format: base64(iv[12] || authTag[16] || ciphertext)
 *
 * Always uses the PBKDF2-derived key for new encryptions.
 */
export function encryptToken(plaintext: string): string {
  const key = getMachineKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/**
 * Attempt AES-256-GCM decryption with the given key.
 * Returns the plaintext on success, or null if decryption fails.
 */
function tryDecrypt(encoded: Buffer, key: Buffer): string | null {
  try {
    const iv = encoded.subarray(0, 12)
    const tag = encoded.subarray(12, 28)
    const ciphertext = encoded.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return decipher.update(ciphertext) + decipher.final('utf8')
  } catch {
    return null
  }
}

/**
 * Decrypt a token encrypted by encryptToken.
 * Returns null if decryption fails (wrong machine key, corrupted data, etc.)
 *
 * For backward compatibility, if decryption with the current PBKDF2-derived
 * key fails, falls back to the legacy SHA-256 key. This allows existing
 * configs encrypted with the old key to still be read. They will be
 * re-encrypted with the new key on the next save cycle.
 */
export function decryptToken(encoded: string): string | null {
  try {
    const buf = Buffer.from(encoded, 'base64')
    if (buf.length < 28) return null // iv(12) + tag(16) minimum

    // Try PBKDF2-derived key first (current)
    const result = tryDecrypt(buf, getMachineKey())
    if (result !== null) return result

    // Fall back to legacy SHA-256 key for backward compatibility
    return tryDecrypt(buf, getLegacyMachineKey())
  } catch {
    return null
  }
}
