-- Hand-edited: the SET LOCAL lines and the backfill. Dropping a column default is a catalog-only change.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
SET LOCAL statement_timeout = '10s';--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ALTER COLUMN "plan" DROP DEFAULT;--> statement-breakpoint
-- Rows linked before 0005: their paid transaction is taken to pay the stored period, so the next one counts as newer.
UPDATE "billing_subscriptions" SET "paid_period_start" = "current_period_start"
WHERE "paid_period_start" IS NULL AND "current_period_start" IS NOT NULL;
