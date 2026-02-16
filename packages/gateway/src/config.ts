import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface GatewayConfig {
  serverUrl: string
  serverBaseUrl: string
  token: string
  refreshToken: string
  gatewayId: string
}

const CONFIG_DIR = join(homedir(), '.agentim')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export function loadConfig(): GatewayConfig | null {
  if (!existsSync(CONFIG_FILE)) return null
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return null
  }
}

export function saveConfig(config: GatewayConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
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
