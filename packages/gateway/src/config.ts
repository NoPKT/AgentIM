import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface GatewayConfig {
  serverUrl: string
  token: string
  gatewayId: string
}

const CONFIG_DIR = join(homedir(), '.aim')
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
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

export function getConfigPath(): string {
  return CONFIG_FILE
}
