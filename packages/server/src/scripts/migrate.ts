/**
 * Database migration script with optional pre-migration backup.
 *
 * Usage:
 *   pnpm --filter @agentim/server db:migrate
 *   pnpm --filter @agentim/server db:migrate -- --backup   # backup before migrating
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { createLogger } from '../lib/logger.js'

const log = createLogger('Migrate')

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/agentim'

const shouldBackup = process.argv.includes('--backup')

if (shouldBackup) {
  log.info('Running pre-migration backup...')
  try {
    execSync('tsx src/scripts/backup.ts', {
      cwd: resolve(import.meta.dirname, '../..'),
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    })
  } catch {
    log.error('Backup failed — aborting migration.')
    process.exit(1)
  }
}

const pool = new pg.Pool({ connectionString: databaseUrl })
const db = drizzle(pool)

log.info('Running migrations...')

try {
  const migrationsFolder = resolve(import.meta.dirname, '../../../drizzle')
  await migrate(db, { migrationsFolder })
  log.info('Migrations complete.')
} catch (err: unknown) {
  log.error(`Migration failed: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
} finally {
  await pool.end()
}
