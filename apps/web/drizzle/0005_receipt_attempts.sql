ALTER TABLE "receipts" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "last_attempt_at" timestamp with time zone;