ALTER TABLE "agents" ADD COLUMN "capabilities" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "connection_type" text DEFAULT 'cli' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_members" ADD COLUMN "role_description" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "system_prompt" text;