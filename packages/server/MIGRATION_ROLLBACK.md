# Database Migration Rollback Guide

## Overview

AgentIM uses Drizzle Kit for forward-only migrations. Each `.sql` file in `drizzle/` is an *up* migration applied automatically on server startup. This document describes how to roll back migrations when a production deployment fails.

## Rollback Principles

1. **Test rollbacks in staging first** — never run a rollback for the first time in production.
2. **Take a database snapshot before rolling back** using `pnpm db:backup` (or your cloud provider's snapshot tool).
3. **Apply rollbacks in reverse order** — if migrations 0025 and 0026 were applied, roll back 0026 first, then 0025.
4. **Update Drizzle's migration tracking table** after manually running a rollback SQL so that `drizzle-kit` does not try to re-apply the rolled-back migration on the next startup.

## Rollback Coverage Policy

Rollback scripts are maintained for **recent migrations** (0019 onwards, including 0027–0037). Migrations 0000–0018 established the foundational schema; rolling those back would effectively require dropping the entire database. For those, use a full database backup (see "Emergency restore" below).

## Rollback Files

Pre-written down migrations are in `drizzle/rollback/`:

| File | Reverses |
|------|----------|
| `0026_rollback.sql` | `0026_add_agent_command_role.sql` — drops `agent_command_role` column from `rooms` |
| `0025_rollback.sql` | `0025_add_pinned_archived_indexes.sql` — drops `room_members_pinned_idx` and `room_members_archived_idx` indexes |
| `0024_rollback.sql` | `0024_lush_captain_midlands.sql` — drops `push_subscriptions` table |
| `0023_rollback.sql` | `0023_jittery_archangel.sql` — reverts `timestamptz` → `text` and `jsonb` → `text` column type changes, drops added indexes |
| `0022_rollback.sql` | `0022_admin_settings.sql` — drops `settings` table |
| `0021_rollback.sql` | `0021_fix_attachment_fk_on_delete.sql` — reverts `message_attachments.uploaded_by` FK ON DELETE from `set null` → `no action` |
| `0020_rollback.sql` | `0020_perpetual_stark_industries.sql` — drops `max_ws_connections` / `max_gateways` columns from `users` and their associated indexes |
| `0019_rollback.sql` | `0019_little_blazing_skull.sql` — drops `audit_logs_target_idx` and `attachments_uploaded_by_idx` indexes |
| `0027_rollback.sql` | `0027_add_fulltext_search_index.sql` — drops full-text search index |
| `0028_rollback.sql` | `0028_add_service_agents.sql` — drops `service_agents` table and its indexes |
| `0029_rollback.sql` | `0029_service_agents_category.sql` — reverts `openai-chat` → `openai-compatible` type rename and drops `category` column |
| `0030_rollback.sql` | `0030_add_bookmarks.sql` — drops `bookmarks` table and its indexes |
| `0031_rollback.sql` | `0031_add_task_result_duedate.sql` — drops `result` and `due_date` columns from `tasks` |
| `0032_rollback.sql` | `0032_add_service_agents_created_by_idx.sql` — drops `service_agents_created_by_idx` index |
| `0033_rollback.sql` | `0033_add_revoked_tokens.sql` — drops `revoked_tokens` table and its indexes |
| `0034_rollback.sql` | `0034_add_unique_name_indexes.sql` — drops unique composite indexes on `routers` and `service_agents` |
| `0035_rollback.sql` | `0035_fix_timestamp_column_types.sql` — reverts `service_agents` and `bookmarks` timestamp columns from `timestamptz` back to `text` |
| `0037_rollback.sql` | `0037_add_sender_created_idx_and_fix_fk.sql` — drops `messages_sender_created_idx` index and reverts `service_agents.created_by_id` FK back to no-action |
| `0041_rollback.sql` | `0041_add_gateway_ephemeral.sql` — drops `ephemeral` column from `gateways` |

## Step-by-Step Rollback Procedure

```bash
# 1. Take a snapshot / backup before doing anything
pnpm --filter @agentim/server db:backup

# 2. Apply the rollback SQL (example: rolling back 0026)
psql "$DATABASE_URL" -f packages/server/drizzle/rollback/0026_rollback.sql

# 3. Remove the rolled-back migration from Drizzle's journal so it won't
#    be re-applied on the next server start. The journal is stored in the
#    __drizzle_migrations table.
psql "$DATABASE_URL" -c "
  DELETE FROM drizzle.__drizzle_migrations
  WHERE name = '0026_add_agent_command_role';
"

# 4. Verify the schema is in the expected state
psql "$DATABASE_URL" -c "\d rooms"

# 5. Deploy the previous server image / tag that matches the rolled-back schema
```

## Writing New Rollback Files

For every new migration added to `drizzle/`, create a corresponding rollback in `drizzle/rollback/` following the naming convention `<migration_number>_rollback.sql`. The rollback SQL must be idempotent (use `IF EXISTS` where possible).

General rules:
- `ADD COLUMN` → `DROP COLUMN IF EXISTS`
- `CREATE INDEX` → `DROP INDEX IF EXISTS`
- `ADD CONSTRAINT` → `DROP CONSTRAINT` + `ADD CONSTRAINT` (with original definition)
- `DROP COLUMN` → manually restore from the original migration (complex; avoid in production schemas)

## Emergency Restore (Migrations 0000–0018)

For rollbacks affecting foundational schema (0000–0018), restore from the last known-good backup:

```bash
# Stop all application instances first, then:
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" < backup_YYYYMMDD_HHMMSS.sql
```
