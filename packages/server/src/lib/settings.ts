import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { settings } from '../db/schema.js'
import { createLogger } from './logger.js'

const log = createLogger('Settings')

// ─── Setting Types ───

export type SettingType = 'string' | 'number' | 'boolean' | 'enum'

export interface SettingDefinition {
  key: string
  group: SettingGroup
  type: SettingType
  sensitive?: boolean
  defaultValue: string
  /** Env var name to fall back to (e.g. 'CORS_ORIGIN') */
  envKey?: string
  /** Allowed enum values (for type=enum) */
  enumValues?: string[]
  /** min/max for numbers */
  min?: number
  max?: number
  /** i18n key for label */
  labelKey: string
  /** i18n key for description */
  descKey: string
}

export type SettingGroup =
  | 'general'
  | 'security'
  | 'storage'
  | 'rateLimit'
  | 'connections'
  | 'aiRouter'
  | 'pushNotifications'
  | 'maintenance'

// ─── Settings Registry ───

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // General
  {
    key: 'cors.origin',
    group: 'general',
    type: 'string',
    defaultValue: 'http://localhost:5173',
    envKey: 'CORS_ORIGIN',
    labelKey: 'adminSettings.corsOrigin',
    descKey: 'adminSettings.corsOriginDesc',
  },
  {
    key: 'log.level',
    group: 'general',
    type: 'enum',
    defaultValue: 'info',
    envKey: 'LOG_LEVEL',
    enumValues: ['debug', 'info', 'warn', 'error', 'fatal'],
    labelKey: 'adminSettings.logLevel',
    descKey: 'adminSettings.logLevelDesc',
  },
  {
    key: 'metrics.authEnabled',
    group: 'general',
    type: 'boolean',
    defaultValue: process.env.NODE_ENV === 'production' ? 'true' : 'false',
    envKey: 'METRICS_AUTH_ENABLED',
    labelKey: 'adminSettings.metricsAuthEnabled',
    descKey: 'adminSettings.metricsAuthEnabledDesc',
  },

  // Security
  {
    key: 'jwt.accessExpiry',
    group: 'security',
    type: 'string',
    defaultValue: '15m',
    envKey: 'JWT_ACCESS_EXPIRY',
    labelKey: 'adminSettings.jwtAccessExpiry',
    descKey: 'adminSettings.jwtAccessExpiryDesc',
  },
  {
    key: 'jwt.refreshExpiry',
    group: 'security',
    type: 'string',
    defaultValue: '7d',
    envKey: 'JWT_REFRESH_EXPIRY',
    labelKey: 'adminSettings.jwtRefreshExpiry',
    descKey: 'adminSettings.jwtRefreshExpiryDesc',
  },
  {
    key: 'trust.proxy',
    group: 'security',
    type: 'boolean',
    defaultValue: 'false',
    envKey: 'TRUST_PROXY',
    labelKey: 'adminSettings.trustProxy',
    descKey: 'adminSettings.trustProxyDesc',
  },
  {
    key: 'oauth.github.clientId',
    group: 'security',
    type: 'string',
    defaultValue: '',
    envKey: 'OAUTH_GITHUB_CLIENT_ID',
    labelKey: 'adminSettings.oauthGithubClientId',
    descKey: 'adminSettings.oauthGithubClientIdDesc',
  },
  {
    key: 'oauth.github.clientSecret',
    group: 'security',
    type: 'string',
    sensitive: true,
    defaultValue: '',
    envKey: 'OAUTH_GITHUB_CLIENT_SECRET',
    labelKey: 'adminSettings.oauthGithubClientSecret',
    descKey: 'adminSettings.oauthGithubClientSecretDesc',
  },
  {
    key: 'oauth.google.clientId',
    group: 'security',
    type: 'string',
    defaultValue: '',
    envKey: 'OAUTH_GOOGLE_CLIENT_ID',
    labelKey: 'adminSettings.oauthGoogleClientId',
    descKey: 'adminSettings.oauthGoogleClientIdDesc',
  },
  {
    key: 'oauth.google.clientSecret',
    group: 'security',
    type: 'string',
    sensitive: true,
    defaultValue: '',
    envKey: 'OAUTH_GOOGLE_CLIENT_SECRET',
    labelKey: 'adminSettings.oauthGoogleClientSecret',
    descKey: 'adminSettings.oauthGoogleClientSecretDesc',
  },
  {
    key: 'totp.issuer',
    group: 'security',
    type: 'string',
    defaultValue: 'AgentIM',
    envKey: 'TOTP_ISSUER',
    labelKey: 'adminSettings.totpIssuer',
    descKey: 'adminSettings.totpIssuerDesc',
  },

  // Storage
  {
    key: 'upload.maxFileSize',
    group: 'storage',
    type: 'number',
    defaultValue: '10485760',
    envKey: 'MAX_FILE_SIZE',
    min: 1024,
    max: 104857600,
    labelKey: 'adminSettings.uploadMaxFileSize',
    descKey: 'adminSettings.uploadMaxFileSizeDesc',
  },
  {
    key: 'storage.provider',
    group: 'storage',
    type: 'enum',
    defaultValue: 'local',
    envKey: 'STORAGE_PROVIDER',
    enumValues: ['local', 's3'],
    labelKey: 'adminSettings.storageProvider',
    descKey: 'adminSettings.storageProviderDesc',
  },
  {
    key: 'storage.s3.bucket',
    group: 'storage',
    type: 'string',
    defaultValue: '',
    envKey: 'S3_BUCKET',
    labelKey: 'adminSettings.s3Bucket',
    descKey: 'adminSettings.s3BucketDesc',
  },
  {
    key: 'storage.s3.region',
    group: 'storage',
    type: 'string',
    defaultValue: 'auto',
    envKey: 'S3_REGION',
    labelKey: 'adminSettings.s3Region',
    descKey: 'adminSettings.s3RegionDesc',
  },
  {
    key: 'storage.s3.endpoint',
    group: 'storage',
    type: 'string',
    defaultValue: '',
    envKey: 'S3_ENDPOINT',
    labelKey: 'adminSettings.s3Endpoint',
    descKey: 'adminSettings.s3EndpointDesc',
  },
  {
    key: 'storage.s3.accessKeyId',
    group: 'storage',
    type: 'string',
    sensitive: true,
    defaultValue: '',
    envKey: 'S3_ACCESS_KEY_ID',
    labelKey: 'adminSettings.s3AccessKeyId',
    descKey: 'adminSettings.s3AccessKeyIdDesc',
  },
  {
    key: 'storage.s3.secretAccessKey',
    group: 'storage',
    type: 'string',
    sensitive: true,
    defaultValue: '',
    envKey: 'S3_SECRET_ACCESS_KEY',
    labelKey: 'adminSettings.s3SecretAccessKey',
    descKey: 'adminSettings.s3SecretAccessKeyDesc',
  },

  // Rate Limiting
  {
    key: 'rateLimit.client.window',
    group: 'rateLimit',
    type: 'number',
    defaultValue: '10',
    envKey: 'CLIENT_RATE_LIMIT_WINDOW',
    min: 1,
    max: 300,
    labelKey: 'adminSettings.clientRateLimitWindow',
    descKey: 'adminSettings.clientRateLimitWindowDesc',
  },
  {
    key: 'rateLimit.client.max',
    group: 'rateLimit',
    type: 'number',
    defaultValue: '30',
    envKey: 'CLIENT_RATE_LIMIT_MAX',
    min: 1,
    max: 1000,
    labelKey: 'adminSettings.clientRateLimitMax',
    descKey: 'adminSettings.clientRateLimitMaxDesc',
  },
  {
    key: 'rateLimit.agent.window',
    group: 'rateLimit',
    type: 'number',
    defaultValue: '60',
    envKey: 'AGENT_RATE_LIMIT_WINDOW',
    min: 1,
    max: 3600,
    labelKey: 'adminSettings.agentRateLimitWindow',
    descKey: 'adminSettings.agentRateLimitWindowDesc',
  },
  {
    key: 'rateLimit.agent.max',
    group: 'rateLimit',
    type: 'number',
    defaultValue: '20',
    envKey: 'AGENT_RATE_LIMIT_MAX',
    min: 1,
    max: 1000,
    labelKey: 'adminSettings.agentRateLimitMax',
    descKey: 'adminSettings.agentRateLimitMaxDesc',
  },

  // Connection Limits
  {
    key: 'ws.maxConnectionsPerUser',
    group: 'connections',
    type: 'number',
    defaultValue: '10',
    envKey: 'MAX_WS_CONNECTIONS_PER_USER',
    min: 1,
    max: 100,
    labelKey: 'adminSettings.maxConnectionsPerUser',
    descKey: 'adminSettings.maxConnectionsPerUserDesc',
  },
  {
    key: 'ws.maxTotalConnections',
    group: 'connections',
    type: 'number',
    defaultValue: '5000',
    envKey: 'MAX_TOTAL_WS_CONNECTIONS',
    min: 10,
    max: 100000,
    labelKey: 'adminSettings.maxTotalConnections',
    descKey: 'adminSettings.maxTotalConnectionsDesc',
  },
  {
    key: 'ws.maxGatewaysPerUser',
    group: 'connections',
    type: 'number',
    defaultValue: '20',
    envKey: 'MAX_GATEWAYS_PER_USER',
    min: 1,
    max: 100,
    labelKey: 'adminSettings.maxGatewaysPerUser',
    descKey: 'adminSettings.maxGatewaysPerUserDesc',
  },
  {
    key: 'ws.maxMessageSize',
    group: 'connections',
    type: 'number',
    defaultValue: '65536',
    envKey: 'MAX_WS_MESSAGE_SIZE',
    min: 1024,
    max: 1048576,
    labelKey: 'adminSettings.maxMessageSize',
    descKey: 'adminSettings.maxMessageSizeDesc',
  },
  {
    key: 'ws.gatewayMessageSize',
    group: 'connections',
    type: 'number',
    defaultValue: '262144',
    envKey: 'MAX_GATEWAY_MESSAGE_SIZE',
    min: 1024,
    max: 10485760,
    labelKey: 'adminSettings.gatewayMessageSize',
    descKey: 'adminSettings.gatewayMessageSizeDesc',
  },

  // AI Router
  {
    key: 'router.llm.baseUrl',
    group: 'aiRouter',
    type: 'string',
    defaultValue: '',
    envKey: 'ROUTER_LLM_BASE_URL',
    labelKey: 'adminSettings.routerLlmBaseUrl',
    descKey: 'adminSettings.routerLlmBaseUrlDesc',
  },
  {
    key: 'router.llm.apiKey',
    group: 'aiRouter',
    type: 'string',
    sensitive: true,
    defaultValue: '',
    envKey: 'ROUTER_LLM_API_KEY',
    labelKey: 'adminSettings.routerLlmApiKey',
    descKey: 'adminSettings.routerLlmApiKeyDesc',
  },
  {
    key: 'router.llm.model',
    group: 'aiRouter',
    type: 'string',
    defaultValue: '',
    envKey: 'ROUTER_LLM_MODEL',
    labelKey: 'adminSettings.routerLlmModel',
    descKey: 'adminSettings.routerLlmModelDesc',
  },
  {
    key: 'router.llm.timeout',
    group: 'aiRouter',
    type: 'number',
    defaultValue: '15000',
    envKey: 'ROUTER_LLM_TIMEOUT_MS',
    min: 1000,
    max: 120000,
    labelKey: 'adminSettings.routerLlmTimeout',
    descKey: 'adminSettings.routerLlmTimeoutDesc',
  },
  {
    key: 'router.maxChainDepth',
    group: 'aiRouter',
    type: 'number',
    defaultValue: '5',
    envKey: 'MAX_AGENT_CHAIN_DEPTH',
    min: 1,
    max: 100,
    labelKey: 'adminSettings.maxChainDepth',
    descKey: 'adminSettings.maxChainDepthDesc',
  },

  // Push Notifications (VAPID)
  {
    key: 'push.vapidPublicKey',
    group: 'pushNotifications',
    type: 'string',
    defaultValue: '',
    labelKey: 'adminSettings.vapidPublicKey',
    descKey: 'adminSettings.vapidPublicKeyDesc',
  },
  {
    key: 'push.vapidPrivateKey',
    group: 'pushNotifications',
    type: 'string',
    sensitive: true,
    defaultValue: '',
    labelKey: 'adminSettings.vapidPrivateKey',
    descKey: 'adminSettings.vapidPrivateKeyDesc',
  },
  {
    key: 'push.vapidSubject',
    group: 'pushNotifications',
    type: 'string',
    defaultValue: 'mailto:noreply@agentim.app',
    labelKey: 'adminSettings.vapidSubject',
    descKey: 'adminSettings.vapidSubjectDesc',
  },

  // Maintenance — cleanup tasks
  {
    key: 'cleanup.orphanFileInterval',
    group: 'maintenance',
    type: 'number',
    defaultValue: '3600000',
    envKey: 'ORPHAN_FILE_CHECK_INTERVAL',
    min: 60000,
    max: 86400000,
    labelKey: 'adminSettings.orphanFileInterval',
    descKey: 'adminSettings.orphanFileIntervalDesc',
  },
  {
    key: 'cleanup.tokenInterval',
    group: 'maintenance',
    type: 'number',
    defaultValue: '3600000',
    envKey: 'TOKEN_CLEANUP_INTERVAL',
    min: 60000,
    max: 86400000,
    labelKey: 'adminSettings.tokenInterval',
    descKey: 'adminSettings.tokenIntervalDesc',
  },
  {
    key: 'cleanup.auditRetentionDays',
    group: 'maintenance',
    type: 'number',
    defaultValue: '90',
    envKey: 'AUDIT_LOG_RETENTION_DAYS',
    min: 1,
    max: 3650,
    labelKey: 'adminSettings.auditRetentionDays',
    descKey: 'adminSettings.auditRetentionDaysDesc',
  },
  {
    key: 'cleanup.auditInterval',
    group: 'maintenance',
    type: 'number',
    defaultValue: '86400000',
    envKey: 'AUDIT_LOG_CLEANUP_INTERVAL',
    min: 60000,
    max: 86400000,
    labelKey: 'adminSettings.auditCleanupInterval',
    descKey: 'adminSettings.auditCleanupIntervalDesc',
  },
  {
    key: 'cleanup.gatewayInterval',
    group: 'maintenance',
    type: 'number',
    defaultValue: '86400000',
    envKey: 'GATEWAY_CLEANUP_INTERVAL',
    min: 60000,
    max: 86400000,
    labelKey: 'adminSettings.gatewayCleanupInterval',
    descKey: 'adminSettings.gatewayCleanupIntervalDesc',
  },
  {
    key: 'cleanup.gatewayMaxOfflineDays',
    group: 'maintenance',
    type: 'number',
    defaultValue: '30',
    envKey: 'GATEWAY_MAX_OFFLINE_DAYS',
    min: 1,
    max: 365,
    labelKey: 'adminSettings.gatewayMaxOfflineDays',
    descKey: 'adminSettings.gatewayMaxOfflineDaysDesc',
  },
  // Maintenance — monitoring
  {
    key: 'sentry.dsn',
    group: 'maintenance',
    type: 'string',
    defaultValue: '',
    envKey: 'SENTRY_DSN',
    labelKey: 'adminSettings.sentryDsn',
    descKey: 'adminSettings.sentryDsnDesc',
  },
]

