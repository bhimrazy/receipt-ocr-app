-- Hand-written: lock_timeout first, so the ALTERs give up rather than queue behind live traffic.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_reviewed_by_idx" ON "receipts" USING btree ("reviewed_by") WHERE reviewed_by is not null;