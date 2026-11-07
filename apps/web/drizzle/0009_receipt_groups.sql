CREATE TABLE "receipt_group_members" (
	"group_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_group_members_group_id_receipt_id_pk" PRIMARY KEY("group_id","receipt_id")
);
--> statement-breakpoint
CREATE TABLE "receipt_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_group_members" ADD CONSTRAINT "receipt_group_members_group_id_receipt_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."receipt_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_group_members" ADD CONSTRAINT "receipt_group_members_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_group_members" ADD CONSTRAINT "receipt_group_members_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_groups" ADD CONSTRAINT "receipt_groups_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_groups" ADD CONSTRAINT "receipt_groups_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_group_members_receipt_id_idx" ON "receipt_group_members" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_groups_org_name_idx" ON "receipt_groups" USING btree ("organization_id",lower("name"));