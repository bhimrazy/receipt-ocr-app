DROP INDEX "receipts_user_id_idx";--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "file_name" text;--> statement-breakpoint
CREATE INDEX "receipt_items_receipt_id_idx" ON "receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipts_user_created_at_idx" ON "receipts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "receipts_created_at_idx" ON "receipts" USING btree ("created_at");