import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import * as schema from './schema.js'

const log = createLogger('DB')

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

// Prevent idle-client errors from crashing the process as uncaughtException
pool.on('error', (err) => {
  log.error(`Idle PostgreSQL client error: ${err.message}`)
})

export const db = drizzle(pool, { schema })

export async function migrate() {
  const migrationsFolder = resolve(import.meta.dirname, '../../drizzle')
  await drizzleMigrate(db, { migrationsFolder })
}

export async function closeDb() {
  await pool.end()
}
