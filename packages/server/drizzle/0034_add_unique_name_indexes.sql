-- Add unique indexes to prevent duplicate names per creator
-- routers: (name, created_by_id) must be unique
-- service_agents: (name, created_by_id) must be unique

CREATE UNIQUE INDEX IF NOT EXISTS "routers_name_creator_idx"
  ON "routers" ("name", "created_by_id");

CREATE UNIQUE INDEX IF NOT EXISTS "service_agents_name_creator_idx"
  ON "service_agents" ("name", "created_by_id");
