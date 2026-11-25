import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, customType, uniqueIndex, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
export * from "./auth-schema";
const bytes=customType<{ data: Buffer }>({dataType(){return "bytea";}});
const created=()=>timestamp("created_at",{withTimezone:true}).notNull().defaultNow();
export const companies=pgTable("companies",{id:uuid().primaryKey().defaultRandom(),name:text().notNull(),createdAt:created()});
export const memberships=pgTable("memberships",{id:uuid().primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id),userId:text("user_id").notNull().references(()=>user.id),role:text().notNull(),active:boolean().notNull().default(true),createdAt:created()},t=>[uniqueIndex("membership_company_user").on(t.companyId,t.userId)]);
export const envelopes=pgTable("envelopes",{id:uuid().primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id),ownerId:text("owner_id").notNull().references(()=>user.id),title:text().notNull(),state:text().notNull().default("draft"),version:integer().notNull().default(1),routing:text().notNull().default("parallel"),folder:text().notNull().default(""),tags:jsonb().notNull().default([]),fields:jsonb().notNull().default([]),expiresAt:timestamp("expires_at",{withTimezone:true}),sentAt:timestamp("sent_at",{withTimezone:true}),completedAt:timestamp("completed_at",{withTimezone:true}),reason:text(),createdAt:created()},t=>[index("envelope_company").on(t.companyId)]);
export const shares=pgTable("envelope_shares",{id:uuid().primaryKey().defaultRandom(),envelopeId:uuid("envelope_id").notNull().references(()=>envelopes.id),userId:text("user_id").notNull().references(()=>user.id)},t=>[uniqueIndex("share_envelope_user").on(t.envelopeId,t.userId)]);
export const documents=pgTable("documents",{id:uuid().primaryKey().defaultRandom(),envelopeId:uuid("envelope_id").notNull().references(()=>envelopes.id),name:text().notNull(),original:bytes().notNull(),signing:bytes().notNull(),sha256:text().notNull(),size:integer().notNull(),geometry:jsonb().notNull(),createdAt:created()});
export const recipients=pgTable("recipients",{id:uuid().primaryKey(),envelopeId:uuid("envelope_id").notNull().references(()=>envelopes.id),name:text().notNull(),email:text().notNull(),routingOrder:integer("routing_order").notNull(),status:text().notNull().default("pending"),tokenHash:text("token_hash"),accessVerifier:text("access_verifier"),attempts:integer().notNull().default(0),consentAt:timestamp("consent_at",{withTimezone:true}),signedAt:timestamp("signed_at",{withTimezone:true}),values:jsonb().notNull().default({}),submissionKey:text("submission_key"),submissionHash:text("submission_hash"),createdAt:created()},t=>[uniqueIndex("recipient_token_hash").on(t.tokenHash),index("recipient_envelope").on(t.envelopeId)]);
export const outputs=pgTable("outputs",{id:uuid().primaryKey().defaultRandom(),envelopeId:uuid("envelope_id").notNull().references(()=>envelopes.id),documentId:uuid("document_id").references(()=>documents.id),kind:text().notNull(),name:text().notNull(),bytes:bytes().notNull(),sha256:text().notNull(),size:integer().notNull(),createdAt:created()},t=>[uniqueIndex("output_document").on(t.envelopeId,t.documentId)]);
export const completionLinks=pgTable("completion_links",{id:uuid().primaryKey().defaultRandom(),recipientId:uuid("recipient_id").notNull().references(()=>recipients.id),tokenHash:text("token_hash").notNull().unique(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),createdAt:created()});
export const audit=pgTable("audit_events",{id:uuid().primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id),envelopeId:uuid("envelope_id").references(()=>envelopes.id),actor:text().notNull(),event:text().notNull(),ip:text(),ua:text(),data:jsonb().notNull().default({}),createdAt:created()});
export const outbox=pgTable("outbox",{id:uuid().primaryKey().defaultRandom(),envelopeId:uuid("envelope_id").notNull().references(()=>envelopes.id),recipientId:uuid("recipient_id").references(()=>recipients.id),kind:text().notNull(),status:text().notNull().default("verification_only"),eventKey:text("event_key").notNull().unique(),payload:jsonb().notNull().default({}),attempts:integer().notNull().default(0),lastError:text("last_error"),createdAt:created()});
export const requestLimits=pgTable("request_limits",{key:text().primaryKey(),windowStart:timestamp("window_start",{withTimezone:true}).notNull().defaultNow(),count:integer().notNull().default(1)});