// Lookup by key for O(1) access
const DEFINITION_MAP = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]))

// ─── In-Memory Cache ───

const CACHE_TTL_MS = 5_000
const cache = new Map<string, { value: string; expiresAt: number }>()

/**
 * Persistent store of the last known DB value for each setting. Unlike `cache`
 * (which has a 5 s TTL), this map retains the most recent value that was
 * successfully read from the database until it is explicitly overwritten by a
 * newer DB read or a `setSetting()` call. This prevents `getSettingSync()` from
 * silently falling back to env-var / default values after the short TTL expires.
 */
const lastKnownDbValue = new Map<string, string>()

function getCached(key: string): string | undefined {
  const entry = cache.get(key)
  if (entry && Date.now() < entry.expiresAt) return entry.value
  return undefined
}

function setCache(key: string, value: string): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  lastKnownDbValue.set(key, value)
}

// ─── Core Functions ───

/**
 * Get a setting value (async). Priority: cache → DB → env var → default.
 */
export async function getSetting(key: string): Promise<string> {
  // 1. Check cache
  const cached = getCached(key)
  if (cached !== undefined) return cached

  // 2. Check DB
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
    if (row) {
      let val = row.value
      const def = DEFINITION_MAP.get(key)
      if (def?.sensitive && val.startsWith('enc:')) {
        const { decryptSecret } = await import('./crypto.js')
        const decrypted = decryptSecret(val)
        if (decrypted !== null) val = decrypted
      }
      setCache(key, val)
      return val
    }
  } catch (err) {
    log.warn(`Failed to read setting "${key}" from DB: ${(err as Error).message}`)
  }

  // 3. Env var fallback
  const def = DEFINITION_MAP.get(key)
  if (def?.envKey) {
    const envVal = process.env[def.envKey]
    if (envVal !== undefined && envVal !== '') return envVal
  }

  // 4. Default
  return def?.defaultValue ?? ''
}

