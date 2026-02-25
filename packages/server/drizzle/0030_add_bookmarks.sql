CREATE TABLE IF NOT EXISTS "bookmarks" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "note" text DEFAULT '',
  "created_at" text DEFAULT (now()) NOT NULL,
  CONSTRAINT "bookmarks_user_message_unique" UNIQUE("user_id", "message_id")
);

CREATE INDEX "bookmarks_user_idx" ON "bookmarks" ("user_id");
CREATE INDEX "bookmarks_created_at_idx" ON "bookmarks" ("user_id", "created_at");
