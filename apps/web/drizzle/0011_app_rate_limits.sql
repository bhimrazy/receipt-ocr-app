-- Hand-edited: the SET LOCAL line.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
CREATE TABLE "app_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "app_rate_limits_window_start_idx" ON "app_rate_limits" USING btree ("window_start");