/**
 * Synchronous setting read.
 * Priority: cache → last known DB value → env var → default.
 *
 * The "last known DB value" layer ensures that dynamic settings changed via the
 * admin UI persist across the short cache TTL even in synchronous hot paths.
 * Without it, sync reads would silently regress to the env-var / default value
 * once the 5 s cache expired, making admin changes appear to "not stick".
 */
export function getSettingSync(key: string): string {
  const cached = getCached(key)
  if (cached !== undefined) return cached

  // Return the last value that was successfully read from the database (if any).
  // This survives cache expiration and avoids falling back to env/default.
  const persisted = lastKnownDbValue.get(key)
  if (persisted !== undefined) return persisted

  const def = DEFINITION_MAP.get(key)
  if (def?.envKey) {
    const envVal = process.env[def.envKey]
    if (envVal !== undefined && envVal !== '') return envVal
  }

  return def?.defaultValue ?? ''
}

/**
 * Typed sync getter — parses value according to the expected type.
 */
export function getSettingTypedSync<T extends string | number | boolean>(key: string): T {
  const raw = getSettingSync(key)
  const def = DEFINITION_MAP.get(key)
  if (!def) return raw as T

  if (def.type === 'number') return Number(raw) as T
  if (def.type === 'boolean') return (raw === 'true') as T
  return raw as T
}

