CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"count" integer,
	"last_request" bigint
);
--> statement-breakpoint
CREATE INDEX "rate_limit_key_idx" ON "rate_limit" USING btree ("key");