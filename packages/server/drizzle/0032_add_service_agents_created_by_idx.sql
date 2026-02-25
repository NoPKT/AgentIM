-- Add index on service_agents.created_by_id for efficient per-user queries
CREATE INDEX IF NOT EXISTS "service_agents_created_by_idx" ON "service_agents" ("created_by_id");
