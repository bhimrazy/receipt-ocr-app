-- Hand-edited: the SET LOCAL lines and the comments. The column is nullable with no default, so adding it changes
-- only the catalog. The index is built inline (drizzle-kit runs migrations in a transaction, so not CONCURRENTLY):
-- receipts is small before launch.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "duplicate_dismissed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "receipts_org_invoice_key_idx" ON "receipts" USING btree ("organization_id",nullif(upper(regexp_replace(translate(normalize("invoice_number", NFKC), '०१२३४५६७८९', '0123456789'), '[^0-9A-Za-z]+', '', 'g')), '')) WHERE invoice_number is not null and merchant_tax_id is not null;
