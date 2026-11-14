-- Hand-written, data only. The account hooks stop new provider tokens being written; this clears the ones already
-- stored.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
UPDATE "account" SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL, "access_token_expires_at" = NULL, "refresh_token_expires_at" = NULL
WHERE "access_token" IS NOT NULL OR "refresh_token" IS NOT NULL OR "id_token" IS NOT NULL OR "access_token_expires_at" IS NOT NULL OR "refresh_token_expires_at" IS NOT NULL;
