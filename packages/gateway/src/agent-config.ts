import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { encryptToken, decryptToken } from './lib/crypto.js'

export interface AgentAuthConfig {
  mode: 'subscription' | 'api'
  // API mode fields
  apiKey?: string // encrypted when stored on disk
  baseUrl?: string // plaintext (non-sensitive)
  model?: string // plaintext
}

interface StoredAgentConfig {
  mode: 'subscription' | 'api'
  apiKey?: string // encrypted base64
  baseUrl?: string
  model?: string
}

const AGENTS_DIR = join(homedir(), '.agentim', 'agents')

function configPath(agentType: string): string {
  return join(AGENTS_DIR, `${agentType}.json`)
}

export function loadAgentConfig(agentType: string): AgentAuthConfig | null {
  const path = configPath(agentType)
  if (!existsSync(path)) return null
  try {
    const stored = JSON.parse(readFileSync(path, 'utf-8')) as StoredAgentConfig
    const config: AgentAuthConfig = { mode: stored.mode }
    if (stored.apiKey) {
      const decrypted = decryptToken(stored.apiKey)
      if (!decrypted) return null // decryption failed (different machine?)
      config.apiKey = decrypted
    }
    if (stored.baseUrl) config.baseUrl = stored.baseUrl
    if (stored.model) config.model = stored.model
    return config
  } catch {
    return null
  }
}

export function saveAgentConfig(agentType: string, config: AgentAuthConfig): void {
  mkdirSync(AGENTS_DIR, { recursive: true, mode: 0o700 })
  const stored: StoredAgentConfig = { mode: config.mode }
  if (config.apiKey) {
    stored.apiKey = encryptToken(config.apiKey)
  }
  if (config.baseUrl) stored.baseUrl = config.baseUrl
  if (config.model) stored.model = config.model
  writeFileSync(configPath(agentType), JSON.stringify(stored, null, 2), { mode: 0o600 })
}

export function deleteAgentConfig(agentType: string): void {
  const path = configPath(agentType)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

/**
 * Convert agent auth config to environment variables for the adapter.
 */
export function agentConfigToEnv(
  agentType: string,
  config: AgentAuthConfig,
): Record<string, string> {
  if (config.mode === 'subscription') {
    // Subscription mode: no env needed (user already logged in via CLI)
    return {}
  }

  const env: Record<string, string> = {}

  switch (agentType) {
    case 'claude-code':
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
      if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl
      if (config.model) env.ANTHROPIC_MODEL = config.model
      break
    case 'codex':
      if (config.apiKey) {
        env.OPENAI_API_KEY = config.apiKey
        env.CODEX_API_KEY = config.apiKey
      }
      if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl
      if (config.model) env.CODEX_MODEL = config.model
      break
    case 'gemini':
      if (config.apiKey) env.GEMINI_API_KEY = config.apiKey
      break
  }

  return env
}
