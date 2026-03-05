import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { nanoid } from 'nanoid'
import { encryptToken, decryptToken } from './lib/crypto.js'

// ─── Public Types ───

export interface AgentAuthConfig {
  mode: 'subscription' | 'api'
  // API mode fields
  apiKey?: string // encrypted when stored on disk
  baseUrl?: string // plaintext (non-sensitive)
  model?: string // plaintext
  // Subscription mode: serialized JSON of CLI auth file content
  oauthData?: string
}

/** A single named credential */
export interface CredentialEntry {
  id: string // nanoid, immutable
  name: string // display name ("work-api", "john@gmail.com")
  mode: 'subscription' | 'api'
  apiKey?: string // decrypted in-memory, encrypted on disk
  baseUrl?: string
  model?: string
  oauthData?: string // subscription mode: serialized JSON of CLI auth file (decrypted in-memory)
  isDefault?: boolean // at most one per agent type
  createdAt: string // ISO timestamp
}

/** Credential metadata safe to expose over the network (no secrets) */
export interface CredentialInfo {
  id: string
  name: string
  mode: 'subscription' | 'api'
  hasApiKey: boolean
  hasOAuthData: boolean
  baseUrl?: string
  model?: string
  isDefault: boolean
  createdAt: string
}

// ─── Internal Types ───

/** On-disk entry with apiKey encrypted */
interface StoredCredentialEntry {
  id: string
  name: string
  mode: 'subscription' | 'api'
  apiKey?: string // encrypted base64
  oauthData?: string // encrypted base64
  baseUrl?: string
  model?: string
  isDefault?: boolean
  createdAt: string
}

/** On-disk file format (v2) */
interface CredentialStoreFile {
  version: 2
  credentials: StoredCredentialEntry[]
}

/** Legacy on-disk format (v1 — no version field) */
interface LegacyStoredConfig {
  mode: 'subscription' | 'api'
  apiKey?: string // encrypted base64
  baseUrl?: string
  model?: string
}

// ─── Constants ───

const AGENTS_DIR = join(homedir(), '.agentim', 'agents')

function configPath(agentType: string): string {
  return join(AGENTS_DIR, `${agentType}.json`)
}

// ─── Credential Store CRUD ───

/**
 * Load the credential store file for an agent type.
 * Handles v1→v2 lazy migration transparently.
 */
function loadCredentialStore(agentType: string): CredentialStoreFile {
  const path = configPath(agentType)
  if (!existsSync(path)) {
    return { version: 2, credentials: [] }
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))

    // v2 format — has version field
    if (raw.version === 2 && Array.isArray(raw.credentials)) {
      return raw as CredentialStoreFile
    }

    // v1 legacy format — single credential, no version field
    const legacy = raw as LegacyStoredConfig
    const entry: StoredCredentialEntry = {
      id: nanoid(),
      name: 'default',
      mode: legacy.mode,
      isDefault: true,
      createdAt: new Date().toISOString(),
    }
    if (legacy.apiKey) entry.apiKey = legacy.apiKey
    if (legacy.baseUrl) entry.baseUrl = legacy.baseUrl
    if (legacy.model) entry.model = legacy.model

    const store: CredentialStoreFile = { version: 2, credentials: [entry] }
    // Persist the migration
    saveCredentialStore(agentType, store)
    return store
  } catch {
    return { version: 2, credentials: [] }
  }
}

