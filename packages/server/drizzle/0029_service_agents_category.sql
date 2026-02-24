ALTER TABLE "service_agents" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'chat' NOT NULL;
UPDATE "service_agents" SET "category" = 'chat' WHERE "type" = 'openai-compatible';
UPDATE "service_agents" SET "type" = 'openai-chat' WHERE "type" = 'openai-compatible';
