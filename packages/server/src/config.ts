import { MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from '@agentim/shared'
import { createLogger } from './lib/logger.js'

const log = createLogger('Config')

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

/** Parse an integer env var, returning fallback when missing or NaN (but NOT when 0). */
function intEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const val = parseInt(raw, 10)
  return Number.isNaN(val) ? fallback : val
}

const isProduction = process.env.NODE_ENV === 'production'

export const config = {
  isProduction,
  port: Math.max(1, Math.min(65535, intEnv('PORT', 3000))),
  host: env('HOST', '0.0.0.0'),
  databaseUrl: env('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/agentim'),
  redisUrl: process.env.REDIS_URL || '',
  redisEnabled: !!process.env.REDIS_URL,
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  jwtAccessExpiry: env('JWT_ACCESS_EXPIRY', '15m'),
  jwtRefreshExpiry: env('JWT_REFRESH_EXPIRY', '7d'),
  corsOrigin: env('CORS_ORIGIN', isProduction ? '' : 'http://localhost:5173'),
  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // Sentry (optional)
  sentryDsn: process.env.SENTRY_DSN || '',
  // Storage provider
  storageProvider: env('STORAGE_PROVIDER', 'local') as 'local' | 's3',
  s3: {
    bucket: env('S3_BUCKET', ''),
    region: env('S3_REGION', 'auto'),
    endpoint: process.env.S3_ENDPOINT || '',
    accessKeyId: env('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY', ''),
  },
  // File upload
  uploadDir: env('UPLOAD_DIR', './uploads'),
  maxFileSize: Math.max(1, intEnv('MAX_FILE_SIZE', MAX_FILE_SIZE)),
  allowedMimeTypes: ALLOWED_MIME_TYPES as readonly string[],
  // AI Router (optional — uses OpenAI-compatible API)
  routerLlmBaseUrl: process.env.ROUTER_LLM_BASE_URL || '',
  routerLlmApiKey: process.env.ROUTER_LLM_API_KEY || '',
  routerLlmModel: process.env.ROUTER_LLM_MODEL || '',
  // Routing protection
  maxAgentChainDepth: Math.max(1, Math.min(100, intEnv('MAX_AGENT_CHAIN_DEPTH', 5))),
  agentRateLimitWindow: Math.max(1, Math.min(3600, intEnv('AGENT_RATE_LIMIT_WINDOW', 60))),
  agentRateLimitMax: Math.max(1, Math.min(1000, intEnv('AGENT_RATE_LIMIT_MAX', 20))),
  // Periodic cleanup intervals (ms)
  orphanFileCheckInterval: Math.max(60000, intEnv('ORPHAN_FILE_CHECK_INTERVAL', 3600000)),
  tokenCleanupInterval: Math.max(60000, intEnv('TOKEN_CLEANUP_INTERVAL', 3600000)),
  gatewayCleanupInterval: Math.max(60000, intEnv('GATEWAY_CLEANUP_INTERVAL', 86400000)), // 24h
  gatewayMaxOfflineDays: Math.max(1, intEnv('GATEWAY_MAX_OFFLINE_DAYS', 30)),
  // Client WebSocket rate limiting
  clientRateLimitWindow: Math.max(1, Math.min(300, intEnv('CLIENT_RATE_LIMIT_WINDOW', 10))),
  clientRateLimitMax: Math.max(1, Math.min(1000, intEnv('CLIENT_RATE_LIMIT_MAX', 30))),
  // WebSocket connection limits (global defaults, can be overridden per-user)
  maxWsConnectionsPerUser: Math.max(1, Math.min(100, intEnv('MAX_WS_CONNECTIONS_PER_USER', 10))),
  maxTotalWsConnections: Math.max(10, Math.min(100000, intEnv('MAX_TOTAL_WS_CONNECTIONS', 5000))),
  maxGatewaysPerUser: Math.max(1, Math.min(100, intEnv('MAX_GATEWAYS_PER_USER', 20))),
  // Trust proxy headers (X-Forwarded-For, X-Real-IP) for client IP resolution
  // Set to true only when running behind a trusted reverse proxy (nginx, cloudflare, etc.)
  trustProxy: env('TRUST_PROXY', 'false') === 'true',
  // HTTP body size limits
  // Upload body limit is intentionally larger than maxFileSize to accommodate multipart
  // form-data overhead (boundary markers, headers, base64 encoding ≈ 20% overhead).
  uploadBodyLimit: 12 * 1024 * 1024, // 12 MB (for multipart upload with maxFileSize=10MB)
  apiBodyLimit: 1024 * 1024, // 1 MB (for JSON API requests)
  // WebSocket protocol constants
  wsAuthTimeoutMs: 5_000,
  maxWsMessageSize: 64 * 1024, // 64 KB (client messages)
  maxGatewayMessageSize: 256 * 1024, // 256 KB (gateway messages include agent output)
  maxAttachmentsPerMessage: 20,
  maxReactionsPerMessage: 20,
  typingDebounceMs: 1_000,
  routerLlmTimeoutMs: Math.max(1000, intEnv('ROUTER_LLM_TIMEOUT_MS', 15_000)),
  routerTestTimeoutMs: 10_000,
  maxRefreshTokensPerUser: 10,
  logLevel: env('LOG_LEVEL', 'info'),
  runMigrations: env('RUN_MIGRATIONS', 'true') === 'true',
}

