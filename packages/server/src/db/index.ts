import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config.js'
import * as schema from './schema.js'

const dbPath = config.databasePath

// Ensure directory exists
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

// Auto-migrate: create tables if they don't exist
export function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS refresh_tokens_hash_idx ON refresh_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS gateways (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      hostname TEXT,
      platform TEXT,
      arch TEXT,
      node_version TEXT,
      connected_at TEXT,
      disconnected_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS gateways_user_idx ON gateways(user_id);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      gateway_id TEXT NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
      working_directory TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS agents_gateway_idx ON agents(gateway_id);
    CREATE INDEX IF NOT EXISTS agents_status_idx ON agents(status);

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'group',
      broadcast_mode INTEGER NOT NULL DEFAULT 0,
      created_by_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL,
      member_type TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS room_members_room_idx ON room_members(room_id);
    CREATE INDEX IF NOT EXISTS room_members_member_idx ON room_members(member_id);
    CREATE UNIQUE INDEX IF NOT EXISTS room_members_unique_idx ON room_members(room_id, member_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      reply_to_id TEXT,
      mentions TEXT NOT NULL DEFAULT '[]',
      chunks TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS messages_room_idx ON messages(room_id);
    CREATE INDEX IF NOT EXISTS messages_room_created_idx ON messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages(sender_id);

    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      url TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS attachments_message_idx ON message_attachments(message_id);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      assignee_id TEXT,
      assignee_type TEXT,
      created_by_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS tasks_room_idx ON tasks(room_id);
    CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
  `)

  // Incremental migrations for existing databases
  try {
    sqlite.exec(`ALTER TABLE messages ADD COLUMN chunks TEXT`)
  } catch {
    // Column already exists — ignore
  }
}
