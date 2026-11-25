import { createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import type { PoolClient } from "pg";
import { transaction,getPool } from "./db";
import { hash,newToken } from "./crypto";
import { fail } from "./errors";
import { renderEmail, PRODUCT_NAME } from "./email-template";

function key(){if(!process.env.BETTER_AUTH_SECRET||process.env.BETTER_AUTH_SECRET.length<32)fail(503,"SECRET_REQUIRED","Configure the stable authentication secret before queuing private links.");return createHash('sha256').update(process.env.BETTER_AUTH_SECRET).digest();}
export function seal(value:unknown){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv),bytes=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return 'v1.'+Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');}
export function unseal<T=any>(value:string):T{if(!value.startsWith('v1.'))throw new Error('Unsupported encrypted queue format');const b=Buffer.from(value.slice(3),'base64'),d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());}
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function publicOrigin(){const u=new URL(process.env.BETTER_AUTH_URL??'http://localhost:3000');if(process.env.NODE_ENV==='production'&&u.protocol!=='https:')fail(503,"ORIGIN_REQUIRED","Configure the HTTPS public application origin.");return u.origin;}
export async function queueMail(c:PoolClient,v:{companyId:string;envelopeId?:string;recipientId?:string;kind:string;key:string;email:string;subject:string;text:string;tokenHash?:string;actionTokenId?:string}) {
 // Returns true only when a new job was queued (the event key dedupes repeats).
 return ((await c.query("INSERT INTO delivery_jobs(company_id,envelope_id,recipient_id,kind,event_key,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_key) DO NOTHING",[v.companyId,v.envelopeId??null,v.recipientId??null,v.kind,v.key,seal(v)])).rowCount??0)>0;
}
export async function queueSigning(c:PoolClient,e:any,r:any,kind='signing_request',suffix='initial') {
 const token=newToken(),digest=hash(token);
 await c.query("UPDATE recipients SET token_hash=$2 WHERE id=$1",[r.id,digest]);
 await queueMail(c,{companyId:e.company_id,envelopeId:e.id,recipientId:r.id,kind,key:`${kind}:${e.id}:${r.id}:${suffix}`,email:r.email,subject:`Signature requested: ${e.title}`,text:`Review and sign ${e.title}: ${publicOrigin()}/sign/${token}`,tokenHash:digest});
}
export async function queueCompletionCopy(c:PoolClient,e:{id:string;company_id:string;title:string},initial:boolean) {
 const token=newToken(),digest=hash(token);
 const copy=(await c.query(
   `UPDATE completion_copies SET generation=generation+1,token_hash=$2,
      expires_at=clock_timestamp()+interval '30 days',revoked_at=NULL
      WHERE envelope_id=$1 AND ($3=false OR generation=0) RETURNING email,generation`,
   [e.id,digest,initial],
 )).rows[0];
 if(!copy)return;
 await queueMail(c,{companyId:e.company_id,envelopeId:e.id,kind:'external_completion_copy',
   key:`external-copy:${e.id}:${copy.generation}`,email:copy.email,tokenHash:digest,
   subject:`Completed documents: ${e.title}`,
   text:`The signed PDFs are ready. Download within 30 days: ${publicOrigin()}/complete/${token}`});
}
const statusEvents=['sent','sent_verification_only','viewed','signed','completed','declined','voided','expired'];
export async function queueStatus(c:PoolClient,e:any,event:string,eventId:string) {
 if(!e.id||!statusEvents.includes(event))return;
 const s=(await c.query('SELECT * FROM company_settings WHERE company_id=$1',[e.company_id])).rows[0];
 if(s?.webhook_url&&s.webhook_secret){const payload=JSON.stringify({id:eventId,type:event==='sent_verification_only'?'sent':event,envelopeId:e.id,companyId:e.company_id,occurredAt:new Date().toISOString()});await c.query('INSERT INTO webhook_events(id,company_id,envelope_id,event,payload,endpoint,secret) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[eventId,e.company_id,e.id,event,payload,s.webhook_url,s.webhook_secret]);}
 if(['signed','completed','declined','voided','expired'].includes(event)) {
  const owner=(await c.query('SELECT u.email FROM envelopes e JOIN "user" u ON u.id=e.owner_id WHERE e.id=$1',[e.id])).rows[0];
  if(owner)await queueMail(c,{companyId:e.company_id,envelopeId:e.id,kind:'sender_notification',key:`notify:${eventId}`,email:owner.email,subject:`Envelope ${event}: ${e.title}`,text:`"${e.title}" is now ${event}. The activity record keeps every step. View the envelope: ${publicOrigin()}/envelopes/${e.id}`});
 }
 if(event==='completed')for(const r of (await c.query('SELECT id,email FROM recipients WHERE envelope_id=$1',[e.id])).rows){const token=newToken();await c.query("INSERT INTO completion_links(recipient_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '30 days')",[r.id,hash(token)]);await queueMail(c,{companyId:e.company_id,envelopeId:e.id,recipientId:r.id,kind:'completion_copy',key:`copy:${e.id}:${r.id}`,email:r.email,subject:`Completed documents: ${e.title}`,text:`Download your completed PDFs and receipt: ${publicOrigin()}/complete/${token}`});}
 if(event==='completed')await queueCompletionCopy(c,e,true);
}
// Check immediately before every transport call while holding the envelope lock.
// The same check runs for automatic and manual retries.
export async function deliveryEligibility(c:PoolClient,job:any,payload:any):Promise<'eligible'|'cancelled'|'waiting'> {
 if(job.envelope_id){const e=(await c.query('SELECT e.*,l.deleted_at FROM envelopes e LEFT JOIN envelope_lifecycle l ON l.envelope_id=e.id WHERE e.id=$1 FOR UPDATE OF e',[job.envelope_id])).rows[0];if(!e||e.deleted_at)return 'cancelled';
  if(['signing_request','reminder','link_reissue'].includes(job.kind)){
   const r=(await c.query('SELECT * FROM recipients WHERE id=$1 AND envelope_id=$2 FOR UPDATE',[job.recipient_id,e.id])).rows[0];
   const expired=e.expires_at&&new Date(e.expires_at).getTime()<=Date.now();
   if(!r||!['sent','viewed','part-signed'].includes(e.state)||expired||['signed','declined'].includes(r.status)||r.token_hash!==payload.tokenHash||r.attempts>=5)return 'cancelled';
   if(e.routing==='sequential'&&(await c.query("SELECT 1 FROM recipients WHERE envelope_id=$1 AND routing_order<$2 AND status<>'signed'",[e.id,r.routing_order])).rowCount)return 'waiting';
  }
  if(job.kind==='completion_copy'&&e.state!=='completed')return 'cancelled';
  if(job.kind==='external_completion_copy'){
   if(e.state!=='completed')return 'cancelled';
   const active=await c.query(`SELECT 1 FROM completion_copies WHERE envelope_id=$1 AND token_hash=$2
     AND revoked_at IS NULL AND expires_at>clock_timestamp()`,[e.id,payload.tokenHash]);
   if(!active.rowCount)return 'cancelled';
  }
 }
 if(payload.actionTokenId){const t=(await c.query('SELECT * FROM action_tokens WHERE id=$1 FOR UPDATE',[payload.actionTokenId])).rows[0];if(!t||t.used_at||new Date(t.expires_at).getTime()<=Date.now())return 'cancelled';if(t.kind==='invite'&&!(await c.query("SELECT 1 FROM memberships WHERE company_id=$1 AND user_id=$2 AND active=true AND role='admin'",[t.company_id,t.user_id])).rowCount)return 'cancelled';}
 return 'eligible';
}
export function mailProvider(){return process.env.RESEND_API_KEY?'resend':process.env.BREVO_API_KEY?'brevo':null;}
export function mailConfigured(){return !!(mailProvider()&&process.env.EMAIL_FROM);}
export async function providerSend(v:{email:string;subject:string;text:string;html:string;key:string;attachments?:any[]},transport:typeof fetch=fetch) {
 if(!mailConfigured())return {status:'not_configured',detail:'not delivered / provider not configured'};
 if(process.env.NODE_ENV!=='production'||process.env.EMAIL_DISPATCH_ENABLED!=='1')return {status:'disabled',detail:'not delivered / dispatch disabled'};
 // Synthetic QA addresses can never leave the app, even when production dispatch is enabled.
 if(v.email.toLowerCase().endsWith('.test'))return {status:'qa_blocked',detail:'not sent / .test test address'};
 const from=z.email().parse(process.env.EMAIL_FROM);
 try {
  if(mailProvider()==='resend'){
   // Resend keeps the Idempotency-Key for 24 h, so a retried job cannot send the same email twice.
   const r=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':createHash('sha256').update(String(v.key)).digest('hex')},body:JSON.stringify({from:`${PRODUCT_NAME} <${from}>`,to:[v.email],subject:v.subject,text:v.text,html:v.html,...(v.attachments?{attachments:v.attachments.map((a:any)=>({filename:a.name,content:a.content}))}:{})})});
   if(r.ok){const value=await r.json();if(!value?.id)return {status:'uncertain',detail:'Provider accepted without a message id; reconcile before resend'};return {status:'provider_accepted',detail:'Accepted by provider; inbox delivery unverified',providerId:String(value.id)};}
   return {status:[409,429,500,503].includes(r.status)?'retry':'failed',detail:`Provider HTTP ${r.status}`};
  }
  const r=await transport('https://api.brevo.com/v3/smtp/email',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'api-key':process.env.BREVO_API_KEY!,'content-type':'application/json'},body:JSON.stringify({sender:{email:from},to:[{email:v.email}],subject:v.subject,textContent:v.text,htmlContent:v.html,headers:{idempotencyKey:createHash('sha256').update(String(v.key)).digest('hex').slice(0,32)},...(v.attachments?{attachment:v.attachments}:{})})});
  if(r.ok){const value=await r.json();return {status:'provider_accepted',detail:'Accepted by provider; inbox delivery unverified',providerId:String(value.messageId??'')};}
  return {status:r.status===429?'retry':'failed',detail:`Provider HTTP ${r.status}`};
 }catch{return {status:'uncertain',detail:'Provider outcome unknown; automatic retry stopped to prevent duplicate email'};}
}
export function signature(secret:string,timestamp:string,payload:string){return createHmac('sha256',secret).update(`${timestamp}.${payload}`).digest('hex');}
export function verifyWebhook(secret:string,timestamp:string,payload:string,digest:string,now=Date.now()) {
 if(!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||!/^[a-f0-9]{64}$/.test(digest))return false;
 return timingSafeEqual(Buffer.from(signature(secret,timestamp,payload),'hex'),Buffer.from(digest,'hex'));
}
export function safeWebhookUrl(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||u.hostname.length>253||u.hostname.toLowerCase()==='localhost')throw new Error('Webhook requires a public HTTPS endpoint on port 443');return u;}
export function publicAddress(address:string){try{return ipaddr.process(address).range()==='unicast';}catch{return false;}}
// Node 20+ connects with autoSelectFamily and calls lookup with {all:true}, expecting an array.
export function pinnedLookup(a:{address:string;family:number}){return (_host:string,opts:any,cb:any)=>opts?.all?cb(null,[{address:a.address,family:a.family}]):cb(null,a.address,a.family);}
export async function webhookSend(raw:string,body:string,headers:Record<string,string>):Promise<number> {
 const u=safeWebhookUrl(raw),addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('Webhook DNS resolved to a private or reserved address');
 const address=addresses[0];
 // Pin the validated resolution to this request; no redirect or second DNS lookup.
 return new Promise((resolve,reject)=>{const req=request(u,{method:'POST',headers:{...headers,'content-type':'application/json','content-length':String(Buffer.byteLength(body))},lookup:pinnedLookup(address) as any},res=>{res.destroy();resolve(res.statusCode??500);});req.setTimeout(10000,()=>req.destroy(new Error('timeout')));req.on('error',reject);req.end(body);});
}
async function attempt(c:PoolClient,id:string,status:string,detail:string){await c.query('INSERT INTO delivery_attempts(job_id,status,detail) VALUES($1,$2,$3)',[id,status,detail]);}
async function scheduleJobs(c:PoolClient){
 const result={expired:0,archived:0,reminders:0,mail:0,webhooks:0};
 for(const e of (await c.query("SELECT * FROM envelopes WHERE state IN ('sent','viewed','part-signed') AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED")).rows){await c.query("UPDATE envelopes SET state='expired',version=version+1 WHERE id=$1",[e.id]);const a=(await c.query("INSERT INTO audit_events(company_id,envelope_id,actor,event) VALUES($1,$2,'scheduler','expired') RETURNING id",[e.company_id,e.id])).rows[0];await queueStatus(c,e,'expired',a.id);result.expired++;}
 for(const e of (await c.query("SELECT e.* FROM envelopes e JOIN envelope_lifecycle l ON l.envelope_id=e.id WHERE e.state IN ('completed','declined','expired','voided') AND l.retention_at<=clock_timestamp() AND l.archived_at IS NULL AND l.deleted_at IS NULL LIMIT 100 FOR UPDATE OF e SKIP LOCKED")).rows){await c.query('UPDATE envelope_lifecycle SET archived_at=clock_timestamp() WHERE envelope_id=$1',[e.id]);await c.query("INSERT INTO audit_events(company_id,envelope_id,actor,event) VALUES($1,$2,'scheduler','retention_archived')",[e.company_id,e.id]);result.archived++;}
 // Store encrypted links when issuing them; reminder jobs reuse the current link, never rotate it.
 const candidates=(await c.query("SELECT j.*,l.reminder_days FROM delivery_jobs j JOIN envelopes e ON e.id=j.envelope_id LEFT JOIN envelope_lifecycle l ON l.envelope_id=e.id WHERE j.kind IN ('signing_request','link_reissue') AND e.state IN ('sent','viewed','part-signed') AND e.expires_at>clock_timestamp() AND j.created_at<clock_timestamp()-coalesce(l.reminder_days,3)*interval '1 day' ORDER BY j.created_at DESC LIMIT 100")).rows;
 for(const j of candidates){if(j.reminder_days===0)continue;const p=unseal(j.payload);if(await queueMail(c,{...p,subject:`Reminder: ${String(p.subject).replace(/^Reminder: /,'')}`,kind:'reminder',key:`scheduled:${j.recipient_id}:${new Date().toISOString().slice(0,10)}`}))result.reminders++;}
 return result;
}
export async function runJobs(){
 {
  // No session-level lock: with a transaction-pooling proxy (Neon pooler) a session advisory lock can stay held
  // on a pooled backend and block every later run. The periodic step takes a transaction-scoped lock (released
  // at COMMIT); delivery and webhook claims are already safe across runners (FOR UPDATE SKIP LOCKED + status).
  // Claims commit BEFORE transport. A crash never rolls an accepted send back
  // into pending. Stale processing mail requires operator reconciliation.
  await transaction(async c=>{await c.query("UPDATE delivery_jobs SET status='uncertain',last_error='Worker interrupted; reconcile with provider before any resend' WHERE status='processing' AND next_at<clock_timestamp()");await c.query("UPDATE webhook_events SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'retry' END WHERE status='processing' AND next_at<clock_timestamp()");});
  const result=await transaction(async c=>(await c.query("SELECT pg_try_advisory_xact_lock(hashtext('team-esign-durable-tick')) AS locked")).rows[0].locked?scheduleJobs(c):{expired:0,archived:0,reminders:0,mail:0,webhooks:0});
  for(let i=0;i<20;i++){
   const j=await transaction(async c=>(await c.query("UPDATE delivery_jobs SET status='processing',next_at=clock_timestamp()+interval '10 minutes' WHERE id=(SELECT id FROM delivery_jobs WHERE status IN ('pending','retry','not_configured','disabled','waiting') AND attempts<5 AND next_at<=clock_timestamp() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *")).rows[0]);
   if(!j)break;
   try{await transaction(async c=>{
    const p=unseal(j.payload),eligible=await deliveryEligibility(c,j,p);let r:{status:string;detail:string;providerId?:string};
    if(eligible!=='eligible')r={status:eligible,detail:eligible==='waiting'?'Waiting for earlier recipient':'Request no longer eligible'};
    else {
     const s=(await c.query('SELECT * FROM company_settings WHERE company_id=$1',[j.company_id])).rows[0],company=(await c.query('SELECT name FROM companies WHERE id=$1',[j.company_id])).rows[0];
     const name=s?.brand_name||company.name,color=/^#[a-fA-F0-9]{6}$/.test(s?.brand_color??'')?s.brand_color:'#2563eb';
     const m=renderEmail({kind:j.kind,subject:p.subject,text:p.text,company:name,brandColor:color,logo:s?.logo});
     r=await providerSend({...p,text:m.text,html:m.html,key:j.event_key});result.mail++;
    }
    const count=['retry','failed','uncertain','provider_accepted'].includes(r.status)?1:0;
    if(r.status==='retry'&&j.attempts>=4)r.status='failed';
    await c.query("UPDATE delivery_jobs SET status=$2,last_error=$3,provider_id=$4,attempts=attempts+$5,next_at=clock_timestamp()+interval '5 minutes' WHERE id=$1",[j.id,r.status,r.detail,r.providerId??null,count]);await attempt(c,j.id,r.status,r.detail);
   });}catch{await transaction(async c=>{await c.query("UPDATE delivery_jobs SET status='uncertain',last_error='Worker could not finalize this delivery; reconcile before resend' WHERE id=$1",[j.id]);await attempt(c,j.id,'uncertain','Worker interrupted or encrypted payload unavailable');});}
  }
  if(process.env.WEBHOOK_DISPATCH_ENABLED==='1'&&process.env.NODE_ENV==='production')for(let i=0;i<10;i++){
   const e=await transaction(async c=>(await c.query("UPDATE webhook_events SET status='processing',attempts=attempts+1,next_at=clock_timestamp()+interval '10 minutes' WHERE id=(SELECT id FROM webhook_events WHERE status IN ('pending','retry') AND attempts<5 AND next_at<=clock_timestamp() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *")).rows[0]);
   if(!e)break;const ts=String(Math.floor(Date.now()/1000));let status=e.attempts>=5?'failed':'retry',detail='Network failure or unsafe endpoint';
   try{const code=await webhookSend(e.endpoint,e.payload,{'x-esign-id':e.id,'x-esign-timestamp':ts,'x-esign-signature':signature(unseal<string>(e.secret),ts,e.payload)});status=code>=200&&code<300?'accepted':e.attempts>=5?'failed':'retry';detail=`HTTP ${code}`;}catch{}
   await transaction(async c=>{await c.query("UPDATE webhook_events SET status=$2,last_error=$3,next_at=clock_timestamp()+power(2,attempts)*interval '1 minute' WHERE id=$1",[e.id,status,detail]);await c.query('INSERT INTO webhook_attempts(event_id,status) VALUES($1,$2)',[e.id,`${status}: ${detail}`]);});result.webhooks++;
  }
  await transaction(c=>c.query('INSERT INTO job_runs(result) VALUES($1)',[JSON.stringify(result)]));return result;
 }
}
export function authenticateTick(req:Request){const secret=process.env.JOB_TICK_SECRET;if(!secret||secret.length<32)fail(503,'SCHEDULER_NOT_CONFIGURED','Configure a private JOB_TICK_SECRET before enabling the external scheduler.');const value=req.headers.get('authorization')??'',expected=`Bearer ${secret}`;if(value.length!==expected.length||!timingSafeEqual(Buffer.from(value),Buffer.from(expected)))fail(401,'JOB_UNAUTHORIZED','Scheduler authentication failed.');}
