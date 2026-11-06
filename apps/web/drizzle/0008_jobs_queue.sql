CREATE TYPE "public"."job_state" AS ENUM('queued', 'running', 'succeeded', 'dead', 'cancelled');--> statement-breakpoint
CREATE TABLE "job_controls" (
	"scope" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"until" timestamp with time zone,
	"reason" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"every_seconds" integer NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"host" text,
	"version" text,
	"concurrency" smallint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"state" "job_state" DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text,
	"receipt_id" uuid,
	"organization_id" text,
	"user_id" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error_kind" text,
	"last_error_at" timestamp with time zone,
	"attempt_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_attempts_check" CHECK (attempts >= 0 and max_attempts >= 1),
	CONSTRAINT "jobs_last_error_kind_check" CHECK (last_error_kind ~ '^[a-z0-9.-]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "rate_windows" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_windows_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "ocr_calls" ADD COLUMN "job_attempt" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_runnable_idx" ON "jobs" USING btree ("priority","run_at") WHERE state = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_running_idx" ON "jobs" USING btree ("user_id") WHERE state = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_idx" ON "jobs" USING btree ("idempotency_key") WHERE state in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_receipt_live_idx" ON "jobs" USING btree ("receipt_id") WHERE state in ('queued', 'running') and kind like 'receipt.%';--> statement-breakpoint
CREATE INDEX "jobs_state_finished_idx" ON "jobs" USING btree ("state","finished_at");--> statement-breakpoint
CREATE INDEX "jobs_org_created_idx" ON "jobs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_calls_receipt_round_attempt_step_idx" ON "ocr_calls" USING btree ("receipt_id","round","job_attempt","step");--> statement-breakpoint
-- Hand-written below. The old unique index goes only once its replacement exists.
DROP INDEX "ocr_calls_receipt_round_step_idx";--> statement-breakpoint
-- Room on each page for HOT heartbeats, and vacuum this hot table early.
ALTER TABLE "jobs" SET (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 200, autovacuum_analyze_scale_factor = 0.05);--> statement-breakpoint
-- Backfill: receipts still being read have no job. Old ones (and ones whose
-- uploader is gone, or never left "uploaded") are settled as failed so the
-- user can retry; recent ones get a job for their current round.
UPDATE "receipts" SET "status" = 'failed', "error_message" = 'Reading this receipt took too long. Try again.', "updated_at" = now()
WHERE "status" = 'uploaded'
   OR ("status" = 'processing' AND ("updated_at" < now() - interval '1 hour' OR "user_id" IS NULL));--> statement-breakpoint
INSERT INTO "jobs" ("kind", "priority", "payload", "idempotency_key", "receipt_id", "organization_id", "user_id", "max_attempts")
SELECT 'receipt.extract', 0,
       jsonb_build_object('receiptId', r."id", 'organizationId', r."organization_id", 'userId', r."user_id", 'round', r."attempts"),
       'receipt:' || r."id" || ':round:' || r."attempts", r."id", r."organization_id", r."user_id", 4
FROM "receipts" r
WHERE r."status" = 'processing';
