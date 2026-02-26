-- Rollback migration 0030: remove bookmarks table
DROP INDEX IF EXISTS "bookmarks_created_at_idx";
DROP INDEX IF EXISTS "bookmarks_user_idx";
DROP TABLE IF EXISTS "bookmarks";
