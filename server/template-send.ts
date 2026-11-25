import type { PoolClient } from "pg";
import { z } from "zod";
import { parseCsv } from "../lib/csv";
import { fieldInput } from "../lib/model";
import { mailConfigured } from "./automation";
import { hash } from "./crypto";
import { transaction } from "./db";
import { fail } from "./errors";
import { copyDraft, templateAccess } from "./features";
import { audit, freezeDraft, member, type Principal } from "./workflow";

const maxCopies = 25;
const maxCsvBytes = 64 * 1024;
const maxCopiedBytes = 64 * 1024 * 1024;
const previewInput = z.object({ templateId: z.uuid(), csv: z.string().max(maxCsvBytes) });
export const externalEmail = z.string().trim().toLowerCase().pipe(z.email().max(200))
  .refine(email => process.env.NODE_ENV === "production" || email.endsWith(".test"), "Use a synthetic .test address in development.");
export const externalRecipient = z.object({ name: z.string().trim().min(1).max(100), email: externalEmail });

const snapshotInput = z.object({
  routing: z.enum(["parallel", "sequential"]),
  documents: z.array(z.uuid()).min(1).max(10),
  roles: z.array(z.object({ recipientId: z.uuid(), name: z.string(), order: z.number().int().min(1).max(10) })).length(1),
  fields: z.array(fieldInput).min(1).max(200),
});

export async function singleSignerTemplate(c: PoolClient, p: Principal, templateId: string) {
  const template = await templateAccess(c, p, templateId);
  const parsed = snapshotInput.safeParse(template.snapshot);
  if (!parsed.success) fail(409, "TEMPLATE_INVALID", "Choose a template with one signer, documents and assigned fields.");
  const snapshot = parsed.data;
  const role = snapshot.roles[0];
  if (snapshot.fields.some(field => field.recipientId !== role.recipientId || !snapshot.documents.includes(field.documentId))
    || !snapshot.fields.some(field => field.type === "signature" && field.required)) {
    fail(409, "TEMPLATE_INVALID", "The template must include a required signature assigned to its signer.");
  }
  const source = (await c.query(
    `SELECT e.version FROM envelopes e LEFT JOIN envelope_lifecycle l ON l.envelope_id=e.id
      WHERE e.id=$1 AND e.company_id=$2 AND l.deleted_at IS NULL FOR SHARE OF e`,
    [template.source_envelope_id, p.companyId],
  )).rows[0];
  if (!source) fail(409, "TEMPLATE_UNAVAILABLE", "The template source is unavailable.");
  const documents = (await c.query(
    `SELECT d.id,d.sha256,d.geometry,octet_length(d.original)+octet_length(d.signing)+coalesce(octet_length(s.bytes),0) AS bytes,s.sha256 AS source_hash
       FROM documents d LEFT JOIN source_files s ON s.document_id=d.id
       WHERE d.id=ANY($1::uuid[]) AND d.envelope_id=$2 ORDER BY d.id`,
    [snapshot.documents, template.source_envelope_id],
  )).rows;
  if (documents.length !== snapshot.documents.length) fail(409, "TEMPLATE_UNAVAILABLE", "A template document is unavailable.");
  return {
    id: template.id as string, name: template.name as string, snapshot, role,
    bytes: documents.reduce((sum, doc) => sum + Number(doc.bytes), 0),
    fingerprint: hash(JSON.stringify([template.id, template.name, snapshot, source.version, documents])),
  };
}

function roster(csv: string) {
  if (Buffer.byteLength(csv) > maxCsvBytes) fail(413, "CSV_TOO_LARGE", "Use a CSV no larger than 64 KiB.");
  let lines: string[][];
  try { lines = parseCsv(csv.replace(/^\uFEFF/, "")); }
  catch { fail(400, "CSV_INVALID", "Check CSV quoting and use the name,email header."); }
  if (lines[0]?.map(cell => cell.trim().toLowerCase()).join(",") !== "name,email") {
    fail(400, "CSV_HEADER", "Use the name,email header.");
  }
  const recipients = lines.slice(1);
  if (!recipients.length || recipients.length > maxCopies) fail(400, "CSV_ROWS", "Include 1 to 25 signer rows.");
  const seen = new Set<string>();
  return recipients.map(([name, email, ...extra], index) => {
    const row = index + 2;
    const parsed = externalRecipient.safeParse({ name, email });
    if (!parsed.success || extra.length) return { row, error: "Enter a name and valid email in two columns." };
    if (seen.has(parsed.data.email)) return { row, error: "This email already appears in the roster." };
    seen.add(parsed.data.email);
    return { row, ...parsed.data };
  });
}

