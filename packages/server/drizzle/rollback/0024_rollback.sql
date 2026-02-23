-- Rollback for 0024_lush_captain_midlands.sql
-- Drops the push_subscriptions table and its indexes.

DROP INDEX IF EXISTS "push_subscriptions_endpoint_idx";
DROP INDEX IF EXISTS "push_subscriptions_user_idx";
DROP TABLE IF EXISTS "push_subscriptions";
