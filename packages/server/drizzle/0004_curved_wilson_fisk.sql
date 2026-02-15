ALTER TABLE "message_attachments" ALTER COLUMN "message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "created_at" text NOT NULL;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;