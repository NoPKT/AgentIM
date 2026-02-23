-- Enable the pg_trgm extension for trigram-based text search.
-- This dramatically speeds up ILIKE pattern matching on large tables.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on messages.content for fast ILIKE search.
-- Supports the existing /messages/search endpoint without code changes.
-- Note: cannot use CONCURRENTLY here because Drizzle runs migrations inside
-- a transaction, and CREATE INDEX CONCURRENTLY cannot run in a transaction.
CREATE INDEX IF NOT EXISTS messages_content_trgm_idx
  ON messages USING GIN (content gin_trgm_ops);
