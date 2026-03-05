ALTER TABLE "agents" ADD COLUMN "visibility_list" jsonb NOT NULL DEFAULT '[]';
UPDATE "agents" SET "visibility" = 'all' WHERE "visibility" = 'shared';
