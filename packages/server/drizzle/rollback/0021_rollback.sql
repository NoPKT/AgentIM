-- Rollback for 0021_fix_attachment_fk_on_delete.sql
-- Reverts the message_attachments.uploaded_by FK from "ON DELETE set null"
-- back to the original "ON DELETE no action" (the implicit default).

ALTER TABLE "message_attachments" DROP CONSTRAINT "message_attachments_uploaded_by_users_id_fk";
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_uploaded_by_users_id_fk"
  FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