/**
 * Set a setting value. Validates, upserts to DB, and invalidates cache.
 */
export async function setSetting(
  key: string,
  value: string,
  userId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const def = DEFINITION_MAP.get(key)
  if (!def) return { ok: false, error: `Unknown setting: ${key}` }

  // Validate
  const error = validateSetting(def, value)
  if (error) return { ok: false, error }

  // Encrypt sensitive values before storing
  let storeValue = value
  if (def.sensitive) {
    const { encryptSecret } = await import('./crypto.js')
    storeValue = encryptSecret(value)
  }

  const now = new Date().toISOString()

  try {
    // Upsert: INSERT ON CONFLICT UPDATE
    await db
      .insert(settings)
      .values({ key, value: storeValue, updatedAt: now, updatedBy: userId ?? null })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: storeValue, updatedAt: now, updatedBy: userId ?? null },
      })
    setCache(key, value)
    return { ok: true }
  } catch (err) {
    log.error(`Failed to save setting "${key}": ${(err as Error).message}`)
    return { ok: false, error: 'Failed to save setting' }
  }
}

/**
 * Get all settings grouped for the admin UI.
 * Sensitive values are masked unless the DB has no value set.
 */
export async function getAllSettings(): Promise<
  Record<
    string,
    Array<{
      key: string
      value: string
      type: SettingType
      sensitive: boolean
      enumValues?: string[]
      min?: number
      max?: number
      labelKey: string
      descKey: string
      source: 'db' | 'env' | 'default'
    }>
  >
