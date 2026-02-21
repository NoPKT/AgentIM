-- Rollback for 0019_little_blazing_skull.sql
-- Removes the indexes added by migration 0019.

DROP INDEX IF EXISTS "audit_logs_target_idx";
DROP INDEX IF EXISTS "attachments_uploaded_by_idx";
