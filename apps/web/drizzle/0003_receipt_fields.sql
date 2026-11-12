-- Hand-edited: the SET LOCAL lines, NOT VALID on every CHECK (validated in the next migration) and the two backfills.
-- Every new column is nullable or has a constant default, so the ALTERs change only the catalog.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
-- The backfills scan receipts and receipt_items once each: milliseconds at today's volume.
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "receipt_date_calendar" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "discount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "service_charge" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "merchant_tax_id" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "review_reasons" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_position_check" CHECK (position >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_receipt_date_calendar_check" CHECK (receipt_date_calendar in ('gregory', 'bikram-sambat')) NOT VALID;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_number_check" CHECK (char_length(invoice_number) between 1 and 64) NOT VALID;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_merchant_tax_id_check" CHECK (char_length(merchant_tax_id) between 1 and 32) NOT VALID;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_discount_check" CHECK (discount >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_service_charge_check" CHECK (service_charge >= 0) NOT VALID;--> statement-breakpoint
-- Receipts the old rule (confidence below 0.9) flags stay flagged under the new one. Idempotent.
UPDATE "receipts" SET "review_reasons" = '{low_confidence}'
  WHERE "status" = 'completed' AND "confidence" < 0.9 AND "review_reasons" = '{}';--> statement-breakpoint
-- Freeze the line order people see today. Items are inserted in printed order and never updated, and the read
-- returns a receipt's rows in physical (ctid) order. Only receipts not yet numbered, so a second run (whose ctids
-- this UPDATE has moved) changes nothing.
UPDATE "receipt_items" i SET "position" = o.n
  FROM (
    SELECT id, row_number() OVER (PARTITION BY receipt_id ORDER BY ctid) - 1 AS n FROM "receipt_items"
    WHERE receipt_id IN (
      SELECT receipt_id FROM "receipt_items" GROUP BY receipt_id HAVING count(*) > 1 AND max("position") = 0
    )
  ) o
  WHERE o.id = i.id AND o.n <> 0;