/** Write the credential store to disk atomically. */
function saveCredentialStore(agentType: string, store: CredentialStoreFile): void {
  mkdirSync(AGENTS_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(configPath(agentType), JSON.stringify(store, null, 2), { mode: 0o600 })
}

/** Decrypt a stored credential entry to an in-memory CredentialEntry. */
function decryptEntry(stored: StoredCredentialEntry): CredentialEntry | null {
  const entry: CredentialEntry = {
    id: stored.id,
    name: stored.name,
    mode: stored.mode,
    isDefault: stored.isDefault,
    createdAt: stored.createdAt,
  }
  if (stored.apiKey) {
    const decrypted = decryptToken(stored.apiKey)
    if (!decrypted) return null // decryption failed (different machine?)
    entry.apiKey = decrypted
  }
  if (stored.oauthData) {
    const decrypted = decryptToken(stored.oauthData)
    if (!decrypted) return null
    entry.oauthData = decrypted
  }
  if (stored.baseUrl) entry.baseUrl = stored.baseUrl
  if (stored.model) entry.model = stored.model
  return entry
}

/** Encrypt a credential entry for disk storage. */
function encryptEntry(entry: CredentialEntry): StoredCredentialEntry {
  const stored: StoredCredentialEntry = {
    id: entry.id,
    name: entry.name,
    mode: entry.mode,
    createdAt: entry.createdAt,
  }
  if (entry.apiKey) stored.apiKey = encryptToken(entry.apiKey)
  if (entry.oauthData) stored.oauthData = encryptToken(entry.oauthData)
  if (entry.baseUrl) stored.baseUrl = entry.baseUrl
  if (entry.model) stored.model = entry.model
  if (entry.isDefault) stored.isDefault = true
  return stored
}

/** List all credentials for an agent type (decrypted). */
export function listCredentials(agentType: string): CredentialEntry[] {
  const store = loadCredentialStore(agentType)
  const results: CredentialEntry[] = []
  for (const stored of store.credentials) {
    const entry = decryptEntry(stored)
    if (entry) results.push(entry)
  }
  return results
}

/** List credential metadata (no secrets) for an agent type. */
export function listCredentialInfo(agentType: string): CredentialInfo[] {
  const store = loadCredentialStore(agentType)
  return store.credentials.map((s) => ({
    id: s.id,
    name: s.name,
    mode: s.mode,
    hasApiKey: !!s.apiKey,
    hasOAuthData: !!s.oauthData,
    baseUrl: s.baseUrl,
    model: s.model,
    isDefault: !!s.isDefault,
    createdAt: s.createdAt,
  }))
}

/** Get a single credential by ID (decrypted). */
export function getCredential(agentType: string, id: string): CredentialEntry | null {
  const store = loadCredentialStore(agentType)
  const stored = store.credentials.find((c) => c.id === id)
  if (!stored) return null
  return decryptEntry(stored)
}

/** Add a new credential. Generates id and createdAt. Returns the created entry. */
export function addCredential(
  agentType: string,
  entry: Omit<CredentialEntry, 'id' | 'createdAt'>,
): CredentialEntry {
  const store = loadCredentialStore(agentType)
  const newEntry: CredentialEntry = {
    ...entry,
    id: nanoid(),
    createdAt: new Date().toISOString(),
  }

  // If this is the first credential or marked as default, ensure uniqueness
  if (store.credentials.length === 0) {
    newEntry.isDefault = true
  } else if (newEntry.isDefault) {
    for (const c of store.credentials) {
      c.isDefault = undefined
    }
  }

  store.credentials.push(encryptEntry(newEntry))
  saveCredentialStore(agentType, store)
  return newEntry
}

/** Update an existing credential. Returns true if found and updated. */
export function updateCredential(
  agentType: string,
  id: string,
  patch: Partial<Pick<CredentialEntry, 'name' | 'apiKey' | 'baseUrl' | 'model' | 'oauthData'>>,
): boolean {
  const store = loadCredentialStore(agentType)
  const idx = store.credentials.findIndex((c) => c.id === id)
  if (idx === -1) return false

  const existing = store.credentials[idx]
  if (patch.name !== undefined) existing.name = patch.name
  if (patch.apiKey !== undefined) existing.apiKey = encryptToken(patch.apiKey)
  if (patch.oauthData !== undefined)
    existing.oauthData = patch.oauthData ? encryptToken(patch.oauthData) : undefined
  if (patch.baseUrl !== undefined) existing.baseUrl = patch.baseUrl || undefined
  if (patch.model !== undefined) existing.model = patch.model || undefined

  saveCredentialStore(agentType, store)
  return true
}

/** Remove a credential by ID. Returns true if found and removed. */
export function removeCredential(agentType: string, id: string): boolean {
  const store = loadCredentialStore(agentType)
  const idx = store.credentials.findIndex((c) => c.id === id)
  if (idx === -1) return false

  const wasDefault = store.credentials[idx].isDefault
  store.credentials.splice(idx, 1)

  // If we removed the default and there are remaining credentials, promote the first one
  if (wasDefault && store.credentials.length > 0) {
    store.credentials[0].isDefault = true
  }

  saveCredentialStore(agentType, store)
  return true
}

/** Get the default credential (decrypted). */
export function getDefaultCredential(agentType: string): CredentialEntry | null {
  const store = loadCredentialStore(agentType)
  const stored = store.credentials.find((c) => c.isDefault)
  if (!stored) return null
  return decryptEntry(stored)
}

/** Set a credential as default. Returns true if found. */
export function setDefaultCredential(agentType: string, id: string): boolean {
  const store = loadCredentialStore(agentType)
  const target = store.credentials.find((c) => c.id === id)
  if (!target) return false

  // Clear existing default
  for (const c of store.credentials) {
    c.isDefault = undefined
  }
  target.isDefault = true

  saveCredentialStore(agentType, store)
  return true
}

/**
 * Resolve which credential to use for an agent type.
 * - credentialId provided → return that credential
 * - 1 credential → return it
 * - Multiple + has default → return default
 * - Otherwise → return null (caller must prompt)
 */
export function resolveCredential(
  agentType: string,
  credentialId?: string,
): CredentialEntry | null {
  if (credentialId) {
    return getCredential(agentType, credentialId)
  }

  const creds = listCredentials(agentType)
  if (creds.length === 0) return null
  if (creds.length === 1) return creds[0]

  // Multiple credentials — check for default
  const defaultCred = creds.find((c) => c.isDefault)
  return defaultCred ?? null
}

/**
 * Find a credential by name (case-insensitive) or by id prefix.
 * Used for the --credential CLI flag.
 */
export function findCredentialByNameOrId(agentType: string, query: string): CredentialEntry | null {
  const creds = listCredentials(agentType)
  const lower = query.toLowerCase()

  // Exact name match (case-insensitive)
  const byName = creds.find((c) => c.name.toLowerCase() === lower)
  if (byName) return byName

  // ID prefix match
  const byId = creds.filter((c) => c.id.startsWith(query))
  if (byId.length === 1) return byId[0]

  return null
}

// ─── Backward-Compatible Wrappers ───

/**
 * Load the default credential as an AgentAuthConfig.
 * Backward-compatible wrapper for code that still uses the old API.
 */
export function loadAgentConfig(agentType: string): AgentAuthConfig | null {
  const cred = resolveCredential(agentType)
  if (!cred) return null
  return credentialToAuthConfig(cred)
}

/**
 * Save a single credential as AgentAuthConfig (for backward compatibility).
 * Creates or updates the default credential.
 */
export function saveAgentConfig(agentType: string, config: AgentAuthConfig): void {
  const store = loadCredentialStore(agentType)
  const existingDefault = store.credentials.find((c) => c.isDefault)

  if (existingDefault) {
    // Update existing default credential
    existingDefault.mode = config.mode
    existingDefault.apiKey = config.apiKey ? encryptToken(config.apiKey) : undefined
    existingDefault.baseUrl = config.baseUrl
    existingDefault.model = config.model
    saveCredentialStore(agentType, store)
  } else {
    // Create a new default credential
    addCredential(agentType, {
      name: 'default',
      mode: config.mode,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      isDefault: true,
    })
  }
}

export function deleteAgentConfig(agentType: string): void {
  const path = configPath(agentType)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

// ─── Helpers ───

/** Convert a CredentialEntry to an AgentAuthConfig. */
export function credentialToAuthConfig(cred: CredentialEntry): AgentAuthConfig {
  return {
    mode: cred.mode,
    apiKey: cred.apiKey,
    baseUrl: cred.baseUrl,
    model: cred.model,
    oauthData: cred.oauthData,
  }
}

// ─── Subscription Home Isolation ───

const SUBSCRIPTION_HOMES_DIR = join(homedir(), '.agentim', 'subscription-homes')

/** Auth file paths relative to home for each agent type. */
const AUTH_FILE_PATHS: Record<string, string[]> = {
  codex: [join('.codex', 'auth.json')],
  'claude-code': ['.claude.json'],
  gemini: [join('.gemini', 'oauth_creds.json')],
}

/**
 * Create a per-credential home directory and write OAuth auth files into it.
 * Returns the home directory path.
 */
export function prepareSubscriptionHome(
  agentType: string,
  credentialId: string,
  oauthData: string,
): string {
  const homeDir = join(SUBSCRIPTION_HOMES_DIR, `${agentType}-${credentialId}`)
  mkdirSync(homeDir, { recursive: true, mode: 0o700 })

  const authPaths = AUTH_FILE_PATHS[agentType]
  if (!authPaths) return homeDir

  for (const relPath of authPaths) {
    const fullPath = join(homeDir, relPath)
    const parentDir = join(fullPath, '..')
    mkdirSync(parentDir, { recursive: true, mode: 0o700 })
    writeFileSync(fullPath, oauthData, { mode: 0o600 })
  }

  return homeDir
}

/**
 * Read OAuth auth data from the real home directory for a given agent type.
 * Returns the serialized JSON content, or undefined if unreadable.
 *
 * For claude-code on macOS: reads from the OS keychain (where Claude Code
 * actually stores OAuth tokens) instead of ~/.claude.json (which is only
 * a settings file, not auth).
 */
export function readSubscriptionAuthData(agentType: string): string | undefined {
  // Claude Code on macOS stores OAuth tokens in the OS keychain, not in files.
  if (agentType === 'claude-code' && process.platform === 'darwin') {
    return readClaudeCodeKeychainOAuth()
  }

  const authPaths = AUTH_FILE_PATHS[agentType]
  if (!authPaths) return undefined

  for (const relPath of authPaths) {
    try {
      return readFileSync(join(homedir(), relPath), 'utf-8')
    } catch {
      // File not found or unreadable
    }
  }
  return undefined
}

/**
 * Read Claude Code OAuth data from the macOS keychain.
 * Returns the serialized JSON of the claudeAiOauth object, or undefined.
 */
function readClaudeCodeKeychainOAuth(): string | undefined {
  try {
    // List keychain entries to find Claude Code credential service names
    const dump = execFileSync('security', ['dump-keychain'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
    const serviceMatches = [...dump.matchAll(/"svce"<blob>="(Claude Code-credentials-[a-f0-9]+)"/g)]

    for (const [, serviceName] of serviceMatches) {
      try {
        const password = execFileSync(
          'security',
          ['find-generic-password', '-s', serviceName, '-w'],
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
        ).trim()
        const data = JSON.parse(password)
        if (data.claudeAiOauth?.accessToken) {
          return JSON.stringify(data.claudeAiOauth)
        }
      } catch {
        // Entry unreadable or no OAuth data
      }
    }
  } catch {
    // Keychain unavailable or no entries
  }
  return undefined
}

/**
 * After an agent session, read back auth files from the per-credential home.
 * If the content has changed (token refreshed by CLI), update the credential store.
 */
export function syncBackSubscriptionAuth(
  agentType: string,
  credentialId: string,
  currentOAuthData?: string,
): void {
  // Claude Code on macOS: re-read from keychain in case token was refreshed
  if (agentType === 'claude-code' && process.platform === 'darwin') {
    const freshData = readClaudeCodeKeychainOAuth()
    if (freshData && freshData !== currentOAuthData) {
      updateCredential(agentType, credentialId, { oauthData: freshData })
    }
    return
  }

  const homeDir = join(SUBSCRIPTION_HOMES_DIR, `${agentType}-${credentialId}`)
  const authPaths = AUTH_FILE_PATHS[agentType]
  if (!authPaths) return

  for (const relPath of authPaths) {
    try {
      const refreshed = readFileSync(join(homeDir, relPath), 'utf-8')
      if (refreshed && refreshed !== currentOAuthData) {
        updateCredential(agentType, credentialId, { oauthData: refreshed })
      }
    } catch {
      // File not found — nothing to sync back
    }
  }
}

/**
 * Convert agent auth config to environment variables for the adapter.
 * For subscription mode with oauthData, sets up per-credential home isolation
 * so the CLI subprocess reads auth from its own directory.
 */
export function agentConfigToEnv(
  agentType: string,
  config: AgentAuthConfig,
  credentialId?: string,
): Record<string, string> {
  const env: Record<string, string> = {}

  // Subscription mode requires oauthData — reject credentials that lack it
  // to prevent silent fallback to the real HOME's CLI auth files.
  // Exception: claude-code stores OAuth tokens in the OS keychain (not in files),
  // so oauthData is just the settings file and may be absent.
  if (config.mode === 'subscription' && !config.oauthData && agentType !== 'claude-code') {
    throw new Error(
      `Subscription credential for ${agentType} is missing OAuth data. ` +
        'Please delete this credential and re-add it via subscription login ' +
        'to capture the authentication data.',
    )
  }

  switch (agentType) {
    case 'claude-code':
      // Claude Code on macOS stores OAuth tokens in the OS keychain, keyed by
      // a hash that includes $HOME. Changing HOME breaks keychain lookup.
      // Instead, pass the OAuth access token via the SDK's supported env var.
      if (config.mode === 'subscription') {
        let oauthToken: string | undefined
        if (config.oauthData) {
          try {
            const parsed = JSON.parse(config.oauthData)
            oauthToken = parsed.accessToken
          } catch {
            // Old format (settings file) — no accessToken
          }
        }
        // Fallback: read fresh token from OS keychain
        if (!oauthToken && process.platform === 'darwin') {
          const freshData = readClaudeCodeKeychainOAuth()
          if (freshData) {
            try {
              oauthToken = JSON.parse(freshData).accessToken
            } catch {
              // Malformed data
            }
          }
        }
        if (oauthToken) {
          env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken
        }
      }
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
      if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl
      if (config.model) env.ANTHROPIC_MODEL = config.model
      break
    case 'codex':
      if (config.mode === 'api' && config.apiKey) {
        env.OPENAI_API_KEY = config.apiKey
        env.CODEX_API_KEY = config.apiKey
      } else if (config.mode === 'subscription' && config.oauthData && credentialId) {
        const homeDir = prepareSubscriptionHome(agentType, credentialId, config.oauthData)
        env.HOME = homeDir
      }
      if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl
      if (config.model) env.CODEX_MODEL = config.model
      break
    case 'gemini':
      if (config.mode === 'subscription') {
        env.GOOGLE_GENAI_USE_GCA = 'true'
        if (config.oauthData && credentialId) {
          const homeDir = prepareSubscriptionHome(agentType, credentialId, config.oauthData)
          env.GEMINI_CLI_HOME = homeDir
        }
      }
      if (config.apiKey) env.GEMINI_API_KEY = config.apiKey
      if (config.baseUrl) env.GEMINI_BASE_URL = config.baseUrl
      if (config.model) env.GEMINI_MODEL = config.model
      break
  }

  return env
}
