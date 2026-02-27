-- Add composite index for querying messages by sender with time ordering
CREATE INDEX IF NOT EXISTS "messages_sender_created_idx" ON "messages" ("sender_id", "created_at");

-- Fix service_agents.created_by_id FK to cascade on user deletion
-- (previously had no onDelete action, defaulting to RESTRICT)
ALTER TABLE "service_agents" DROP CONSTRAINT IF EXISTS "service_agents_created_by_id_users_id_fk";
ALTER TABLE "service_agents" ADD CONSTRAINT "service_agents_created_by_id_users_id_fk"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE;
