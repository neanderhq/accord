CREATE TABLE "bulk_send_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_send_entries" (
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"envelope_id" uuid NOT NULL,
	CONSTRAINT "bulk_send_entries_envelope_id_unique" UNIQUE("envelope_id")
);
--> statement-breakpoint
ALTER TABLE "bulk_send_batches" ADD CONSTRAINT "bulk_send_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_send_batches" ADD CONSTRAINT "bulk_send_batches_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_send_batches" ADD CONSTRAINT "bulk_send_batches_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_send_entries" ADD CONSTRAINT "bulk_send_entries_batch_id_bulk_send_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bulk_send_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_send_entries" ADD CONSTRAINT "bulk_send_entries_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_send_request" ON "bulk_send_batches" USING btree ("company_id","owner_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_send_row" ON "bulk_send_entries" USING btree ("batch_id","row_number");