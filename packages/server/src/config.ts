function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

const isProduction = process.env.NODE_ENV === 'production'

export const config = {
  isProduction,
  port: parseInt(env('PORT', '3000'), 10),
  host: env('HOST', '0.0.0.0'),
  databasePath: env('DATABASE_PATH', './data/agentim.db'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  jwtAccessExpiry: env('JWT_ACCESS_EXPIRY', '15m'),
  jwtRefreshExpiry: env('JWT_REFRESH_EXPIRY', '7d'),
  corsOrigin: env('CORS_ORIGIN', isProduction ? '' : 'http://localhost:5173'),
}

// Security check: refuse to start in production with default JWT secret
if (isProduction && config.jwtSecret === 'dev-secret-change-me') {
  console.error(
    '\n[FATAL] JWT_SECRET is set to the default value.\n' +
      'Set a strong, random JWT_SECRET environment variable for production.\n' +
      'Example: JWT_SECRET=$(openssl rand -base64 32)\n',
  )
  process.exit(1)
}

if (!isProduction && config.jwtSecret === 'dev-secret-change-me') {
  console.warn('[WARN] Using default JWT_SECRET — do NOT use in production.')
}
