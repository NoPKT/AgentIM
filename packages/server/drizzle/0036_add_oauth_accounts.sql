CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "email" text,
  "display_name" text,
  "avatar_url" text,
  "access_token" text,
  "refresh_token" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_provider_account_idx" ON "oauth_accounts" ("provider", "provider_account_id");
CREATE INDEX IF NOT EXISTS "oauth_user_idx" ON "oauth_accounts" ("user_id");

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
