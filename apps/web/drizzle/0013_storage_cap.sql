-- Hand-edited: the SET LOCAL lines, the comments, the emptiness check, and no CASCADE on the drop, so an unexpected
-- row or dependent object fails the migration instead of going with it. `user_credentials` was never read or
-- written. Both columns are
-- nullable with no default, so adding them changes only the catalog; the CHECK scans receipts once under the
-- ALTER's lock (every value is null), which is short while receipts is small. `receipt.file_size_backfill` fills
-- `file_bytes` for existing rows after the deploy.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "user_credentials") THEN RAISE EXCEPTION 'user_credentials is not empty'; END IF; END $$;--> statement-breakpoint
DROP TABLE "user_credentials";--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "file_bytes" integer;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "file_meta" jsonb;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_file_bytes_check" CHECK (file_bytes >= 0);
