# Database Migration Rollback Guide

## Overview

AgentIM uses Drizzle Kit for forward-only migrations. Each `.sql` file in `drizzle/` is an *up* migration applied automatically on server startup. This document describes how to roll back migrations when a production deployment fails.

## Rollback Principles

1. **Test rollbacks in staging first** — never run a rollback for the first time in production.
2. **Take a database snapshot before rolling back** using `pnpm db:backup` (or your cloud provider's snapshot tool).
3. **Apply rollbacks in reverse order** — if migrations 0020 and 0021 were applied, roll back 0021 first, then 0020.
4. **Update Drizzle's migration tracking table** after manually running a rollback SQL so that `drizzle-kit` does not try to re-apply the rolled-back migration on the next startup.

## Rollback Files

Pre-written down migrations for the three most recent schema changes are in `drizzle/rollback/`:

| File | Reverses |
|------|----------|
| `0021_rollback.sql` | `0021_fix_attachment_fk_on_delete.sql` — reverts `message_attachments.uploaded_by` FK ON DELETE from `set null` → `no action` |
| `0020_rollback.sql` | `0020_perpetual_stark_industries.sql` — drops `max_ws_connections` / `max_gateways` columns from `users` and their associated indexes |
| `0019_rollback.sql` | `0019_little_blazing_skull.sql` — drops `audit_logs_target_idx` and `attachments_uploaded_by_idx` indexes |

## Step-by-Step Rollback Procedure

```bash
# 1. Take a snapshot / backup before doing anything
pnpm --filter @agentim/server db:backup

# 2. Apply the rollback SQL (example: rolling back 0021)
psql "$DATABASE_URL" -f packages/server/drizzle/rollback/0021_rollback.sql

# 3. Remove the rolled-back migration from Drizzle's journal so it won't
#    be re-applied on the next server start. The journal is stored in the
#    __drizzle_migrations table.
psql "$DATABASE_URL" -c "
  DELETE FROM drizzle.__drizzle_migrations
  WHERE name = '0021_fix_attachment_fk_on_delete';
"

# 4. Verify the schema is in the expected state
psql "$DATABASE_URL" -c "\d message_attachments"

# 5. Deploy the previous server image / tag that matches the rolled-back schema
```

## Writing New Rollback Files

For every new migration added to `drizzle/`, create a corresponding rollback in `drizzle/rollback/` following the naming convention `<migration_number>_rollback.sql`. The rollback SQL must be idempotent (use `IF EXISTS` where possible).

General rules:
- `ADD COLUMN` → `DROP COLUMN IF EXISTS`
- `CREATE INDEX` → `DROP INDEX IF EXISTS`
- `ADD CONSTRAINT` → `DROP CONSTRAINT` + `ADD CONSTRAINT` (with original definition)
- `DROP COLUMN` → manually restore from the original migration (complex; avoid in production schemas)