> {
  // Load all DB settings and decrypt sensitive values
  const dbRows = await db.select().from(settings)
  const dbMap = new Map<string, string>()
  for (const r of dbRows) {
    let val = r.value
    const def = DEFINITION_MAP.get(r.key)
    if (def?.sensitive && val.startsWith('enc:')) {
      const { decryptSecret } = await import('./crypto.js')
      const decrypted = decryptSecret(val)
      if (decrypted !== null) val = decrypted
    }
    dbMap.set(r.key, val)
  }

  const groups: Record<string, Array<ReturnType<typeof mapDef>>> = {}

  for (const def of SETTING_DEFINITIONS) {
    const item = mapDef(def, dbMap)
    if (!groups[def.group]) groups[def.group] = []
    groups[def.group].push(item)
  }

  return groups
}

function mapDef(
  def: SettingDefinition,
  dbMap: Map<string, string>,
): {
  key: string
  value: string
  type: SettingType
  sensitive: boolean
  enumValues?: string[]
  min?: number
  max?: number
  labelKey: string
  descKey: string
  source: 'db' | 'env' | 'default'
} {
  let value: string
  let source: 'db' | 'env' | 'default'

  if (dbMap.has(def.key)) {
    value = dbMap.get(def.key)!
    source = 'db'
  } else if (def.envKey && process.env[def.envKey]) {
    value = process.env[def.envKey]!
    source = 'env'
  } else {
    value = def.defaultValue
    source = 'default'
  }

  // Mask sensitive values
  if (def.sensitive && value) {
    value = value.slice(0, 4) + '••••••••'
  }

  return {
    key: def.key,
    value,
    type: def.type,
    sensitive: def.sensitive ?? false,
    ...(def.enumValues ? { enumValues: def.enumValues } : {}),
    ...(def.min !== undefined ? { min: def.min } : {}),
    ...(def.max !== undefined ? { max: def.max } : {}),
    labelKey: def.labelKey,
    descKey: def.descKey,
    source,
  }
}

