CREATE INDEX IF NOT EXISTS "room_members_pinned_idx" ON "room_members" USING btree ("member_id","pinned_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_members_archived_idx" ON "room_members" USING btree ("member_id","archived_at");
