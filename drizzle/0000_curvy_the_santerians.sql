CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"envelope_id" uuid,
	"actor" text NOT NULL,
	"event" text NOT NULL,
	"ip" text,
	"ua" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completion_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completion_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"name" text NOT NULL,
	"original" "bytea" NOT NULL,
	"signing" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"geometry" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"routing" text DEFAULT 'parallel' NOT NULL,
	"folder" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"recipient_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'verification_only' NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"document_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"envelope_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"routing_order" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_hash" text,
	"access_verifier" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consent_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submission_key" text,
	"submission_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "envelope_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_links" ADD CONSTRAINT "completion_links_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_shares" ADD CONSTRAINT "envelope_shares_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_shares" ADD CONSTRAINT "envelope_shares_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "envelope_company" ON "envelopes" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_company_user" ON "memberships" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "output_document" ON "outputs" USING btree ("envelope_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipient_token_hash" ON "recipients" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "recipient_envelope" ON "recipients" USING btree ("envelope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_envelope_user" ON "envelope_shares" USING btree ("envelope_id","user_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");