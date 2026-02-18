ALTER TABLE "users" ADD COLUMN "max_ws_connections" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "max_gateways" integer;--> statement-breakpoint
CREATE INDEX "agents_last_seen_idx" ON "agents" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "messages_updated_at_idx" ON "messages" USING btree ("updated_at");