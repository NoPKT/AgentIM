-- Rollback for 0020_perpetual_stark_industries.sql
-- Removes the indexes and columns added by migration 0020.

DROP INDEX IF EXISTS "agents_last_seen_idx";
DROP INDEX IF EXISTS "messages_updated_at_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "max_ws_connections";
ALTER TABLE "users" DROP COLUMN IF EXISTS "max_gateways";
