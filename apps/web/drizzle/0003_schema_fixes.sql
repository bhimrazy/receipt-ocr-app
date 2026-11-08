-- Hand-edited: lock_timeout first, and a USING on the receipt_date type change. drizzle-kit
-- runs every pending file in one transaction, so SET LOCAL covers this whole file.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DROP INDEX "receipts_last_attempt_at_idx";--> statement-breakpoint
DROP INDEX "member_organization_id_idx";--> statement-breakpoint
-- Written for an empty table: text that isn't a plausible YYYY-MM-DD day becomes null
-- instead of failing the cast (CASE branches run in order, so the cast never sees it).
ALTER TABLE "receipts" ALTER COLUMN "receipt_date" SET DATA TYPE date USING (
  CASE
    WHEN "receipt_date" !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN NULL
    WHEN substr("receipt_date", 9, 2)::int > extract(day from
      make_date(substr("receipt_date", 1, 4)::int, substr("receipt_date", 6, 2)::int, 1)
      + interval '1 month' - interval '1 day')::int THEN NULL
    WHEN "receipt_date"::date < '2000-01-01'
      OR "receipt_date"::date > ("created_at" at time zone 'UTC')::date + 1 THEN NULL
    ELSE "receipt_date"::date
  END
);--> statement-breakpoint
UPDATE "receipts" SET "currency" = upper(btrim("currency")) WHERE "currency" IS NOT NULL;--> statement-breakpoint
UPDATE "receipts" SET "currency" = NULL WHERE "currency" !~ '^[A-Z]{3}$';--> statement-breakpoint
ALTER TABLE "passkey" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_id_idx" ON "admin_audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "jobs_user_id_idx" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ocr_calls_user_id_idx" ON "ocr_calls" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ocr_rounds_organization_id_idx" ON "ocr_rounds" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "receipts_org_receipt_date_idx" ON "receipts" USING btree ("organization_id","receipt_date");--> statement-breakpoint
CREATE INDEX "invitation_inviter_id_idx" ON "invitation" USING btree ("inviter_id");--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_quantity_check" CHECK (quantity >= 1);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_receipt_date_check" CHECK (receipt_date >= '2000-01-01' and receipt_date <= (created_at at time zone 'UTC')::date + 1);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_currency_check" CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_attempts_check" CHECK (attempts between 1 and 3);
