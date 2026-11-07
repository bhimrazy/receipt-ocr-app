CREATE TABLE "step_up_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "step_up_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "step_up_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"action" text NOT NULL,
	"method" text NOT NULL,
	"outcome" text NOT NULL,
	"totp_counter" bigint,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_up_events_method_check" CHECK (method in ('totp', 'backup_code', 'passkey', 'email')),
	CONSTRAINT "step_up_events_outcome_check" CHECK (outcome in ('sent', 'verified', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "step_up_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "two_factor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "auth_method" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "step_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "step_up_method" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "step_up_codes" ADD CONSTRAINT "step_up_codes_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_up_codes" ADD CONSTRAINT "step_up_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_up_events" ADD CONSTRAINT "step_up_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_up_events" ADD CONSTRAINT "step_up_events_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "step_up_codes_session_idx" ON "step_up_codes" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "step_up_codes_user_created_idx" ON "step_up_codes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "step_up_events_user_created_idx" ON "step_up_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");