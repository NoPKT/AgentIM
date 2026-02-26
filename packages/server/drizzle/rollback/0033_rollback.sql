-- Rollback migration 0033: remove revoked_tokens table
DROP INDEX IF EXISTS "revoked_tokens_token_hash_idx";
DROP INDEX IF EXISTS "revoked_tokens_expires_at_idx";
DROP INDEX IF EXISTS "revoked_tokens_user_id_idx";
DROP TABLE IF EXISTS "revoked_tokens";
