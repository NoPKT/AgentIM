-- Rollback: remove the trigram GIN index on messages.content
DROP INDEX IF EXISTS messages_content_trgm_idx;

-- Note: We intentionally do NOT drop the pg_trgm extension
-- as other parts of the system may depend on it.
