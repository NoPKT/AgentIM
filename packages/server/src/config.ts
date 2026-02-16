import { MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from '@agentim/shared'
import { createLogger } from './lib/logger.js'

const log = createLogger('Config')

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

const isProduction = process.env.NODE_ENV === 'production'

export const config = {
  isProduction,
  port: parseInt(env('PORT', '3000'), 10),
  host: env('HOST', '0.0.0.0'),
  databaseUrl: env('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/agentim'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  jwtAccessExpiry: env('JWT_ACCESS_EXPIRY', '15m'),
  jwtRefreshExpiry: env('JWT_REFRESH_EXPIRY', '7d'),
  corsOrigin: env('CORS_ORIGIN', isProduction ? '' : 'http://localhost:5173'),
  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // Sentry (optional)
  sentryDsn: process.env.SENTRY_DSN || '',
  // File upload
  uploadDir: env('UPLOAD_DIR', './uploads'),
  maxFileSize: parseInt(env('MAX_FILE_SIZE', String(MAX_FILE_SIZE)), 10),
  allowedMimeTypes: ALLOWED_MIME_TYPES as readonly string[],
  // AI Router (optional — uses OpenAI-compatible API)
  routerLlmBaseUrl: process.env.ROUTER_LLM_BASE_URL || '',
  routerLlmApiKey: process.env.ROUTER_LLM_API_KEY || '',
  routerLlmModel: process.env.ROUTER_LLM_MODEL || '',
  // Routing protection
  maxAgentChainDepth: parseInt(env('MAX_AGENT_CHAIN_DEPTH', '5'), 10),
  agentRateLimitWindow: parseInt(env('AGENT_RATE_LIMIT_WINDOW', '60'), 10),
  agentRateLimitMax: parseInt(env('AGENT_RATE_LIMIT_MAX', '20'), 10),
  // Periodic cleanup intervals (ms)
  orphanFileCheckInterval: parseInt(env('ORPHAN_FILE_CHECK_INTERVAL', '3600000'), 10),
  tokenCleanupInterval: parseInt(env('TOKEN_CLEANUP_INTERVAL', '3600000'), 10),
  // Client WebSocket rate limiting
  clientRateLimitWindow: parseInt(env('CLIENT_RATE_LIMIT_WINDOW', '10'), 10),
}

// Security check: refuse to start in production with default JWT secret
if (isProduction && config.jwtSecret === 'dev-secret-change-me') {
  log.fatal(
    'JWT_SECRET is set to the default value. Set a strong, random JWT_SECRET for production. Example: JWT_SECRET=$(openssl rand -base64 32)',
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
    log.fatal('REDIS_URL must be set in production.')
    process.exit(1)
  }
}

// Refuse to start with wide-open CORS in production
if (isProduction && config.corsOrigin === '*') {
  log.fatal(
    'CORS_ORIGIN is set to "*" in production. Set CORS_ORIGIN to your frontend domain (e.g. https://app.example.com).',
  )
  process.exit(1)
}
