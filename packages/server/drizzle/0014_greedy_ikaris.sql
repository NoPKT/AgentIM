CREATE TABLE "routers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" text DEFAULT 'personal' NOT NULL,
	"created_by_id" text NOT NULL,
	"llm_base_url" text NOT NULL,
	"llm_api_key" text NOT NULL,
	"llm_model" text NOT NULL,
	"max_chain_depth" integer DEFAULT 5 NOT NULL,
	"rate_limit_window" integer DEFAULT 60 NOT NULL,
	"rate_limit_max" integer DEFAULT 20 NOT NULL,
	"visibility" text DEFAULT 'all' NOT NULL,
	"visibility_list" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "router_id" text;--> statement-breakpoint
ALTER TABLE "routers" ADD CONSTRAINT "routers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routers_created_by_idx" ON "routers" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "routers_scope_idx" ON "routers" USING btree ("scope");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_reply_to_idx" ON "messages" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "rooms_created_by_idx" ON "rooms" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "tasks_room_status_idx" ON "tasks" USING btree ("room_id","status");--> statement-breakpoint
CREATE INDEX "tasks_updated_at_idx" ON "tasks" USING btree ("updated_at");