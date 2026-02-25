import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { encryptToken, decryptToken } from './lib/crypto.js'

export interface GatewayConfig {
  serverUrl: string
  serverBaseUrl: string
  token: string
  refreshToken: string
  gatewayId: string
}

const CONFIG_DIR = join(homedir(), '.agentim')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

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
    // eslint-disable-next-line no-console -- startup migration notice
    console.info('Config migrated from v1 (plaintext) to v2 (encrypted)')
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
