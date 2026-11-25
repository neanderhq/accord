CREATE TABLE "published_signing_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"template_fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_signing_links_template_id_unique" UNIQUE("template_id")
);
--> statement-breakpoint
CREATE TABLE "signing_link_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"envelope_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_link_claims_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "signing_link_claims_envelope_id_unique" UNIQUE("envelope_id")
);
--> statement-breakpoint
ALTER TABLE "published_signing_links" ADD CONSTRAINT "published_signing_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_signing_links" ADD CONSTRAINT "published_signing_links_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_signing_links" ADD CONSTRAINT "published_signing_links_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_link_claims" ADD CONSTRAINT "signing_link_claims_link_id_published_signing_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."published_signing_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_link_claims" ADD CONSTRAINT "signing_link_claims_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signing_claim_link_email" ON "signing_link_claims" USING btree ("link_id","email");