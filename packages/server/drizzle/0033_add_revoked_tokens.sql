CREATE TABLE IF NOT EXISTS "revoked_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "revoked_tokens_user_id_idx" ON "revoked_tokens" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "revoked_tokens_expires_at_idx" ON "revoked_tokens" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "revoked_tokens_token_hash_idx" ON "revoked_tokens" USING btree ("token_hash");
