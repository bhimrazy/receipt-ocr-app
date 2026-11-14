-- Hand-edited: the SET LOCAL lines and the comments. drizzle-kit runs every pending migration in one transaction, so
-- each lock is held until commit; the CHECK goes last because its ACCESS EXCLUSIVE lock also blocks reads.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE INDEX "step_up_codes_expires_idx" ON "step_up_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "support_messages_retention_idx" ON "support_messages" USING btree (coalesce("closed_at", greatest("created_at", "updated_at")));--> statement-breakpoint
-- Validated inline: NOT VALID then VALIDATE in the same transaction would scan under the same lock.
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_closed_after_created_check" CHECK (closed_at is null or closed_at >= created_at);