// STEP 2 additions. Existing auth schema and immutable evidence tables are retained.
export const companySettings=pgTable("company_settings",{companyId:uuid("company_id").primaryKey().references(()=>companies.id),brandName:text("brand_name").notNull().default(""),brandColor:text("brand_color").notNull().default("#2563eb"),logo:text(),retentionDays:integer("retention_days").notNull().default(365),webhookUrl:text("webhook_url"),webhookSecret:text("webhook_secret"),createdAt:created()});
export const contacts=pgTable("contacts",{id:uuid().primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id),name:text().notNull(),email:text().notNull(),createdAt:created()},t=>[uniqueIndex("contact_company_email").on(t.companyId,t.email)]);
export const templates=pgTable("templates",{id:uuid().primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id),ownerId:text("owner_id").notNull().references(()=>user.id),name:text().notNull(),sourceEnvelopeId:uuid("source_envelope_id").notNull().references(()=>envelopes.id),roles:jsonb().notNull(),snapshot:jsonb().notNull(),createdAt:created()});
export const templateShares=pgTable("template_shares",{id:uuid().primaryKey().defaultRandom(),templateId:uuid("template_id").notNull().references(()=>templates.id),userId:text("user_id").notNull().references(()=>user.id)},t=>[uniqueIndex("template_share_user").on(t.templateId,t.userId)]);
export const envelopeLifecycle=pgTable("envelope_lifecycle",{envelopeId:uuid("envelope_id").primaryKey().references(()=>envelopes.id),predecessorId:uuid("predecessor_id").references(()=>envelopes.id),archivedAt:timestamp("archived_at",{withTimezone:true}),deletedAt:timestamp("deleted_at",{withTimezone:true}),retentionAt:timestamp("retention_at",{withTimezone:true}),reminderDays:integer("reminder_days").notNull().default(3),createdAt:created()});
export const sourceFiles=pgTable("source_files",{documentId:uuid("document_id").primaryKey().references(()=>documents.id),name:text().notNull(),bytes:bytes().notNull(),sha256:text().notNull(),convertedSha256:text("converted_sha256").notNull(),converter:text().notNull(),createdAt:created()});
export const actionTokens=pgTable("action_tokens",{id:uuid().primaryKey().defaultRandom(),companyId:uuid("company_id").references(()=>companies.id),kind:text().notNull(),email:text().notNull(),userId:text("user_id").references(()=>user.id),role:text(),tokenHash:text("token_hash").notNull().unique(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),usedAt:timestamp("used_at",{withTimezone:true}),createdAt:created()});
export const deliveryJobs=pgTable("delivery_jobs",{id:uuid().primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id),envelopeId:uuid("envelope_id").references(()=>envelopes.id),recipientId:uuid("recipient_id").references(()=>recipients.id),kind:text().notNull(),eventKey:text("event_key").notNull().unique(),status:text().notNull().default("pending"),payload:text().notNull(),attempts:integer().notNull().default(0),nextAt:timestamp("next_at",{withTimezone:true}).notNull().defaultNow(),lastError:text("last_error"),providerId:text("provider_id"),createdAt:created()});
export const deliveryAttempts=pgTable("delivery_attempts",{id:uuid().primaryKey().defaultRandom(),jobId:uuid("job_id").notNull().references(()=>deliveryJobs.id),status:text().notNull(),detail:text().notNull(),createdAt:created()});
export const webhookEvents=pgTable("webhook_events",{id:uuid().primaryKey().defaultRandom(),companyId:uuid("company_id").notNull().references(()=>companies.id),envelopeId:uuid("envelope_id").notNull().references(()=>envelopes.id),event:text().notNull(),payload:text().notNull(),endpoint:text().notNull(),secret:text().notNull(),attempts:integer().notNull().default(0),status:text().notNull().default("pending"),nextAt:timestamp("next_at",{withTimezone:true}).notNull().defaultNow(),lastError:text("last_error"),createdAt:created()});
export const webhookAttempts=pgTable("webhook_attempts",{id:uuid().primaryKey().defaultRandom(),eventId:uuid("event_id").notNull().references(()=>webhookEvents.id),status:text().notNull(),createdAt:created()});
export const jobRuns=pgTable("job_runs",{id:uuid().primaryKey().defaultRandom(),result:jsonb().notNull(),createdAt:created()});
export const webhookReceipts=pgTable("webhook_receipts",{eventId:uuid("event_id").primaryKey(),bodyHash:text("body_hash").notNull(),createdAt:created()});

export const bulkSendBatches=pgTable("bulk_send_batches",{
  id:uuid().defaultRandom().primaryKey(),
  companyId:uuid("company_id").notNull().references(()=>companies.id),
  ownerId:text("owner_id").notNull().references(()=>user.id),
  templateId:uuid("template_id").notNull().references(()=>templates.id),
  requestKey:uuid("request_key").notNull(),
  requestHash:text("request_hash").notNull(),
  createdAt:created(),
},t=>[uniqueIndex("bulk_send_request").on(t.companyId,t.ownerId,t.requestKey)]);
export const bulkSendEntries=pgTable("bulk_send_entries",{
  batchId:uuid("batch_id").notNull().references(()=>bulkSendBatches.id),
  rowNumber:integer("row_number").notNull(),
  envelopeId:uuid("envelope_id").notNull().unique().references(()=>envelopes.id),
},t=>[uniqueIndex("bulk_send_row").on(t.batchId,t.rowNumber)]);

export const completionCopies=pgTable("completion_copies",{
  envelopeId:uuid("envelope_id").primaryKey().references(()=>envelopes.id),
  email:text().notNull(),
  generation:integer().notNull().default(0),
  tokenHash:text("token_hash").unique(),
  expiresAt:timestamp("expires_at",{withTimezone:true}),
  revokedAt:timestamp("revoked_at",{withTimezone:true}),
  createdAt:created(),
});
