-- Rollback migration 0028: remove service_agents table
DROP INDEX IF EXISTS "service_agents_name_idx";
DROP INDEX IF EXISTS "service_agents_status_idx";
DROP TABLE IF EXISTS "service_agents";
