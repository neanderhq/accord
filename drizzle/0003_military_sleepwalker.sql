CREATE TABLE "action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"role" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"brand_name" text DEFAULT '' NOT NULL,
	"brand_color" text DEFAULT '#2563eb' NOT NULL,
	"logo" text,
	"retention_days" integer DEFAULT 365 NOT NULL,
	"webhook_url" text,
	"webhook_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"envelope_id" uuid,
	"recipient_id" uuid,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_jobs_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "envelope_lifecycle" (
	"envelope_id" uuid PRIMARY KEY NOT NULL,
	"predecessor_id" uuid,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"retention_at" timestamp with time zone,
	"reminder_days" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"converted_sha256" text NOT NULL,
	"converter" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"source_envelope_id" uuid NOT NULL,
	"roles" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" text NOT NULL,
	"endpoint" text NOT NULL,
	"secret" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_lifecycle" ADD CONSTRAINT "envelope_lifecycle_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_lifecycle" ADD CONSTRAINT "envelope_lifecycle_predecessor_id_envelopes_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_shares" ADD CONSTRAINT "template_shares_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_shares" ADD CONSTRAINT "template_shares_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_source_envelope_id_envelopes_id_fk" FOREIGN KEY ("source_envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_company_email" ON "contacts" USING btree ("company_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "template_share_user" ON "template_shares" USING btree ("template_id","user_id");