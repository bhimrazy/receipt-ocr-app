-- Hand-edited: the SET LOCAL line and the order (indexes before the FKs, so the locks on "user", "organization" and
-- "receipts" are held only for the last few statements).
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"user_id" text,
	"organization_id" text,
	"receipt_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "support_messages_kind_check" CHECK (kind in ('question', 'problem', 'feedback', 'sales')),
	CONSTRAINT "support_messages_source_check" CHECK (source in ('help', 'receipt', 'public')),
	CONSTRAINT "support_messages_status_check" CHECK (status in ('new', 'open', 'closed')),
	CONSTRAINT "support_messages_name_check" CHECK (char_length(name) between 1 and 80),
	CONSTRAINT "support_messages_email_check" CHECK (char_length(email) between 3 and 320),
	CONSTRAINT "support_messages_message_check" CHECK (char_length(message) between 5 and 2000),
	CONSTRAINT "support_messages_closed_check" CHECK ((status = 'closed') = (closed_at is not null))
);
--> statement-breakpoint
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_submission_idx" ON "support_messages" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "support_messages_status_created_idx" ON "support_messages" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "support_messages_user_created_idx" ON "support_messages" USING btree ("user_id","created_at") WHERE "support_messages"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "support_messages_org_idx" ON "support_messages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "support_messages_receipt_idx" ON "support_messages" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "support_messages_email_idx" ON "support_messages" USING btree (lower("email"));--> statement-breakpoint
-- The table is empty, so each FK validates at once; SHARE ROW EXCLUSIVE on the parent until commit.
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE set null ON UPDATE no action;
