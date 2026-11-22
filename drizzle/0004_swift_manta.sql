CREATE TABLE "webhook_receipts" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"body_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
