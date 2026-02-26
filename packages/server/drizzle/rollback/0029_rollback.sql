-- Rollback migration 0029: revert service_agents category and type changes
UPDATE "service_agents" SET "type" = 'openai-compatible' WHERE "type" = 'openai-chat';
ALTER TABLE "service_agents" DROP COLUMN IF EXISTS "category";
