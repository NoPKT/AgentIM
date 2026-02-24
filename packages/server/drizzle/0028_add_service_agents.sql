CREATE TABLE IF NOT EXISTS "service_agents" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "type" text DEFAULT 'openai-compatible' NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "config_encrypted" text NOT NULL,
  "avatar_url" text,
  "created_by_id" text NOT NULL REFERENCES "users"("id"),
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "service_agents_name_idx" ON "service_agents" ("name");
CREATE INDEX IF NOT EXISTS "service_agents_status_idx" ON "service_agents" ("status");
