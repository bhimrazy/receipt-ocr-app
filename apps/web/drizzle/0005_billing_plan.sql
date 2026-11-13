-- Hand-edited: the SET LOCAL lines and the backfill of paid_transaction_id.
-- A constant DEFAULT on ADD COLUMN is stored in the catalog (no table rewrite), and every existing row linked at a Pro
-- price, so 'pro' is right for all of them.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
SET LOCAL statement_timeout = '10s';--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "plan" text DEFAULT 'pro' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "paid_transaction_id" text;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "paid_period_start" timestamp with time zone;--> statement-breakpoint
-- The checkout transaction paid the first period. The period start stays null, so the next renewal replaces it.
UPDATE "billing_subscriptions" s SET "paid_transaction_id" = c."provider_transaction_id"
FROM "billing_checkouts" c
WHERE c."provider" = s."provider" AND c."provider_subscription_id" = s."provider_subscription_id";
