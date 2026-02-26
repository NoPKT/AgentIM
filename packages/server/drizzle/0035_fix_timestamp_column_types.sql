-- 0035: Fix timestamp column types for consistency
--
-- service_agents and bookmarks tables used TEXT columns for created_at/updated_at,
-- while all other tables use TIMESTAMPTZ via the ts() helper. This migration
-- aligns the column types for consistency, correct sorting, and timezone awareness.

ALTER TABLE "service_agents"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at"::timestamptz,
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at"::timestamptz,
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "bookmarks"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at"::timestamptz,
  ALTER COLUMN "created_at" DROP DEFAULT;
