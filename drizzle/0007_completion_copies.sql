CREATE TABLE "completion_copies" (
	"envelope_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completion_copies_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "completion_copies" ADD CONSTRAINT "completion_copies_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;