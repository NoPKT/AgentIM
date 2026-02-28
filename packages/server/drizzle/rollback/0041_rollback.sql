-- Rollback 0041_add_gateway_ephemeral.sql
-- Drops the "ephemeral" column from "gateways"
ALTER TABLE "gateways" DROP COLUMN IF EXISTS "ephemeral";
