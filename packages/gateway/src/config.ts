import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, hostname, userInfo } from 'node:os'
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface GatewayConfig {
  serverUrl: string
  serverBaseUrl: string
  token: string
  refreshToken: string
  gatewayId: string
}

const CONFIG_DIR = join(homedir(), '.agentim')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

// Config format version — v1 is plaintext, v2 uses AES-256-GCM encrypted tokens
const CONFIG_VERSION = 2

/**
 * Derive a machine-scoped 256-bit key from stable host identifiers.
 * This key is NOT secret but binds the stored tokens to this specific machine/user.
 */
function getMachineKey(): Buffer {
  const info = userInfo()
  const material = `${hostname()}:${info.username}:${homedir()}`
  return createHash('sha256').update(material).digest()
}

/**
 * Encrypt a plaintext token with AES-256-GCM.
 * Output format: base64(iv[12] || authTag[16] || ciphertext)
 */
function encryptToken(plaintext: string): string {
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
function decryptToken(encoded: string): string | null {
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

interface RawConfigV1 {
  serverUrl: string
  serverBaseUrl: string
  token: string
  refreshToken: string
  gatewayId: string
}

interface RawConfigV2 {
  version: 2
  serverUrl: string
  serverBaseUrl: string
  token: string // encrypted base64
  refreshToken: string // encrypted base64
  gatewayId: string
}

export function loadConfig(): GatewayConfig | null {
  if (!existsSync(CONFIG_FILE)) return null
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as RawConfigV1 | RawConfigV2

    if ('version' in raw && raw.version === 2) {
      // v2: tokens are AES-256-GCM encrypted
      const token = decryptToken(raw.token)
      const refreshToken = decryptToken(raw.refreshToken)
      if (!token || !refreshToken) return null
      return {
        serverUrl: raw.serverUrl,
        serverBaseUrl: raw.serverBaseUrl,
        token,
        refreshToken,
        gatewayId: raw.gatewayId,
      }
    }

    // v1: plaintext — migrate to v2 automatically
    const config: GatewayConfig = {
      serverUrl: raw.serverUrl,
      serverBaseUrl: raw.serverBaseUrl,
      token: raw.token,
      refreshToken: raw.refreshToken,
      gatewayId: raw.gatewayId,
    }
    saveConfig(config)
    return config
  } catch {
    return null
  }
}

export function saveConfig(config: GatewayConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  const v2: RawConfigV2 = {
    version: 2,
    serverUrl: config.serverUrl,
    serverBaseUrl: config.serverBaseUrl,
    token: encryptToken(config.token),
    refreshToken: encryptToken(config.refreshToken),
    gatewayId: config.gatewayId,
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(v2, null, 2), { mode: 0o600 })
}

export function getConfigPath(): string {
  return CONFIG_FILE
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE)
  }
}

/** Derive HTTP base URL from WebSocket URL */
export function wsUrlToHttpUrl(wsUrl: string): string {
  return wsUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/ws\/gateway\/?$/, '')
}
