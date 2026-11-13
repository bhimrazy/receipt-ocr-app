-- Hand-edited: the SET LOCAL line. Dropping a column default is a catalog-only change (no rewrite, no scan).
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ALTER COLUMN "plan" DROP DEFAULT;
