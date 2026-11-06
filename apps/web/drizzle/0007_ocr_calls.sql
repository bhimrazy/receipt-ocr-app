CREATE TABLE "ocr_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"round" smallint NOT NULL,
	"step" smallint NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"cost_micro_usd" integer,
	"price_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocr_calls" ADD CONSTRAINT "ocr_calls_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_calls" ADD CONSTRAINT "ocr_calls_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ocr_calls_org_created_at_idx" ON "ocr_calls" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ocr_calls_user_created_at_idx" ON "ocr_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ocr_calls_created_at_idx" ON "ocr_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ocr_calls_receipt_id_idx" ON "ocr_calls" USING btree ("receipt_id");