// Security check: refuse to start in production with weak JWT secret
if (isProduction && (config.jwtSecret === 'dev-secret-change-me' || config.jwtSecret.length < 32)) {
  log.fatal(
    'JWT_SECRET is missing or too short (min 32 chars). Set a strong, random JWT_SECRET for production. Example: JWT_SECRET=$(openssl rand -base64 32)',
  )
  process.exit(1)
}

if (!isProduction && config.jwtSecret === 'dev-secret-change-me') {
  log.warn('Using default JWT_SECRET — do NOT use in production.')
}

// Validate required env vars in production
if (isProduction) {
  if (!process.env.DATABASE_URL) {
    log.fatal('DATABASE_URL must be set in production.')
    process.exit(1)
  }
  if (!process.env.REDIS_URL) {
    log.warn(
      'REDIS_URL is not set — Redis features are disabled. Without Redis: (1) token revocation only works within the current process, (2) rate limiting is per-process (not global), (3) Pub/Sub for multi-node sync is unavailable. Strongly recommended for production. Only omit for single-node / personal deployments.',
    )
  }
}

// Validate S3 config when storage provider is s3
if (config.storageProvider === 's3') {
  const missing = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(
    (k) => !process.env[k],
  )
  if (missing.length > 0) {
    log.fatal(`STORAGE_PROVIDER=s3 requires: ${missing.join(', ')}`)
    process.exit(1)
  }
}

// Refuse to start with wide-open or empty CORS in production
if (isProduction && (!config.corsOrigin || config.corsOrigin === '*')) {
  log.fatal(
    'CORS_ORIGIN must be set to your frontend domain in production (e.g. https://app.example.com). It cannot be empty or "*".',
  )
  process.exit(1)
}

// Validate CORS_ORIGIN is a properly-formed origin in production.
// An HTTP origin must be scheme + host (+ optional port) with no path component.
// Catches typos like "https//example.com" or "https://app.example.com/".
if (isProduction && config.corsOrigin) {
  let corsUrl: URL
  try {
    corsUrl = new URL(config.corsOrigin)
  } catch {
    log.fatal(
      `CORS_ORIGIN is not a valid URL: "${config.corsOrigin}". Example: https://app.example.com`,
    )
    process.exit(1)
  }
  if (corsUrl!.pathname !== '/' && corsUrl!.pathname !== '') {
    log.fatal(
      `CORS_ORIGIN must not include a path component. Got: "${config.corsOrigin}". Use: "${corsUrl!.origin}"`,
    )
    process.exit(1)
  }
  if (corsUrl!.protocol !== 'https:' && corsUrl!.protocol !== 'http:') {
    log.fatal(`CORS_ORIGIN must use https:// or http:// scheme. Got: "${config.corsOrigin}"`)
    process.exit(1)
  }
}

// Warn when LLM router is only partially configured (likely a misconfiguration)
const routerUrlSet = !!process.env.ROUTER_LLM_BASE_URL
const routerKeySet = !!process.env.ROUTER_LLM_API_KEY
if (routerUrlSet !== routerKeySet) {
  log.warn(
    routerUrlSet
      ? 'ROUTER_LLM_BASE_URL is set but ROUTER_LLM_API_KEY is missing — LLM-based routing will not work.'
      : 'ROUTER_LLM_API_KEY is set but ROUTER_LLM_BASE_URL is missing — LLM-based routing will not work.',
  )
}

// ─── Dynamic Settings Bridge ───
// Allows hot-path code to read DB-backed settings synchronously via the
// settings module. Injected at startup to avoid circular dependencies
// (config.ts is imported before db/settings are initialized).

let _settingsModule: {
  getSettingSync: (key: string) => string
  getSettingTypedSync: <T extends string | number | boolean>(key: string) => T
} | null = null

export function _setSettingsModule(mod: typeof _settingsModule): void {
  _settingsModule = mod
}

/**
 * Read a DB-backed setting synchronously. Falls through to env var / default
 * when the settings module hasn't been injected yet (e.g. during early startup).
 *
 * Returns `'' as T` when the settings module is not yet injected. All call sites
 * use the `|| config.staticDefault` pattern (e.g. `getConfigSync<number>('ws.maxConnectionsPerUser') || config.maxWsConnectionsPerUser`)
 * so the empty-string falsy fallback always resolves to the static config value.
 */
export function getConfigSync<T extends string | number | boolean = string>(settingKey: string): T {
  if (_settingsModule) {
    return _settingsModule.getSettingTypedSync<T>(settingKey)
  }
  return '' as T
}

// Validate ENCRYPTION_KEY: must be set in production (any non-empty string is accepted;
// crypto.ts derives a 32-byte AES key via SHA-256 so arbitrary strings work).
// Prefer `openssl rand -base64 32` for maximum entropy.
if (process.env.ENCRYPTION_KEY) {
  if (isProduction && process.env.ENCRYPTION_KEY.length < 32) {
    log.fatal(
      'ENCRYPTION_KEY is too short (< 32 chars) for production. Generate with: ENCRYPTION_KEY=$(openssl rand -base64 32)',
    )
    process.exit(1)
  } else if (process.env.ENCRYPTION_KEY.length < 16) {
    log.warn(
      'ENCRYPTION_KEY is very short (< 16 chars). For production use, generate a secure key with: ENCRYPTION_KEY=$(openssl rand -base64 32)',
    )
  }
} else if (isProduction) {
  log.fatal(
    'ENCRYPTION_KEY must be set in production — Router API keys cannot be stored securely without it. Generate with: ENCRYPTION_KEY=$(openssl rand -base64 32)',
  )
  process.exit(1)
}
