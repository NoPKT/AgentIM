-- Rollback migration 0023: revert timestamptz → text, jsonb → text
-- Run this BEFORE reverting the application code.

-- Revert jsonb columns back to text
ALTER TABLE "agents" ALTER COLUMN "capabilities" SET DATA TYPE text USING "capabilities"::text;
ALTER TABLE "audit_logs" ALTER COLUMN "metadata" SET DATA TYPE text USING "metadata"::text;
ALTER TABLE "messages" ALTER COLUMN "mentions" SET DATA TYPE text USING "mentions"::text;
ALTER TABLE "messages" ALTER COLUMN "mentions" SET DEFAULT '[]';
ALTER TABLE "messages" ALTER COLUMN "chunks" SET DATA TYPE text USING "chunks"::text;
ALTER TABLE "routers" ALTER COLUMN "visibility_list" SET DATA TYPE text USING "visibility_list"::text;
ALTER TABLE "routers" ALTER COLUMN "visibility_list" SET DEFAULT '[]';

-- Revert timestamptz columns back to text
ALTER TABLE "agents" ALTER COLUMN "last_seen_at" SET DATA TYPE text USING "last_seen_at"::text;
ALTER TABLE "agents" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "agents" ALTER COLUMN "updated_at" SET DATA TYPE text USING "updated_at"::text;
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "gateways" ALTER COLUMN "connected_at" SET DATA TYPE text USING "connected_at"::text;
ALTER TABLE "gateways" ALTER COLUMN "disconnected_at" SET DATA TYPE text USING "disconnected_at"::text;
ALTER TABLE "gateways" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "message_attachments" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "message_edits" ALTER COLUMN "edited_at" SET DATA TYPE text USING "edited_at"::text;
ALTER TABLE "message_reactions" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "messages" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "messages" ALTER COLUMN "updated_at" SET DATA TYPE text USING "updated_at"::text;
ALTER TABLE "refresh_tokens" ALTER COLUMN "expires_at" SET DATA TYPE text USING "expires_at"::text;
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "room_members" ALTER COLUMN "pinned_at" SET DATA TYPE text USING "pinned_at"::text;
ALTER TABLE "room_members" ALTER COLUMN "archived_at" SET DATA TYPE text USING "archived_at"::text;
ALTER TABLE "room_members" ALTER COLUMN "last_read_at" SET DATA TYPE text USING "last_read_at"::text;
ALTER TABLE "room_members" ALTER COLUMN "joined_at" SET DATA TYPE text USING "joined_at"::text;
ALTER TABLE "rooms" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "rooms" ALTER COLUMN "updated_at" SET DATA TYPE text USING "updated_at"::text;
ALTER TABLE "routers" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "routers" ALTER COLUMN "updated_at" SET DATA TYPE text USING "updated_at"::text;
ALTER TABLE "tasks" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "tasks" ALTER COLUMN "updated_at" SET DATA TYPE text USING "updated_at"::text;
ALTER TABLE "users" ALTER COLUMN "locked_until" SET DATA TYPE text USING "locked_until"::text;
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE text USING "created_at"::text;
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DATA TYPE text USING "updated_at"::text;
ALTER TABLE "settings" ALTER COLUMN "updated_at" SET DATA TYPE text USING "updated_at"::text;

-- Drop indexes that were added in 0023 (these might not have existed before)
DROP INDEX IF EXISTS "message_edits_message_edited_idx";
DROP INDEX IF EXISTS "refresh_tokens_expires_idx";
DROP INDEX IF EXISTS "routers_scope_creator_idx";

-- Remove migration record
DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '0023_jittery_archangel';
