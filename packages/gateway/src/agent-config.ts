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
/**
 * Read OAuth access_token from a CLI tool's auth file.
 * Returns undefined if the file does not exist or is unreadable.
 */
function readOAuthToken(authFilePath: string): string | undefined {
  try {
    const auth = JSON.parse(readFileSync(authFilePath, 'utf-8')) as {
      access_token?: string
    }
    return auth.access_token || undefined
  } catch {
    return undefined
  }
}

/**
 * Convert agent auth config to environment variables for the adapter.
 * Both API-key and subscription (OAuth) credentials are resolved here so
 * that adapters receive a ready-to-use token without needing to know the
 * auth mode.
 */
export function agentConfigToEnv(
  agentType: string,
  config: AgentAuthConfig,
): Record<string, string> {
  const env: Record<string, string> = {}

  switch (agentType) {
    case 'claude-code':
      // Claude Code SDK handles OAuth internally — only API-key mode needs env
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
      if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl
      if (config.model) env.ANTHROPIC_MODEL = config.model
      break
    case 'codex':
      if (config.mode === 'api' && config.apiKey) {
        env.OPENAI_API_KEY = config.apiKey
        env.CODEX_API_KEY = config.apiKey
      } else if (config.mode === 'subscription') {
        // Read the OAuth token that `codex login` stored
        const token = readOAuthToken(join(homedir(), '.codex', 'auth.json'))
        if (token) env.CODEX_API_KEY = token
      }
      if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl
      if (config.model) env.CODEX_MODEL = config.model
      break
    case 'gemini':
      // Gemini CLI SDK handles OAuth internally — only API-key mode needs env
      if (config.apiKey) env.GEMINI_API_KEY = config.apiKey
      if (config.baseUrl) env.GEMINI_BASE_URL = config.baseUrl
      if (config.model) env.GEMINI_MODEL = config.model
      break
  }

  return env
}
