-- Rollback for 0026_add_agent_command_role.sql
-- Drops the agent_command_role column from rooms.

ALTER TABLE "rooms" DROP COLUMN IF EXISTS "agent_command_role";
