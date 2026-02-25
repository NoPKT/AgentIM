import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import * as schema from './schema.js'

const log = createLogger('DB')

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolSize ?? 20,
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

/**
 * Verify that the database schema is up to date by checking the drizzle
 * migrations journal against the __drizzle_migrations table. Logs a warning
 * if pending migrations are detected (e.g. when RUN_MIGRATIONS=false on a
 * stale database).
 */
export async function verifyMigrations(): Promise<void> {
  try {
    const { readFileSync } = await import('node:fs')
    const journalPath = resolve(import.meta.dirname, '../../drizzle/meta/_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
      entries: Array<{ idx: number; tag: string }>
    }
    const expectedCount = journal.entries.length

    const result = await db.execute(sql`SELECT COUNT(*)::int AS count FROM __drizzle_migrations`)
    const appliedCount = (result.rows[0] as { count: number }).count

    if (appliedCount < expectedCount) {
      log.warn(
        `Database schema is behind: ${appliedCount}/${expectedCount} migrations applied. ` +
          `Run migrations or set RUN_MIGRATIONS=true to auto-migrate on startup.`,
      )
    } else {
      log.info(`Database schema verified: ${appliedCount} migration(s) applied`)
    }
  } catch {
    // Table may not exist on a fresh database — migrations will create it
    log.debug('Could not verify migration status (database may be uninitialized)')
  }
}

export async function closeDb() {
  await pool.end()
}
