import { queueStatus,queueSigning,mailConfigured } from "./automation";
import { convertDocx } from "./docx";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "./db";
import { fail, AppError } from "./errors";
import { hash, newToken, verifier, verifyCode } from "./crypto";
import { inspectPdf, flatten } from "./pdf";
import { draftInput, fieldInside, terminal, CONSENT_TEXT, validateValues, valuesInput, type Field, type Geometry } from "../lib/model";

export type Principal = { userId: string; companyId: string; ip?: string; ua?: string };
export type Access = { token: string; code?: string; ip?: string; ua?: string };
type Envelope = { id:string;company_id:string;owner_id:string;title:string;state:string;version:number;routing:string;fields:Field[];expires_at:Date|null;folder:string;tags:string[];reason:string|null };
type Recipient = { id:string;envelope_id:string;name:string;email:string;routing_order:number;status:string;access_verifier:string|null;attempts:number;consent_at:Date|null;values:Record<string,string|boolean>;submission_key:string|null;submission_hash:string|null };
const id = (v: string) => z.uuid().parse(v);
export async function member(c: PoolClient, p: Principal, write=false) {
  id(p.companyId);
  const m=(await c.query("SELECT * FROM memberships WHERE company_id=$1 AND user_id=$2 AND active=true FOR SHARE",[p.companyId,p.userId])).rows[0];
  if(!m) fail(403,"MEMBERSHIP_REQUIRED","An active company membership is required.");
  if(write && !["admin","sender"].includes(m.role)) fail(403,"READ_ONLY","Your role can view envelopes but cannot change them.");
  return m;
}
export async function audit(c:PoolClient,e:{company_id:string;id?:string},p:{userId?:string;ip?:string;ua?:string},event:string,data:unknown={}) {
  const a=await c.query("INSERT INTO audit_events(company_id,envelope_id,actor,event,ip,ua,data) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[e.company_id,e.id??null,p.userId??"recipient",event,p.ip??null,p.ua?.slice(0,512)??null,JSON.stringify(data)]);
  await queueStatus(c,e,event,a.rows[0].id);
}
export async function expire(c:PoolClient,e:Envelope,p:{ip?:string;ua?:string}) {
  const expired=(await c.query("SELECT $1::timestamptz <= clock_timestamp() AS expired",[e.expires_at])).rows[0].expired;
  if(!terminal.includes(e.state) && e.state!=="draft" && expired) {
    await c.query("UPDATE envelopes SET state='expired',version=version+1 WHERE id=$1",[e.id]); e.state="expired";
    await audit(c,e,p,"expired");
  }
}
export async function envelope(c:PoolClient,p:Principal,envelopeId:string,write=false) {
  const m=await member(c,p,write);
  const e=(await c.query("SELECT * FROM envelopes WHERE id=$1 AND company_id=$2 FOR UPDATE",[id(envelopeId),p.companyId])).rows[0] as Envelope|undefined;
  if(!e) fail(404,"NOT_FOUND","Envelope not found.");
  const life=(await c.query("SELECT * FROM envelope_lifecycle WHERE envelope_id=$1",[e.id])).rows[0];
  if(life?.deleted_at && m.role!=="admin") fail(404,"NOT_FOUND","Envelope not found.");
  if(m.role!=="admin" && e.owner_id!==p.userId) {
    const shared=(await c.query("SELECT 1 FROM envelope_shares WHERE envelope_id=$1 AND user_id=$2",[e.id,p.userId])).rowCount;
    if(write || !shared) fail(404,"NOT_FOUND","Envelope not found.");
  }
  await expire(c,e,p); return e;
}
function draft(e:Envelope,version:number) { if(e.state!=="draft") fail(409,"FROZEN","Sent envelopes are frozen. Void the envelope to stop signing."); if(e.version!==version) fail(409,"VERSION_CONFLICT","This envelope changed. Reload it before saving."); }
export async function details(c:PoolClient,e:Envelope) {
  const docs=(await c.query("SELECT id,name,sha256,size,geometry,EXISTS(SELECT 1 FROM source_files s WHERE s.document_id=documents.id) AS converted,coalesce((SELECT converter FROM source_files s WHERE s.document_id=documents.id),'') AS converter FROM documents WHERE envelope_id=$1 ORDER BY created_at,id",[e.id])).rows;
  const rs=(await c.query("SELECT id,name,email,routing_order,status,consent_at,signed_at,access_verifier IS NOT NULL AS has_access_code FROM recipients WHERE envelope_id=$1 ORDER BY routing_order,id",[e.id])).rows;
  const events=(await c.query("SELECT id,actor,event,ip,ua,data,created_at FROM audit_events WHERE envelope_id=$1 ORDER BY created_at,id",[e.id])).rows;
  const outs=(await c.query("SELECT id,document_id,name,kind,sha256,size FROM outputs WHERE envelope_id=$1 ORDER BY created_at,id",[e.id])).rows;
  const deliveries=(await c.query("SELECT id,kind,status,attempts,last_error,created_at FROM outbox WHERE envelope_id=$1 ORDER BY created_at",[e.id])).rows;
  const lifecycle=(await c.query("SELECT * FROM envelope_lifecycle WHERE envelope_id=$1",[e.id])).rows[0]??null;
  return {...e,lifecycle,documents:docs,recipients:rs,events,outputs:outs,deliveries};
}
export async function workspace(p:Principal) {return transaction(async c=>{
  const m=await member(c,p);
  const company=(await c.query("SELECT id,name FROM companies WHERE id=$1",[p.companyId])).rows[0];
  const envelopes=(await c.query(`SELECT e.*,l.archived_at,l.deleted_at,u.name AS owner_name,(SELECT count(*)::int FROM documents d WHERE d.envelope_id=e.id) AS document_count,
    (SELECT jsonb_agg(jsonb_build_object('name',r.name,'email',r.email,'status',r.status) ORDER BY r.routing_order) FROM recipients r WHERE r.envelope_id=e.id) AS recipients
    FROM envelopes e JOIN "user" u ON u.id=e.owner_id LEFT JOIN envelope_lifecycle l ON l.envelope_id=e.id WHERE e.company_id=$1 AND (l.deleted_at IS NULL OR $3='admin') AND ($3='admin' OR e.owner_id=$2 OR EXISTS(SELECT 1 FROM envelope_shares s WHERE s.envelope_id=e.id AND s.user_id=$2)) ORDER BY e.created_at DESC`,[p.companyId,p.userId,m.role])).rows;
  return {company,role:m.role,userId:p.userId,envelopes,verificationOnly:process.env.NODE_ENV!=="production"||process.env.EMAIL_DISPATCH_ENABLED!=="1",developmentLinks:process.env.NODE_ENV!=="production"&&process.env.DEV_VERIFICATION_LINKS==="1"};
});}
export async function createEnvelope(p:Principal,title:string) {return transaction(async c=>{await member(c,p,true);const e=(await c.query("INSERT INTO envelopes(company_id,owner_id,title) VALUES($1,$2,$3) RETURNING *",[p.companyId,p.userId,z.string().trim().min(1).max(160).parse(title)])).rows[0];await audit(c,e,p,"draft_created");return details(c,e);});}
export async function getEnvelope(p:Principal,envelopeId:string) {return transaction(async c=>details(c,await envelope(c,p,envelopeId)));}
export async function uploadDocument(p:Principal,envelopeId:string,version:number,name:string,bytes:Buffer) {
  const source=name.toLowerCase().endsWith(".docx")?Buffer.from(bytes):null;
  let converter="";if(source){const converted=await convertDocx(source);bytes=converted.bytes;converter=converted.converter;}
  else if(!name.toLowerCase().endsWith(".pdf")) fail(400,"PDF_ONLY","Upload PDF or DOCX.");
  const sourceName=name; if(source)name=name.replace(/\.docx$/i,".pdf");
  const meta=await inspectPdf(bytes);
  return transaction(async c=>{const e=await envelope(c,p,envelopeId,true);draft(e,version);
    const total=(await c.query("SELECT count(*)::int AS n,coalesce(sum(size),0)::int AS bytes FROM documents WHERE envelope_id=$1",[e.id])).rows[0];
    if(total.n>=10 || total.bytes+bytes.length>32*1024*1024) fail(400,"DOCUMENT_LIMIT","An envelope supports up to 10 PDFs and 32 MB total.");
    const d=(await c.query("INSERT INTO documents(envelope_id,name,original,signing,sha256,size,geometry) VALUES($1,$2,$3,$3,$4,$5,$6) RETURNING id",[e.id,name.replace(/[^a-zA-Z0-9 ._-]/g,"_").slice(0,120),bytes,meta.sha256,meta.size,JSON.stringify(meta.geometry)])).rows[0];
    if(source)await c.query("INSERT INTO source_files(document_id,name,bytes,sha256,converted_sha256,converter) VALUES($1,$2,$3,$4,$5,$6)",[d.id,sourceName.slice(0,120),source,hash(source),meta.sha256,converter]);
    await c.query("UPDATE envelopes SET version=version+1 WHERE id=$1",[e.id]);await audit(c,e,p,"document_added",{id:d.id,sha256:meta.sha256,size:meta.size});e.version++;return details(c,e);
  });
}
async function validateDraft(c:PoolClient,e:Envelope,fields:Field[],recipients:{id:string;order:number}[],sending=false) {
  const docs=(await c.query("SELECT id,geometry FROM documents WHERE envelope_id=$1",[e.id])).rows as {id:string;geometry:Geometry[]}[];
  if(sending && (!docs.length || !recipients.length)) fail(400,"INCOMPLETE","Add at least one PDF and one recipient.");
  if(new Set(recipients.map(r=>r.id)).size!==recipients.length || new Set(fields.map(f=>f.id)).size!==fields.length) fail(400,"DUPLICATE_ID","Recipient and field identifiers must be unique.");
  if(e.routing==="sequential" && new Set(recipients.map(r=>r.order)).size!==recipients.length) fail(400,"ROUTING_INVALID","Sequential recipients need unique signing positions.");
  for(const f of fields) {
    const doc=docs.find(d=>d.id===f.documentId), page=doc?.geometry[f.page];
    if(!page || !recipients.some(r=>r.id===f.recipientId) || !fieldInside(f,page)) fail(400,"FIELD_INVALID","Every field must fit its PDF page and belong to a recipient in this envelope.");
  }
  if(sending && (recipients.some(r=>!fields.some(f=>f.recipientId===r.id&&f.required&&f.type==="signature")) || docs.some(d=>!fields.some(f=>f.documentId===d.id)))) fail(400,"FIELDS_REQUIRED","Place a required signature for every recipient and at least one field on every document.");
}
export async function saveDraft(p:Principal,envelopeId:string,input:unknown) {const v=draftInput.parse(input);return transaction(async c=>{
  const e=await envelope(c,p,envelopeId,true);draft(e,v.version);e.routing=v.routing;
  await validateDraft(c,e,v.fields,v.recipients);
  const previous=(await c.query("SELECT id,access_verifier FROM recipients WHERE envelope_id=$1",[e.id])).rows;
  await c.query("DELETE FROM recipients WHERE envelope_id=$1",[e.id]);
  for(const r of v.recipients) await c.query("INSERT INTO recipients(id,envelope_id,name,email,routing_order,access_verifier) VALUES($1,$2,$3,$4,$5,$6)",[r.id,e.id,r.name,r.email.toLowerCase(),r.order,r.accessCode ? verifier(r.accessCode) : previous.find(p=>p.id===r.id)?.access_verifier??null]);
  await c.query("UPDATE envelopes SET title=$2,routing=$3,folder=$4,tags=$5,fields=$6,version=version+1 WHERE id=$1",[e.id,v.title,v.routing,v.folder,JSON.stringify(v.tags),JSON.stringify(v.fields)]);
  Object.assign(e,{title:v.title,routing:v.routing,folder:v.folder,tags:v.tags,fields:v.fields,version:e.version+1});await audit(c,e,p,"draft_saved",{version:e.version});return details(c,e);
});}
export async function sendEnvelope(p:Principal,envelopeId:string,input:unknown) {
  const v=z.object({version:z.number().int().positive(),confirmed:z.literal(true),expiresInDays:z.number().int().min(1).max(30)}).parse(input);
  return transaction(async c=>{const e=await envelope(c,p,envelopeId,true);draft(e,v.version);const rs=(await c.query("SELECT * FROM recipients WHERE envelope_id=$1",[e.id])).rows as Recipient[];
    if(process.env.NODE_ENV!=="production" && rs.some(r=>!r.email.endsWith(".test"))) fail(400,"SYNTHETIC_ONLY","Only synthetic .test recipients are allowed in verification mode.");
    await validateDraft(c,e,e.fields,rs.map(r=>({id:r.id,order:r.routing_order})),true);
    await c.query("UPDATE envelopes SET state='sent',sent_at=clock_timestamp(),expires_at=clock_timestamp()+$2*interval '1 day',version=version+1 WHERE id=$1",[e.id,v.expiresInDays]);
    for(const r of rs) await queueSigning(c,e,r);
    await c.query("INSERT INTO envelope_lifecycle(envelope_id,retention_at) VALUES($1,clock_timestamp()+coalesce((SELECT retention_days FROM company_settings WHERE company_id=$2),365)*interval '1 day') ON CONFLICT(envelope_id) DO UPDATE SET retention_at=excluded.retention_at",[e.id,e.company_id]);
    // The activity log is evidence: record whether signing links were really dispatched by email.
    const dispatch=process.env.NODE_ENV==="production"&&process.env.EMAIL_DISPATCH_ENABLED==="1"&&mailConfigured();
    for(const r of rs) await c.query("INSERT INTO outbox(envelope_id,recipient_id,kind,event_key,payload) VALUES($1,$2,'signature_request',$3,$4)",[e.id,r.id,`send:${e.id}:${r.id}`,JSON.stringify({email:r.email,mode:dispatch?"email":"verification_only",dispatch})]);
    await audit(c,e,p,dispatch?"sent":"sent_verification_only",{routing:e.routing,version:e.version+1,dispatch});
    return {id:e.id,state:"sent",version:e.version+1,message:dispatch?"Frozen for signing. Signing emails are queued for delivery.":"Frozen for signing. Verification outbox created; no email sent."};
  });
}
export async function voidEnvelope(p:Principal,envelopeId:string,input:unknown) {const v=z.object({version:z.number().int(),reason:z.string().trim().min(3).max(500)}).parse(input);return transaction(async c=>{
  const e=await envelope(c,p,envelopeId,true);if(e.version!==v.version) fail(409,"VERSION_CONFLICT","Reload the envelope before voiding.");if(terminal.includes(e.state)||e.state==="draft") fail(409,"TERMINAL","Only active sent envelopes can be voided.");
  await c.query("UPDATE envelopes SET state='voided',reason=$2,version=version+1 WHERE id=$1",[e.id,v.reason]);await c.query("UPDATE recipients SET token_hash=NULL WHERE envelope_id=$1 AND status<>'signed'",[e.id]);await audit(c,e,p,"voided",{reason:v.reason});return {state:"voided"};
});}
export async function verificationLinks(p:Principal,envelopeId:string,kind:"sign"|"complete"="sign") {
  if(process.env.NODE_ENV==="production" || process.env.DEV_VERIFICATION_LINKS!=="1") fail(403,"DEV_ONLY","Verification links are disabled. Enable DEV_VERIFICATION_LINKS=1 only in isolated development.");
  const result=await transaction(async c=>{const e=await envelope(c,p,envelopeId,true);
    if(kind==="complete" ? e.state!=="completed" : terminal.includes(e.state)||e.state==="draft") return {error:new AppError(409,"LINK_UNAVAILABLE","This link type is unavailable for the envelope state.")};
    const rs=(await c.query("SELECT id,name,email,status FROM recipients WHERE envelope_id=$1 ORDER BY routing_order",[e.id])).rows;
    const links=[];
    for(const r of rs) {
      if(!r.email.endsWith(".test")) fail(403,"SYNTHETIC_ONLY","Verification links require synthetic .test recipients.");
      if(kind==="sign" && r.status==="signed") continue;
      const token=newToken();
      if(kind==="sign") await c.query("UPDATE recipients SET token_hash=$2 WHERE id=$1",[r.id,hash(token)]);
      else await c.query("INSERT INTO completion_links(recipient_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '7 days')",[r.id,hash(token)]);
      links.push({name:r.name,email:r.email,path:`/${kind==="sign"?"sign":"complete"}/${token}`});
    }
    await audit(c,e,p,"verification_links_rotated",{kind,recipientCount:links.length});return {links,warning:"Shown once. Previous signing links revoked. No email has been sent."};
  });
  if("error" in result) throw result.error;
  return result;
}
// Count abuse attempts in PostgreSQL, outside the business transaction so denials remain durable.
async function throttle(a:Access) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(a.token)) fail(404,"LINK_INVALID","This link is invalid or unavailable.");
  const keys=["token:"+hash(a.token),...(a.ip?["ip:"+hash(a.ip)]:[])];
  const blocked=await transaction(async c=>{
    let blocked=false;
    for(const key of keys) {
      const n=(await c.query("INSERT INTO request_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.window_start<clock_timestamp()-interval '1 minute' THEN 1 ELSE request_limits.count+1 END,window_start=CASE WHEN request_limits.window_start<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE request_limits.window_start END RETURNING count",[key])).rows[0].count;
      if(n>120) blocked=true;
    }
    return blocked;
  });
  if(blocked) fail(429,"RATE_LIMIT","Too many requests. Wait one minute before trying again.");
}
async function codeGate(a:Access) {
  const denied=await transaction(async c=>{
    const found=(await c.query("SELECT envelope_id FROM recipients WHERE token_hash=$1",[hash(a.token)])).rows[0];
    if(!found) return new AppError(404,"LINK_INVALID","This link is invalid or unavailable.");
    const e=(await c.query("SELECT * FROM envelopes WHERE id=$1 FOR UPDATE",[found.envelope_id])).rows[0] as Envelope;
    const r=(await c.query("SELECT * FROM recipients WHERE token_hash=$1 AND envelope_id=$2 FOR UPDATE",[hash(a.token),e.id])).rows[0] as Recipient|undefined;
    if(!r) return new AppError(404,"LINK_INVALID","This link was revoked.");
    await expire(c,e,a);
    if(["declined","expired","voided","draft"].includes(e.state)) return new AppError(410,"SIGNING_CLOSED","Signing is closed for this envelope.");
    if(!r.access_verifier) return null;
    if(r.attempts>=5) return new AppError(429,"CODE_LOCKED","Access code locked after five failed attempts. Ask the sender to void and recreate the envelope.");
    if(!a.code) return new AppError(401,"CODE_REQUIRED","Enter the recipient access code.");
    if(!verifyCode(a.code,r.access_verifier)) {
      if(r.status==="signed") return new AppError(410,"SIGNING_CLOSED","Signing is closed for this recipient.");
      await c.query("UPDATE recipients SET attempts=attempts+1 WHERE id=$1",[r.id]);
      await audit(c,e,{...a,userId:`recipient:${r.id}`},"code_failed",{attempt:r.attempts+1});
      return new AppError(r.attempts+1>=5?429:401,r.attempts+1>=5?"CODE_LOCKED":"CODE_INVALID","Access code incorrect. Five failed attempts lock this link.");
    }
    return null;
  });
  if(denied) throw denied;
}
async function signing<T>(a:Access,fn:(c:PoolClient,e:Envelope,r:Recipient)=>Promise<T>,duplicate?:{key:string;digest:string}) {
  await throttle(a);await codeGate(a);
  const result=await transaction(async c=>{
    // Always lock envelope before recipient: all recipient mutations share this order.
    const found=(await c.query("SELECT envelope_id FROM recipients WHERE token_hash=$1",[hash(a.token)])).rows[0];
    if(!found) return {error:new AppError(404,"LINK_INVALID","This link is invalid or unavailable.")};
    const e=(await c.query("SELECT * FROM envelopes WHERE id=$1 FOR UPDATE",[found.envelope_id])).rows[0] as Envelope;
    const r=(await c.query("SELECT * FROM recipients WHERE token_hash=$1 AND envelope_id=$2 FOR UPDATE",[hash(a.token),e.id])).rows[0] as Recipient|undefined;
    if(!r) return {error:new AppError(404,"LINK_INVALID","This signing link was revoked.")};
    await expire(c,e,a);
    if(duplicate && r.status==="signed" && r.submission_key===duplicate.key && r.submission_hash===duplicate.digest && ["completed","part-signed"].includes(e.state)) return {value:{state:e.state,idempotent:true} as T};
    if(terminal.includes(e.state)||e.state==="draft"||r.status==="signed"||r.status==="declined") return {error:new AppError(410,"SIGNING_CLOSED","Signing is closed for this recipient or envelope.")};
    if(r.attempts>=5) return {error:new AppError(429,"CODE_LOCKED","This recipient access code is locked.")};
    if(e.routing==="sequential" && (await c.query("SELECT 1 FROM recipients WHERE envelope_id=$1 AND routing_order<$2 AND status<>'signed'",[e.id,r.routing_order])).rowCount) return {error:new AppError(409,"WAITING_FOR_RECIPIENT","An earlier recipient must sign first.")};
    return {value:await fn(c,e,r)};
  });
  if("error" in result) throw result.error;return result.value;
}
export async function signingView(a:Access) {return signing(a,async(c,e,r)=>{
  if(r.status==="pending") {await c.query("UPDATE recipients SET status='viewed' WHERE id=$1",[r.id]);await c.query("UPDATE envelopes SET state=CASE WHEN state='sent' THEN 'viewed' ELSE state END WHERE id=$1",[e.id]);await audit(c,e,{...a,userId:`recipient:${r.id}`},"viewed");}
  await audit(c,e,{...a,userId:`recipient:${r.id}`},"signing_accessed");
  const branding=(await c.query("SELECT coalesce(nullif(s.brand_name,''),c.name) AS name,s.brand_color AS color,s.logo FROM companies c LEFT JOIN company_settings s ON s.company_id=c.id WHERE c.id=$1",[e.company_id])).rows[0];
  const source=(await c.query("SELECT coalesce(nullif(s.brand_name,''),c.name) AS name,s.brand_color AS color,s.logo FROM companies c LEFT JOIN company_settings s ON s.company_id=c.id WHERE c.id=$1",[e.company_id])).rows[0]??{name:e.title,color:"#2563eb",logo:null};
  return {branding:source,id:e.id,title:e.title,state:e.state,expiresAt:e.expires_at,recipient:{id:r.id,name:r.name,email:r.email,consented:!!r.consent_at},fields:e.fields.filter(f=>f.recipientId===r.id),documents:(await c.query("SELECT id,name,geometry FROM documents WHERE envelope_id=$1 ORDER BY created_at,id",[e.id])).rows};
});}
export async function consent(a:Access) {return signing(a,async(c,e,r)=>{
  if(!r.consent_at) {await c.query("UPDATE recipients SET consent_at=clock_timestamp() WHERE id=$1",[r.id]);await audit(c,e,{...a,userId:`recipient:${r.id}`},"consent",{textVersion:"electronic-consent-v1",text:CONSENT_TEXT,textSha256:hash(CONSENT_TEXT),typedSignature:true});}return {consented:true};
});}
export async function signingDocument(a:Access,documentId:string) {return signing(a,async(c,e,r)=>{
  const d=(await c.query("SELECT id,name,signing AS bytes,sha256 FROM documents WHERE id=$1 AND envelope_id=$2",[id(documentId),e.id])).rows[0];if(!d) fail(404,"NOT_FOUND","Document not found.");if(hash(d.bytes)!==d.sha256) fail(500,"INTEGRITY_FAILED","Stored document hash verification failed.");await audit(c,e,{...a,userId:`recipient:${r.id}`},"document_accessed",{documentId});return d;
});}
async function complete(c:PoolClient,e:Envelope,p:{userId?:string;ip?:string;ua?:string}) {
  const docs=(await c.query("SELECT * FROM documents WHERE envelope_id=$1 ORDER BY created_at,id",[e.id])).rows;
  const rs=(await c.query("SELECT id,name,email,values,consent_at,signed_at FROM recipients WHERE envelope_id=$1 ORDER BY routing_order,id",[e.id])).rows;
  if(rs.some(r=>!r.consent_at||!r.signed_at)) fail(500,"INTEGRITY_FAILED","Completion requires consent and a signature from every recipient.");
  const values=Object.assign({},...rs.map(r=>r.values));const digests=[];
  for(const d of docs) {
    if(hash(d.original)!==d.sha256 || hash(d.signing)!==d.sha256) fail(500,"INTEGRITY_FAILED","Document integrity check failed; completion was rolled back.");
    const bytes=await flatten(d.signing,e.fields.filter(f=>f.documentId===d.id),values),sha=hash(bytes);
    await c.query("INSERT INTO outputs(envelope_id,document_id,kind,name,bytes,sha256,size) VALUES($1,$2,'signed_pdf',$3,$4,$5,$6)",[e.id,d.id,d.name.replace(/\.pdf$/i,"-signed.pdf"),bytes,sha,bytes.length]);
    digests.push({documentId:d.id,name:d.name,originalSha256:d.sha256,completedSha256:sha,completedBytes:bytes.length});
  }
  await c.query("UPDATE envelopes SET state='completed',completed_at=clock_timestamp(),version=version+1 WHERE id=$1",[e.id]);
  const completedAt=(await c.query("SELECT completed_at FROM envelopes WHERE id=$1",[e.id])).rows[0].completed_at;
  await audit(c,e,p,"completed",{documents:digests});
  const events=(await c.query("SELECT id,actor,event,ip,ua,data,created_at FROM audit_events WHERE envelope_id=$1 ORDER BY created_at,id",[e.id])).rows;
  const receipt=Buffer.from(JSON.stringify({format:"Accord evidence v1",envelopeId:e.id,title:e.title,completedAt,routing:e.routing,documents:digests,recipients:rs.map(({values,...r})=>r),events,notice:"Evidence receipt generated by Accord. The SHA-256 digests identify the exact original and signed files; events record consent, signing and access with UTC timestamps. This receipt is not a qualified electronic signature certificate."},null,2));
  await c.query("INSERT INTO outputs(envelope_id,kind,name,bytes,sha256,size) VALUES($1,'receipt','completion-receipt.json',$2,$3,$4)",[e.id,receipt,hash(receipt),receipt.length]);
  await c.query("INSERT INTO outbox(envelope_id,kind,event_key,payload) VALUES($1,'completion',$2,$3)",[e.id,`complete:${e.id}`,JSON.stringify(process.env.NODE_ENV==="production"&&process.env.EMAIL_DISPATCH_ENABLED==="1"&&mailConfigured()?{dispatch:true,mode:"email"}:{dispatch:false,mode:"verification_only"})]);
}
export async function submit(a:Access,input:unknown) {
  const v=z.object({idempotencyKey:z.uuid(),values:valuesInput}).parse(input);
  const digest=hash(JSON.stringify(Object.fromEntries(Object.entries(v.values).sort(([a],[b])=>a.localeCompare(b)))));
  return signing(a,async(c,e,r)=>{
    if(!r.consent_at) fail(409,"CONSENT_REQUIRED","Give explicit electronic consent before signing.");
    const assigned=e.fields.filter(f=>f.recipientId===r.id);try {validateValues(assigned,v.values);}catch(err){fail(400,"FIELDS_REQUIRED",(err as Error).message);}
    await c.query("UPDATE recipients SET status='signed',signed_at=clock_timestamp(),values=$2,submission_key=$3,submission_hash=$4 WHERE id=$1",[r.id,JSON.stringify(v.values),v.idempotencyKey,digest]);
    await audit(c,e,{...a,userId:`recipient:${r.id}`},"signed",{fields:assigned.map(f=>f.id),idempotencyKey:v.idempotencyKey});
    const remaining=(await c.query("SELECT 1 FROM recipients WHERE envelope_id=$1 AND status<>'signed'",[e.id])).rowCount;
    if(!remaining) {await complete(c,e,{...a,userId:`recipient:${r.id}`});return {state:"completed",idempotent:false};}
    await c.query("UPDATE envelopes SET state='part-signed',version=version+1 WHERE id=$1",[e.id]);return {state:"part-signed",idempotent:false};
  },{key:v.idempotencyKey,digest});
}
export async function decline(a:Access,reason:string) {z.string().trim().min(3).max(500).parse(reason);return signing(a,async(c,e,r)=>{
  await c.query("UPDATE recipients SET status='declined' WHERE id=$1",[r.id]);await c.query("UPDATE envelopes SET state='declined',reason=$2,version=version+1 WHERE id=$1",[e.id,reason]);await audit(c,e,{...a,userId:`recipient:${r.id}`},"declined",{reason});return {state:"declined"};
});}
export async function senderDocument(p:Principal,envelopeId:string,documentId:string,output=false) {return transaction(async c=>{
  const e=await envelope(c,p,envelopeId);const d=(await c.query(output?"SELECT name,bytes,sha256,kind FROM outputs WHERE id=$1 AND envelope_id=$2":"SELECT name,original AS bytes,sha256,'original' AS kind FROM documents WHERE id=$1 AND envelope_id=$2",[id(documentId),e.id])).rows[0];
  if(!d) fail(404,"NOT_FOUND","File not found.");if(hash(d.bytes)!==d.sha256) fail(500,"INTEGRITY_FAILED","Stored file hash verification failed.");await audit(c,e,p,"sender_downloaded",{documentId,sha256:d.sha256,kind:d.kind});return d;
});}
export async function completionView(a:Access,outputId?:string) {
  await throttle(a);return transaction(async c=>{
    const r=(await c.query("SELECT r.id,r.envelope_id FROM completion_links l JOIN recipients r ON r.id=l.recipient_id WHERE l.token_hash=$1 AND l.expires_at>clock_timestamp()",[hash(a.token)])).rows[0];
    if(!r) fail(410,"COMPLETION_LINK_INVALID","This completion link is invalid or expired.");
    const e=(await c.query("SELECT * FROM envelopes WHERE id=$1 FOR SHARE",[r.envelope_id])).rows[0] as Envelope;
    if((await c.query("SELECT 1 FROM envelope_lifecycle WHERE envelope_id=$1 AND deleted_at IS NOT NULL",[e.id])).rowCount)fail(410,"COMPLETION_UNAVAILABLE","Completed files are unavailable.");
    if(e.state!=="completed") fail(410,"COMPLETION_UNAVAILABLE","Completed files are unavailable.");
    if(!outputId) return {title:e.title,outputs:(await c.query("SELECT id,name,kind,sha256,size FROM outputs WHERE envelope_id=$1 ORDER BY created_at,id",[e.id])).rows};
    const d=(await c.query("SELECT name,bytes,sha256,kind FROM outputs WHERE id=$1 AND envelope_id=$2",[id(outputId),e.id])).rows[0];if(!d) fail(404,"NOT_FOUND","File not found.");if(hash(d.bytes)!==d.sha256) fail(500,"INTEGRITY_FAILED","Stored file hash verification failed.");await audit(c,e,{...a,userId:`completion:${r.id}`},"completion_downloaded",{outputId,sha256:d.sha256});return d;
  });
}
export async function team(p:Principal) {return transaction(async c=>{const m=await member(c,p);if(m.role!=="admin") fail(403,"ADMIN_REQUIRED","Only a company administrator can manage the team.");return (await c.query('SELECT m.id,m.user_id,m.role,m.active,u.name,u.email,(SELECT count(*)::int FROM envelopes e WHERE e.owner_id=m.user_id AND e.company_id=m.company_id) AS envelopes FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.company_id=$1 ORDER BY u.name',[p.companyId])).rows;});}
export async function changeMember(p:Principal,input:unknown) {const v=z.object({memberId:z.uuid(),active:z.boolean(),role:z.enum(["admin","sender","read-only"]),reassignTo:z.string().optional()}).parse(input);return transaction(async c=>{
  // Serialize team administration before taking membership locks.
  await c.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE",[id(p.companyId)]);
  const m=await member(c,p,true);if(m.role!=="admin") fail(403,"ADMIN_REQUIRED","Only administrators can change team access.");
  const target=(await c.query("SELECT * FROM memberships WHERE id=$1 AND company_id=$2 FOR UPDATE",[v.memberId,p.companyId])).rows[0];if(!target) fail(404,"NOT_FOUND","Team member not found.");if(target.user_id===p.userId) fail(400,"SELF_CHANGE","Ask another administrator to change your own access.");
  if(v.reassignTo) {await c.query("UPDATE templates SET owner_id=$3 WHERE company_id=$1 AND owner_id=$2",[p.companyId,target.user_id,v.reassignTo]);const to=(await c.query("SELECT * FROM memberships WHERE user_id=$1 AND company_id=$2 AND active AND role IN ('admin','sender') FOR SHARE",[v.reassignTo,p.companyId])).rows[0];if(!to||to.user_id===target.user_id) fail(400,"OWNER_INVALID","Choose another active sender or administrator.");
    const moved=(await c.query("UPDATE envelopes SET owner_id=$3,version=version+1 WHERE company_id=$1 AND owner_id=$2 RETURNING id",[p.companyId,target.user_id,to.user_id])).rows;for(const e of moved) await audit(c,{company_id:p.companyId,id:e.id},p,"owner_reassigned",{from:target.user_id,to:to.user_id});}
  await c.query("UPDATE memberships SET active=$2,role=$3 WHERE id=$1",[target.id,v.active,v.role]);await audit(c,{company_id:p.companyId},p,"member_access_changed",{userId:target.user_id,active:v.active,role:v.role});return {updated:true};
});}
export async function shareEnvelope(p:Principal,envelopeId:string,userId:string) {return transaction(async c=>{const e=await envelope(c,p,envelopeId,true);const m=(await c.query("SELECT 1 FROM memberships WHERE company_id=$1 AND user_id=$2 AND active FOR SHARE",[p.companyId,userId])).rowCount;if(!m) fail(400,"MEMBERSHIP_REQUIRED","Sharing requires an active member of this company.");await c.query("INSERT INTO envelope_shares(envelope_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[e.id,userId]);await audit(c,e,p,"shared",{userId});return {shared:true};});}