/** Validate an origin string: must be scheme + host (+ optional port), no path. */
function isValidOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (u.pathname !== '/' && u.pathname !== '') return false
    return true
  } catch {
    return false
  }
}

function validateSetting(def: SettingDefinition, value: string): string | undefined {
  if (def.type === 'number') {
    const num = Number(value)
    if (Number.isNaN(num)) return `${def.key}: must be a number`
    if (def.min !== undefined && num < def.min) return `${def.key}: minimum is ${def.min}`
    if (def.max !== undefined && num > def.max) return `${def.key}: maximum is ${def.max}`
  }
  if (def.type === 'boolean' && value !== 'true' && value !== 'false') {
    return `${def.key}: must be "true" or "false"`
  }
  if (def.type === 'enum' && def.enumValues && !def.enumValues.includes(value)) {
    return `${def.key}: must be one of ${def.enumValues.join(', ')}`
  }
  // Semantic validation for cors.origin — must be comma-separated valid origins
  if (def.key === 'cors.origin' && value) {
    if (value === '*') return `${def.key}: wildcard "*" is not allowed — specify explicit origins`
    const origins = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const origin of origins) {
      if (!isValidOrigin(origin)) {
        return `${def.key}: "${origin}" is not a valid HTTP(S) origin (e.g. https://app.example.com)`
      }
    }
  }
  return undefined
}

/**
 * Preload all settings from DB into cache. Called once at startup.
 */
export async function preloadSettings(): Promise<void> {
  try {
    const rows = await db.select().from(settings)
    for (const row of rows) {
      let val = row.value
      const def = DEFINITION_MAP.get(row.key)
      if (def?.sensitive && val.startsWith('enc:')) {
        const { decryptSecret } = await import('./crypto.js')
        const decrypted = decryptSecret(val)
        if (decrypted !== null) val = decrypted
      }
      setCache(row.key, val)
    }
    log.info(`Settings cache preloaded (${rows.length} entries)`)
  } catch (err) {
    log.warn(`Failed to preload settings: ${(err as Error).message}`)
  }
}

/**
 * Invalidate cache for a specific key or all keys.
 */
export function invalidateCache(key?: string): void {
  if (key) {
    cache.delete(key)
  } else {
    cache.clear()
  }
}

/**
 * Get the setting definition for a key.
 */
export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return DEFINITION_MAP.get(key)
}

/**
 * Get the raw (unmasked) value of a setting from DB.
 * Used internally when rebuilding storage adapters etc.
 */
export async function getSettingRaw(key: string): Promise<string> {
  return getSetting(key)
}
