-- Rollback 0035: Revert timestamp columns back to TEXT with DEFAULT now()
-- Reverses 0035_fix_timestamp_column_types.sql

ALTER TABLE "service_agents"
  ALTER COLUMN "created_at" TYPE text USING "created_at"::text,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" TYPE text USING "updated_at"::text,
  ALTER COLUMN "updated_at" SET DEFAULT now();

ALTER TABLE "bookmarks"
  ALTER COLUMN "created_at" TYPE text USING "created_at"::text,
  ALTER COLUMN "created_at" SET DEFAULT now();
