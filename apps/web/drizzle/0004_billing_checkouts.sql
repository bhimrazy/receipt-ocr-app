-- Hand-edited: the SET LOCAL lines, the VALIDATEs of the 0003 CHECKs, the repeated 0003 backfill, and the order
-- (receipts work first, so the FK locks on "user" and "organization" are held only for the last few statements).
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
-- The VALIDATEs and the backfill scan receipts and receipt_items once each: milliseconds at today's volume.
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- VALIDATE takes SHARE UPDATE EXCLUSIVE: reads and writes on the table go on while it scans.
ALTER TABLE "receipt_items" VALIDATE CONSTRAINT "receipt_items_position_check";--> statement-breakpoint
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_receipt_date_calendar_check";--> statement-breakpoint
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_invoice_number_check";--> statement-breakpoint
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_merchant_tax_id_check";--> statement-breakpoint
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_discount_check";--> statement-breakpoint
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_service_charge_check";--> statement-breakpoint
-- The 0003 backfill again, for receipts completed by pre-0003 code between that migration and its deploy. Idempotent.
UPDATE "receipts" SET "review_reasons" = '{low_confidence}'
  WHERE "status" = 'completed' AND "confidence" < 0.9 AND "review_reasons" = '{}';--> statement-breakpoint
CREATE TABLE "billing_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"price_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_checkouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkouts_provider_transaction_idx" ON "billing_checkouts" USING btree ("provider","provider_transaction_id");--> statement-breakpoint
CREATE INDEX "billing_checkouts_user_idx" ON "billing_checkouts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_checkouts_org_idx" ON "billing_checkouts" USING btree ("organization_id");--> statement-breakpoint
-- The table is empty, so each FK validates at once; SHARE ROW EXCLUSIVE on the parent until commit.
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
