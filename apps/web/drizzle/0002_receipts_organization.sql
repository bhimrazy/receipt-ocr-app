-- Scope receipts to a workspace (organization) rather than a single user.
--
-- Hand-adjusted from the generated migration: drizzle emits a bare
-- `ADD COLUMN ... NOT NULL`, which fails on a table that already has rows.
-- Instead: add nullable, backfill from each uploader's earliest membership,
-- then tighten to NOT NULL.

ALTER TABLE "receipts" ADD COLUMN "organization_id" text;--> statement-breakpoint

UPDATE "receipts" AS r
SET "organization_id" = m."organization_id"
FROM (
  SELECT DISTINCT ON ("user_id") "user_id", "organization_id"
  FROM "member"
  ORDER BY "user_id", "created_at" ASC
) AS m
WHERE r."user_id" = m."user_id" AND r."organization_id" IS NULL;--> statement-breakpoint

-- A receipt whose uploader has no membership at all cannot be attributed to
-- any workspace, and would block the NOT NULL below.
DELETE FROM "receipts" WHERE "organization_id" IS NULL;--> statement-breakpoint

ALTER TABLE "receipts" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_org_created_at_idx" ON "receipts" USING btree ("organization_id","created_at");
