-- Rollback 0034: remove unique name indexes
DROP INDEX IF EXISTS "routers_name_creator_idx";
DROP INDEX IF EXISTS "service_agents_name_creator_idx";
