import { homedir, hostname, userInfo } from 'node:os'
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Derive a machine-scoped 256-bit key from stable host identifiers.
 * This key is NOT secret but binds the stored tokens to this specific machine/user.
 */
export function getMachineKey(): Buffer {
  const info = userInfo()
  const material = `${hostname()}:${info.username}:${homedir()}`
  return createHash('sha256').update(material).digest()
}

/**
 * Encrypt a plaintext token with AES-256-GCM.
 * Output format: base64(iv[12] || authTag[16] || ciphertext)
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
 * Decrypt a token encrypted by encryptToken.
 * Returns null if decryption fails (wrong machine key, corrupted data, etc.)
 */
export function decryptToken(encoded: string): string | null {
  try {
    const buf = Buffer.from(encoded, 'base64')
    if (buf.length < 28) return null // iv(12) + tag(16) minimum
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ciphertext = buf.subarray(28)
    const key = getMachineKey()
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return decipher.update(ciphertext) + decipher.final('utf8')
  } catch {
    return null
  }
}
