-- jsonb columns: drop text default first, alter type, then set jsonb default
ALTER TABLE "agents" ALTER COLUMN "capabilities" SET DATA TYPE jsonb USING "capabilities"::jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "metadata" SET DATA TYPE jsonb USING "metadata"::jsonb;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "mentions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "mentions" SET DATA TYPE jsonb USING "mentions"::jsonb;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "mentions" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "chunks" SET DATA TYPE jsonb USING "chunks"::jsonb;--> statement-breakpoint
ALTER TABLE "routers" ALTER COLUMN "visibility_list" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "routers" ALTER COLUMN "visibility_list" SET DATA TYPE jsonb USING "visibility_list"::jsonb;--> statement-breakpoint
ALTER TABLE "routers" ALTER COLUMN "visibility_list" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
-- timestamptz columns (text → timestamptz implicit cast works for ISO 8601 strings)
ALTER TABLE "agents" ALTER COLUMN "last_seen_at" SET DATA TYPE timestamp with time zone USING "last_seen_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gateways" ALTER COLUMN "connected_at" SET DATA TYPE timestamp with time zone USING "connected_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gateways" ALTER COLUMN "disconnected_at" SET DATA TYPE timestamp with time zone USING "disconnected_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gateways" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_attachments" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_edits" ALTER COLUMN "edited_at" SET DATA TYPE timestamp with time zone USING "edited_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_reactions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "room_members" ALTER COLUMN "pinned_at" SET DATA TYPE timestamp with time zone USING "pinned_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "room_members" ALTER COLUMN "archived_at" SET DATA TYPE timestamp with time zone USING "archived_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "room_members" ALTER COLUMN "last_read_at" SET DATA TYPE timestamp with time zone USING "last_read_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "room_members" ALTER COLUMN "joined_at" SET DATA TYPE timestamp with time zone USING "joined_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "routers" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "routers" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "locked_until" SET DATA TYPE timestamp with time zone USING "locked_until"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_edits_message_edited_idx" ON "message_edits" USING btree ("message_id","edited_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routers_scope_creator_idx" ON "routers" USING btree ("scope","created_by_id");
