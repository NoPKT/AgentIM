UPDATE "agents" SET "visibility" = 'shared' WHERE "visibility" = 'all';
ALTER TABLE "agents" DROP COLUMN IF EXISTS "visibility_list";
