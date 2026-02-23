-- Enable the pg_trgm extension for trigram-based text search.
-- This dramatically speeds up ILIKE pattern matching on large tables.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on messages.content for fast ILIKE search.
-- Supports the existing /messages/search endpoint without code changes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_content_trgm_idx
  ON messages USING GIN (content gin_trgm_ops);
