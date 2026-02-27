-- Rollback 0037: remove sender_created index and revert FK to no-action
DROP INDEX IF EXISTS "messages_sender_created_idx";

ALTER TABLE "service_agents" DROP CONSTRAINT IF EXISTS "service_agents_created_by_id_users_id_fk";
ALTER TABLE "service_agents" ADD CONSTRAINT "service_agents_created_by_id_users_id_fk"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id");
