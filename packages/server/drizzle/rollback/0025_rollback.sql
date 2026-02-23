-- Rollback for 0025_add_pinned_archived_indexes.sql
-- Drops the pinned and archived indexes on room_members.

DROP INDEX IF EXISTS "room_members_pinned_idx";
DROP INDEX IF EXISTS "room_members_archived_idx";
