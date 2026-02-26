-- Rollback migration 0032: remove service_agents created_by index
DROP INDEX IF EXISTS "service_agents_created_by_idx";