function preview(template: Awaited<ReturnType<typeof singleSignerTemplate>>, csv: string) {
  const rows = roster(csv);
  if (template.bytes * rows.length > maxCopiedBytes) {
    fail(413, "BATCH_DOCUMENT_LIMIT", "Use a smaller roster or template to stay under 64 MiB of copied files.");
  }
  return {
    rows,
    fingerprint: rows.some(row => "error" in row) ? null : hash(JSON.stringify([template.fingerprint, rows])),
  };
}

export async function bulkPreview(p: Principal, input: unknown) {
  const v = previewInput.parse(input);
  return transaction(async c => {
    await member(c, p, true);
    return preview(await singleSignerTemplate(c, p, v.templateId), v.csv);
  });
}

export function deliveryStatus(status: string | null) {
  if (status && status !== "pending") return status;
  if (!mailConfigured()) return "not_configured";
  if (process.env.NODE_ENV !== "production" || process.env.EMAIL_DISPATCH_ENABLED !== "1") return "disabled";
  return status ?? "pending";
}

async function batchHistory(c: PoolClient, p: Principal, role: string, batchId?: string) {
  const batches = (await c.query<{id:string;created_at:Date;template_name:string}>(
    `SELECT b.id,b.created_at,t.name AS template_name FROM bulk_send_batches b JOIN templates t ON t.id=b.template_id
      WHERE b.company_id=$1 AND (b.owner_id=$2 OR $3='admin') AND ($4::uuid IS NULL OR b.id=$4)
      ORDER BY b.created_at DESC,b.id DESC LIMIT 20`, [p.companyId,p.userId,role,batchId??null],
  )).rows;
  const entries = (await c.query<{batch_id:string;row_number:number;envelope_id:string;state:string;name:string;email:string;delivery:string|null}>(
    `SELECT x.batch_id,x.row_number,e.id AS envelope_id,e.state,r.name,r.email,j.status AS delivery
      FROM bulk_send_entries x JOIN envelopes e ON e.id=x.envelope_id JOIN recipients r ON r.envelope_id=e.id
      LEFT JOIN delivery_jobs j ON j.event_key='signing_request:'||e.id||':'||r.id||':initial'
      WHERE x.batch_id=ANY($1::uuid[]) ORDER BY x.row_number`, [batches.map(b=>b.id)],
  )).rows;
  return batches.map(batch => ({
    ...batch, entries: entries.filter(row=>row.batch_id===batch.id).map(row=>({...row,delivery:deliveryStatus(row.delivery)})),
  }));
}

export async function bulkHistory(p: Principal) {
  return transaction(async c => batchHistory(c,p,(await member(c,p,true)).role));
}

export async function bulkConfirm(p: Principal, input: unknown) {
  const v = previewInput.extend({ fingerprint: z.hash("sha256"), requestKey: z.uuid() }).parse(input);
  const submittedHash = hash(JSON.stringify([v.templateId,v.fingerprint,roster(v.csv)]));
  return transaction(async c => {
    const membership = await member(c,p,true);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`bulk-send:${p.companyId}:${p.userId}:${v.requestKey}`]);
    const existing = (await c.query(
      "SELECT id,request_hash FROM bulk_send_batches WHERE company_id=$1 AND owner_id=$2 AND request_key=$3",
      [p.companyId,p.userId,v.requestKey],
    )).rows[0];
    if (existing) {
      if (existing.request_hash !== submittedHash) fail(409,"BATCH_CONFLICT","This confirmation was already used for a different roster.");
      return (await batchHistory(c,p,membership.role,existing.id))[0];
    }
    const template = await singleSignerTemplate(c,p,v.templateId);
    const checked = preview(template,v.csv);
    if (!checked.fingerprint || checked.fingerprint !== v.fingerprint) fail(409,"BATCH_REVIEW_REQUIRED","Preview the current template and roster before confirming.");
    const batch = (await c.query(
      "INSERT INTO bulk_send_batches(company_id,owner_id,template_id,request_key,request_hash) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [p.companyId,p.userId,template.id,v.requestKey,submittedHash],
    )).rows[0];
    for (const row of checked.rows) {
      if ("error" in row) fail(409,"BATCH_REVIEW_REQUIRED","Correct every row before confirming.");
      const envelope = await copyDraft(c,p,template.name,template.snapshot,[{...row,roleId:template.role.recipientId,order:template.role.order}]);
      await freezeDraft(c,p,envelope,7);
      await c.query("INSERT INTO bulk_send_entries(batch_id,row_number,envelope_id) VALUES($1,$2,$3)",[batch.id,row.row,envelope.id]);
    }
    await audit(c,{company_id:p.companyId},p,"bulk_send_created",{batchId:batch.id,count:checked.rows.length});
    return (await batchHistory(c,p,membership.role,batch.id))[0];
  });
}
