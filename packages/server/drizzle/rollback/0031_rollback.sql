-- Rollback migration 0031: remove result and due_date columns from tasks
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "due_date";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "result";
