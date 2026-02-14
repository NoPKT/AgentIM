import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'
import { config } from '../config.js'
import * as schema from './schema.js'

const pool = new pg.Pool({ connectionString: config.databaseUrl })

export const db = drizzle(pool, { schema })

export async function migrate() {
  const migrationsFolder = resolve(import.meta.dirname, '../../drizzle')
  await drizzleMigrate(db, { migrationsFolder })
}

export async function closeDb() {
  await pool.end()
}
