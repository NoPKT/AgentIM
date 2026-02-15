ALTER TABLE "agents" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
CREATE INDEX "agents_visibility_idx" ON "agents" USING btree ("visibility");