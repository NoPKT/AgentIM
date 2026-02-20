/**
 * Database backup script — runs pg_dump before migrations.
 *
 * Usage:
 *   pnpm --filter @agentim/server db:backup
 *
 * Requires `pg_dump` to be available on PATH.
 * Backup files are stored in ./backups/ with a timestamp.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/agentim'
const backupDir = resolve(import.meta.dirname, '../../../backups')

if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true })
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupFile = resolve(backupDir, `agentim-${timestamp}.sql`)

console.log(`Backing up database to ${backupFile} ...`)

try {
  execSync(`pg_dump "${databaseUrl}" --no-owner --no-acl > "${backupFile}"`, {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  console.log(`Backup complete: ${backupFile}`)
} catch (err: unknown) {
  console.error(`Backup failed: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
