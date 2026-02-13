function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

export const config = {
  port: parseInt(env('PORT', '3000'), 10),
  host: env('HOST', '0.0.0.0'),
  databasePath: env('DATABASE_PATH', './data/agentim.db'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  jwtAccessExpiry: env('JWT_ACCESS_EXPIRY', '15m'),
  jwtRefreshExpiry: env('JWT_REFRESH_EXPIRY', '7d'),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5173'),
}
