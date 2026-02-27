ALTER TABLE "users" DROP COLUMN IF EXISTS "totp_secret";
ALTER TABLE "users" DROP COLUMN IF EXISTS "totp_enabled";
ALTER TABLE "users" DROP COLUMN IF EXISTS "totp_backup_codes";
