import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { PDFDocument, degrees, PDFName } from "pdf-lib";
import { getPool, transaction } from "../server/db";
import { getAuth } from "../server/auth";
import { hash,newToken } from "../server/crypto";
import { syntheticPdf } from "../server/pdf";
import * as workflow from "../server/workflow";
import * as f from "../server/features";
import * as automation from "../server/automation";
import { bulkConfirm, bulkHistory, bulkPreview } from "../server/template-send";
import { changeCompletionCopy, getCompletionCopy } from "../server/completion-copy";
import { listPublications, managePublication, publicSigningPage, redeemSigningVerification, requestSigningVerification, signingVerificationStatus } from "../server/public-signing";
import { backupExport } from "../server/recovery";
import { receiveWebhook } from "../server/webhook-receiver";
import type { Principal, Access } from "../server/workflow";
import type { Field } from "../lib/model";
import { GET as workspaceRoute } from "../app/api/workspace/route";
import { GET as envelopeRoute, PATCH as saveRoute } from "../app/api/envelopes/[id]/route";
import { POST as recipientAction } from "../app/api/sign/[token]/[action]/route";

// No schema reset, truncation, fake database or network server. Fixtures remain synthetic
// and auditable in the explicitly approved development database after the test run.
assert.ok(process.env.DATABASE_URL&&process.env.TEAM_ESIGN_DEV_DATABASE==="1"&&process.env.NODE_ENV!=="production","Run through pnpm test:integration with an isolated migrated development database.");
process.env.BETTER_AUTH_SECRET??=randomBytes(32).toString("hex");
process.env.BETTER_AUTH_URL??="http://localhost:3000";
process.env.DEV_VERIFICATION_LINKS="1";
const origin=new URL(process.env.BETTER_AUTH_URL).origin;
const users:Record<string,Principal&{email:string;memberId:string}>={};
const password="Synthetic-"+randomUUID();
let suffix="";
let portrait:Buffer,rotated:Buffer;
let cookie="";
async function signIn(user:Principal&{email:string}) {
 const result=await getAuth().handler(new Request(origin+"/api/auth/sign-in/email",{method:"POST",headers:{origin,"content-type":"application/json","x-forwarded-for":user.userId},body:JSON.stringify({email:user.email,password,rememberMe:false})}));
 assert.equal(result.status,200,await result.clone().text());return result.headers.getSetCookie().map(v=>v.split(";")[0]).filter(v=>!v.endsWith("=")).join("; ");
}
before(async()=>{
 const pool=getPool();
 const ready=await pool.query("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='completion_consistency' AND NOT tgisinternal) AS ready");assert.ok(ready.rows[0].ready,"Apply pnpm db:migrate, including 0002_completion_integrity, before integration tests.");
 const encoded=await hashPassword(password);suffix=randomUUID();
 await transaction(async c=>{
  for(const group of ["a","b"]){const companyId=randomUUID();await c.query("INSERT INTO companies(id,name) VALUES($1,$2)",[companyId,`Synthetic integration ${group} ${suffix}`]);
   for(const role of ["admin","sender","read-only","removed","other-sender"]){const userId=randomUUID(),memberId=randomUUID(),email=`${role}.${group}.${suffix}@qa.test`;
    await c.query('INSERT INTO "user"(id,name,email,email_verified) VALUES($1,$2,$3,true)',[userId,`Synthetic ${role}`,email]);
    await c.query("INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES($1,$2,'credential',$2,$3,now())",[randomUUID(),userId,encoded]);
    await c.query("INSERT INTO memberships(id,company_id,user_id,role) VALUES($1,$2,$3,$4)",[memberId,companyId,userId,["removed","other-sender"].includes(role)?"sender":role]);
    users[`${group}:${role}`]={companyId,userId,email,memberId,ip:"127.0.0.1",ua:"Synthetic integration test"};
   }
  }
 });
 portrait=await syntheticPdf("SYNTHETIC integration agreement");const p=await PDFDocument.create(),page=p.addPage([700,900]);page.setCropBox(30,40,600,800);page.setRotation(degrees(90));page.drawText("SYNTHETIC integration schedule",{x:60,y:700,size:12});rotated=Buffer.from(await p.save());
});
after(async()=>{await getPool().end();});
const sender=()=>users["a:sender"],admin=()=>users["a:admin"];
async function denied(action:Promise<unknown>,code:string){await assert.rejects(action,(e:unknown)=>(e as {code?:string})?.code===code);}
async function makeDraft(mode:"parallel"|"sequential",codes=false,owner=sender()) {
 let e=await workflow.createEnvelope(owner,`Synthetic ${mode} two PDFs / two recipients`);
 e=await workflow.uploadDocument(owner,e.id,e.version,"Agreement.pdf",portrait);
 e=await workflow.uploadDocument(owner,e.id,e.version,"Rotated schedule.pdf",rotated);
 const rs=[{id:randomUUID(),name:"Avery Morgan",email:"avery@client.test",order:1,...(codes?{accessCode:"Avery-code-123"}:{})},{id:randomUUID(),name:"Jordan Lee",email:"jordan@client.test",order:2,...(codes?{accessCode:"Jordan-code-123"}:{})}];
 const fields:Field[]=e.documents.flatMap(d=>rs.flatMap((r,i)=>[{id:randomUUID(),documentId:d.id,recipientId:r.id,type:"signature" as const,page:0,x:60+i*250,y:100,width:180,height:40,required:true},{id:randomUUID(),documentId:d.id,recipientId:r.id,type:"date" as const,page:0,x:60+i*250,y:60,width:150,height:24,required:true}]));
 e=await workflow.saveDraft(owner,e.id,{version:e.version,title:e.title,routing:mode,recipients:rs,fields,folder:"QA",tags:["Synthetic"]});
 return {e,rs,fields,owner};
}
async function sent(mode:"parallel"|"sequential",codes=false) {
 const f=await makeDraft(mode,codes);await workflow.sendEnvelope(f.owner,f.e.id,{version:f.e.version,confirmed:true,expiresInDays:7});
 const result=await workflow.verificationLinks(f.owner,f.e.id);
 const access=f.rs.map(r=>({token:result.links.find(l=>l.email===r.email)!.path.split("/").at(-1)!,code:r.accessCode,ua:"Synthetic signer"}));
 return {...f,access};
}
test("drafts cannot be archived and retain draft status",async()=>{
 const fixture=await makeDraft("parallel");
 await denied(f.lifecycle(fixture.owner,{envelopeId:fixture.e.id,action:"archive"}),"ACTIVE_ENVELOPE");
 assert.equal((await workflow.getEnvelope(fixture.owner,fixture.e.id)).state,"draft");
});
test("verification links never reopen terminal envelopes and persist newly expired state",async()=>{
 const expired=await makeDraft("parallel");
 await getPool().query("UPDATE envelopes SET state='sent',sent_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[expired.e.id]);
 await denied(workflow.verificationLinks(expired.owner,expired.e.id),"LINK_UNAVAILABLE");
 assert.equal((await getPool().query("SELECT state FROM envelopes WHERE id=$1",[expired.e.id])).rows[0].state,"expired");
 const voided=await sent("parallel");
 const current=await workflow.getEnvelope(voided.owner,voided.e.id);
 await workflow.voidEnvelope(voided.owner,voided.e.id,{version:current.version,reason:"Synthetic test"});
 await denied(workflow.verificationLinks(voided.owner,voided.e.id),"LINK_UNAVAILABLE");
 assert.equal((await workflow.getEnvelope(voided.owner,voided.e.id)).state,"voided");
 const completed=await sent("parallel");
 for(let index=0;index<completed.access.length;index++) {
  await workflow.consent(completed.access[index]);
  await workflow.submit(completed.access[index],payload(completed,completed.rs[index].id));
 }
 await denied(workflow.verificationLinks(completed.owner,completed.e.id),"LINK_UNAVAILABLE");
 assert.equal((await workflow.getEnvelope(completed.owner,completed.e.id)).state,"completed");
});
function payload(f:Awaited<ReturnType<typeof makeDraft>>,recipientId:string,key=randomUUID()){return {idempotencyKey:key,values:Object.fromEntries(f.fields.filter(v=>v.recipientId===recipientId).map(v=>[v.id,v.type==="date"?"2026-11-15":"Synthetic signature"]))};}
async function assertComplete(f:Awaited<ReturnType<typeof sent>>) {
 const e=await workflow.getEnvelope(f.owner,f.e.id);assert.equal(e.state,"completed");assert.equal(e.outputs.length,3);assert.equal(e.recipients.filter(r=>r.status==="signed").length,2);
 const originals=await getPool().query("SELECT original,signing,sha256 FROM documents WHERE envelope_id=$1 ORDER BY name",[e.id]);assert.equal(originals.rows.length,2);
 for(const d of originals.rows){assert.equal(hash(d.original),d.sha256);assert.deepEqual(d.original,d.signing);assert.ok([hash(portrait),hash(rotated)].includes(d.sha256));}
 const bytesByDocument=new Map<string,string>();let receipt:Record<string,any>|undefined;
 for(const o of e.outputs){const d=await workflow.senderDocument(f.owner,e.id,o.id,true);assert.equal(hash(d.bytes),o.sha256);assert.equal(d.bytes.length,o.size);
  if(o.kind==="receipt"){receipt=JSON.parse(d.bytes.toString());assert.equal(receipt!.recipients.length,2);assert.ok(receipt!.recipients.every((r:any)=>r.consent_at&&r.signed_at));assert.ok(receipt!.events.some((v:any)=>v.event==="completed"));}
  else {const pdf=await PDFDocument.load(d.bytes);assert.equal(pdf.getForm().getFields().length,0);assert.ok(!pdf.getPage(0).node.has(PDFName.of("Annots")));assert.notEqual(o.sha256,originals.rows[0].sha256);const row=(await getPool().query("SELECT document_id FROM outputs WHERE id=$1",[o.id])).rows[0];bytesByDocument.set(row.document_id,o.sha256);}
 }
 assert.ok(receipt);assert.equal(receipt.documents.length,2);for(const d of receipt.documents){assert.equal(d.completedSha256,bytesByDocument.get(d.documentId));const original=await workflow.senderDocument(f.owner,e.id,d.documentId);assert.equal(d.originalSha256,hash(original.bytes));}
 await assert.rejects(getPool().query("UPDATE outputs SET bytes=bytes WHERE envelope_id=$1",[e.id]));
 const counts=(await getPool().query("SELECT (SELECT count(*)::int FROM audit_events WHERE envelope_id=$1 AND event='completed') AS completed,(SELECT count(*)::int FROM outbox WHERE envelope_id=$1 AND kind='completion') AS completion_outbox",[e.id])).rows[0];assert.deepEqual(counts,{completed:1,completion_outbox:1});
 return e;
}

async function realDocx(text:string){
 const { zipSync, strToU8 }=await import("fflate");const escape=(v:string)=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
 const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p></w:body></w:document>`;
 const content=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
 return Buffer.from(zipSync({"[Content_Types].xml":strToU8(content),"word/document.xml":strToU8(document)},{level:0}));
}
test("real credential login, persisted cookie, tamper/CSRF/session-expiry denials through HTTP routes",async()=>{
 const a=getAuth();
 const sign=await a.handler(new Request(origin+"/api/auth/sign-in/email",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({email:sender().email,password,rememberMe:false})}));assert.equal(sign.status,200,await sign.clone().text());
 cookie=sign.headers.getSetCookie().map(v=>v.split(";")[0]).filter(v=>!v.endsWith("=")).join("; ");assert.ok(cookie.includes("session_token"));
 const anonymous=await workspaceRoute(new Request(origin+"/api/workspace"));assert.equal(anonymous.status,401);
 const response=await workspaceRoute(new Request(origin+"/api/workspace",{headers:{cookie}}));assert.equal(response.status,200);assert.equal((await response.json()).userId,sender().userId);
 assert.ok((await getPool().query("SELECT 1 FROM session WHERE user_id=$1",[sender().userId])).rowCount);
 const forgedCookie=cookie.replace(/session_token=(.)/,(_match,character)=>`session_token=${character==="X"?"Y":"X"}`);assert.notEqual(forgedCookie,cookie);
 const forged=await workspaceRoute(new Request(origin+"/api/workspace",{headers:{cookie:forgedCookie}}));assert.equal(forged.status,401);
 const csrf=await a.handler(new Request(origin+"/api/auth/sign-out",{method:"POST",headers:{cookie,origin:"https://attacker.invalid","content-type":"application/json"},body:"{}"}));assert.equal(csrf.status,403);
 await getPool().query("UPDATE session SET expires_at=now()-interval '1 day' WHERE user_id=$1",[sender().userId]);assert.equal((await workspaceRoute(new Request(origin+"/api/workspace",{headers:{cookie}}))).status,401);
});
test("two PDFs / two recipients: sequential turn, codes, explicit consent, required fields, immutable originals and real output hashes",async()=>{
 const f=await sent("sequential",true);
 await denied(workflow.signingView({...f.access[0],code:undefined}),"CODE_REQUIRED");await denied(workflow.signingView({...f.access[0],code:"wrong-code"}),"CODE_INVALID");
 const view=await workflow.signingView(f.access[0]);assert.equal(view.documents.length,2);assert.ok(view.fields.every(v=>v.recipientId===f.rs[0].id));
 await denied(workflow.signingView(f.access[1]),"WAITING_FOR_RECIPIENT");await denied(workflow.consent(f.access[1]),"WAITING_FOR_RECIPIENT");await denied(workflow.signingDocument(f.access[1],f.e.documents[0].id),"WAITING_FOR_RECIPIENT");
 await denied(workflow.submit(f.access[0],payload(f,f.rs[0].id)),"CONSENT_REQUIRED");
 const noConsent=await recipientAction(new Request(origin+`/api/sign/${f.access[0].token}/consent`,{method:"POST",headers:{origin,"content-type":"application/json","x-access-code":f.access[0].code!},body:'{"accepted":false}'}),{params:Promise.resolve({token:f.access[0].token,action:"consent"})});assert.equal(noConsent.status,400);
 await workflow.consent(f.access[0]);await workflow.consent(f.access[0]);
 await denied(workflow.submit(f.access[0],{idempotencyKey:randomUUID(),values:{}}),"FIELDS_REQUIRED");
 const foreign=payload(f,f.rs[0].id);foreign.values[f.fields.find(v=>v.recipientId===f.rs[1].id)!.id]="Foreign";await denied(workflow.submit(f.access[0],foreign),"FIELDS_REQUIRED");
 const first=payload(f,f.rs[0].id);assert.equal((await workflow.submit(f.access[0],first)).state,"part-signed");assert.equal((await workflow.submit(f.access[0],first)).idempotent,true);await denied(workflow.submit(f.access[0],payload(f,f.rs[0].id)),"SIGNING_CLOSED");
 await workflow.signingView(f.access[1]);await workflow.consent(f.access[1]);const last=payload(f,f.rs[1].id);assert.equal((await workflow.submit(f.access[1],last)).state,"completed");assert.equal((await workflow.submit(f.access[1],last)).idempotent,true);
 const e=await assertComplete(f);await denied(workflow.senderDocument(users["b:admin"],e.id,e.outputs[0].id,true),"NOT_FOUND");await denied(workflow.signingDocument(f.access[0],e.documents[0].id),"SIGNING_CLOSED");await denied(workflow.consent(f.access[1]),"SIGNING_CLOSED");await denied(workflow.decline(f.access[1],"Synthetic decline"),"SIGNING_CLOSED");
 const events=(await getPool().query("SELECT count(*)::int n FROM audit_events WHERE envelope_id=$1 AND event='consent'",[e.id])).rows[0];assert.equal(events.n,2);
 const links=await workflow.verificationLinks(f.owner,e.id,"complete"),token=links.links[0].path.split("/").at(-1)!;const completeAccess={token,ip:"127.0.0.1"};const result=await workflow.completionView(completeAccess) as {outputs:{id:string}[]};assert.equal(result.outputs.length,3);await denied(workflow.completionView(completeAccess,randomUUID()),"NOT_FOUND");await denied(workflow.signingView(completeAccess),"LINK_INVALID");const downloaded=await workflow.completionView(completeAccess,e.outputs[0].id) as {bytes:Buffer;sha256:string};assert.equal(hash(downloaded.bytes),downloaded.sha256);
 await getPool().query("UPDATE completion_links SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hash(token)]);await denied(workflow.completionView(completeAccess),"COMPLETION_LINK_INVALID");
});
test("parallel recipients and repeat/concurrent last submit create exactly one completion and one output per PDF",async()=>{
 const f=await sent("parallel");await Promise.all(f.access.map(a=>workflow.consent(a)));const p=f.rs.map(r=>payload(f,r.id));
 const results=await Promise.all([workflow.submit(f.access[0],p[0]),workflow.submit(f.access[1],p[1]),workflow.submit(f.access[1],p[1]),workflow.submit(f.access[0],p[0])]);assert.ok(results.some(r=>r.state==="completed"));assert.equal(results.filter(r=>r.idempotent).length,2);await assertComplete(f);
});
test("real role, owner/share, cross-company and removed-member denials cover records, private bytes, links, mutations and export scope",async()=>{
 const f=await makeDraft("parallel"),read=users["a:read-only"],other=users["a:other-sender"],cross=users["b:admin"];
 await denied(workflow.createEnvelope(read,"Denied draft"),"READ_ONLY");await denied(workflow.getEnvelope(read,f.e.id),"NOT_FOUND");await denied(workflow.getEnvelope(other,f.e.id),"NOT_FOUND");await denied(workflow.getEnvelope(cross,f.e.id),"NOT_FOUND");await denied(workflow.senderDocument(cross,f.e.id,f.e.documents[0].id),"NOT_FOUND");
 await workflow.shareEnvelope(f.owner,f.e.id,read.userId);assert.equal((await workflow.getEnvelope(read,f.e.id)).id,f.e.id);assert.equal(hash((await workflow.senderDocument(read,f.e.id,f.e.documents[0].id)).bytes),hash(portrait));
 await denied(workflow.sendEnvelope(read,f.e.id,{version:f.e.version,confirmed:true,expiresInDays:7}),"READ_ONLY");await denied(workflow.verificationLinks(read,f.e.id),"READ_ONLY");await denied(workflow.shareEnvelope(f.owner,f.e.id,cross.userId),"MEMBERSHIP_REQUIRED");await denied(workflow.team(f.owner),"ADMIN_REQUIRED");
 assert.ok(!(await workflow.workspace(cross)).envelopes.some(e=>e.id===f.e.id));assert.ok((await workflow.workspace(read)).envelopes.some(e=>e.id===f.e.id));assert.ok(!(await workflow.workspace(other)).envelopes.some(e=>e.id===f.e.id));
 const readerCookie=await signIn(read);
 assert.equal((await envelopeRoute(new Request(origin+`/api/envelopes/${f.e.id}`,{headers:{cookie:readerCookie}}),{params:Promise.resolve({id:f.e.id})})).status,200);
 const readerWrite=await saveRoute(new Request(origin+`/api/envelopes/${f.e.id}`,{method:"PATCH",headers:{origin,cookie:readerCookie,"content-type":"application/json"},body:JSON.stringify({version:f.e.version,title:f.e.title,routing:"parallel",recipients:f.rs,fields:f.fields})}),{params:Promise.resolve({id:f.e.id})});assert.equal(readerWrite.status,403);
 await workflow.changeMember(admin(),{memberId:read.memberId,active:false,role:"read-only"});
 assert.equal((await workspaceRoute(new Request(origin+"/api/workspace",{headers:{cookie:readerCookie}}))).status,403);await denied(workflow.getEnvelope(read,f.e.id),"MEMBERSHIP_REQUIRED");await denied(workflow.senderDocument(read,f.e.id,f.e.documents[0].id),"MEMBERSHIP_REQUIRED");await denied(workflow.workspace(read),"MEMBERSHIP_REQUIRED");
 const removed=users["a:removed"],owned=await makeDraft("parallel",false,removed);await workflow.changeMember(admin(),{memberId:removed.memberId,active:false,role:"sender",reassignTo:sender().userId});await denied(workflow.getEnvelope(removed,owned.e.id),"MEMBERSHIP_REQUIRED");assert.equal((await workflow.getEnvelope(sender(),owned.e.id)).owner_id,sender().userId);assert.ok((await workflow.getEnvelope(admin(),owned.e.id)).events.some(v=>v.event==="owner_reassigned"));
});
test("geometry / foreign PDF / field ownership / duplicate identifiers / version conflicts rejected before send",async()=>{
 const f=await makeDraft("sequential"),input={version:f.e.version,title:f.e.title,routing:"sequential",recipients:f.rs,fields:f.fields};
 await denied(workflow.saveDraft(f.owner,f.e.id,{...input,version:input.version-1}),"VERSION_CONFLICT");
 await denied(workflow.saveDraft(f.owner,f.e.id,{...input,fields:[{...f.fields[0],x:-100}]}),"FIELD_INVALID");await denied(workflow.saveDraft(f.owner,f.e.id,{...input,fields:[{...f.fields[0],page:1}]}),"FIELD_INVALID");await denied(workflow.saveDraft(f.owner,f.e.id,{...input,fields:[{...f.fields[0],documentId:randomUUID()}]}),"FIELD_INVALID");await denied(workflow.saveDraft(f.owner,f.e.id,{...input,fields:[{...f.fields[0],recipientId:randomUUID()}]}),"FIELD_INVALID");
 await denied(workflow.saveDraft(f.owner,f.e.id,{...input,fields:[f.fields[0],f.fields[0]]}),"DUPLICATE_ID");await denied(workflow.saveDraft(f.owner,f.e.id,{...input,recipients:[f.rs[0],f.rs[0]]}),"DUPLICATE_ID");await denied(workflow.saveDraft(f.owner,f.e.id,{...input,recipients:f.rs.map(r=>({...r,order:1}))}),"ROUTING_INVALID");
 const noFields=await workflow.saveDraft(f.owner,f.e.id,{...input,fields:[]});await denied(workflow.sendEnvelope(f.owner,f.e.id,{version:noFields.version,confirmed:true,expiresInDays:7}),"FIELDS_REQUIRED");
});
test("code failures are durable, fifth attempt locks; link rotation revokes old tokens and only hashes persist",async()=>{
 const f=await sent("parallel",true);for(let i=0;i<5;i++)await denied(workflow.signingView({...f.access[0],code:"wrong-code"}),i===4?"CODE_LOCKED":"CODE_INVALID");await denied(workflow.signingView(f.access[0]),"CODE_LOCKED");
 const r=(await getPool().query("SELECT token_hash,access_verifier,attempts FROM recipients WHERE id=$1",[f.rs[0].id])).rows[0];assert.equal(r.attempts,5);assert.equal(r.token_hash,hash(f.access[0].token));assert.ok(!r.access_verifier.includes(f.access[0].code!));
 const original=f.access[1],links=await workflow.verificationLinks(f.owner,f.e.id),next={...original,token:links.links.find(l=>l.email===f.rs[1].email)!.path.split("/").at(-1)!};await denied(workflow.signingView(original),"LINK_INVALID");assert.equal((await workflow.signingView(next)).recipient.id,f.rs[1].id);
});
test("decline and void revoke document/consent/submit; expiry persists with UTC event and blocks all actions",async()=>{
 for(const kind of ["declined","voided","expired"]){const f=await sent("parallel");
  if(kind==="declined")await workflow.decline(f.access[0],"Synthetic decline reason");
  if(kind==="voided"){const e=await workflow.getEnvelope(f.owner,f.e.id);await workflow.voidEnvelope(f.owner,e.id,{version:e.version,reason:"Synthetic void reason"});}
  if(kind==="expired"){
   const d=await makeDraft("parallel");await getPool().query("UPDATE envelopes SET state='sent',sent_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[d.e.id]);
   const token=newToken();await getPool().query("UPDATE recipients SET token_hash=$2 WHERE id=$1",[d.rs[0].id,hash(token)]);
   f.e=d.e;f.rs=d.rs;f.fields=d.fields;f.access[0]={token,code:undefined,ua:"Synthetic expiry"};
  }
  const closedCode=kind==="voided"?"LINK_INVALID":"SIGNING_CLOSED";
  await denied(workflow.signingView(f.access[0]),closedCode);await denied(workflow.signingDocument(f.access[0],f.e.documents[0].id),closedCode);await denied(workflow.consent(f.access[0]),closedCode);await denied(workflow.submit(f.access[0],payload(f,f.rs[0].id)),closedCode);
  const e=await workflow.getEnvelope(f.owner,f.e.id);assert.equal(e.state,kind);assert.ok(e.events.some(v=>v.event===kind));if(kind!=="expired")assert.ok(e.reason);
 }
});
test("sent assignments and byte/audit evidence cannot be rewritten; incomplete completion rolls back",async()=>{
 const f=await sent("parallel");await denied(workflow.saveDraft(f.owner,f.e.id,{version:f.e.version,title:f.e.title,routing:"parallel",fields:f.fields,recipients:f.rs}),"FROZEN");
 for(const sql of ["UPDATE documents SET original='corrupt' WHERE envelope_id=$1","DELETE FROM documents WHERE envelope_id=$1","DELETE FROM audit_events WHERE envelope_id=$1","UPDATE recipients SET email='other@qa.test' WHERE envelope_id=$1","UPDATE envelopes SET fields='[]' WHERE id=$1"]){await assert.rejects(getPool().query(sql,[f.e.id]));}
 await assert.rejects(getPool().query("UPDATE envelopes SET state='completed' WHERE id=$1",[f.e.id]));assert.notEqual((await workflow.getEnvelope(f.owner,f.e.id)).state,"completed");
 await workflow.consent(f.access[0]);await workflow.submit(f.access[0],payload(f,f.rs[0].id));await assert.rejects(getPool().query("UPDATE recipients SET values='{}' WHERE id=$1",[f.rs[0].id]));
});
test("webhook receiver accepts signed events, rejects tampering, and deduplicates by event id",async()=>{
 const secret="synthetic-webhook-secret";
 const id=randomUUID(),envelopeId=randomUUID(),now=Date.now(),timestamp=String(Math.floor(now/1000));
 const body=JSON.stringify({id,type:"completed",envelopeId});
 const headers=(payload:string,at=timestamp)=>({"x-esign-id":id,"x-esign-timestamp":at,"x-esign-signature":automation.signature(secret,at,payload)});
 assert.deepEqual(await receiveWebhook(secret,headers(body),body,now),{accepted:true,duplicate:false});
 assert.deepEqual(await receiveWebhook(secret,headers(body),body,now),{accepted:true,duplicate:true});
 const changed=JSON.stringify({id,type:"completed",envelopeId:randomUUID()});
 const altered=JSON.stringify({...JSON.parse(body),type:"declined"});
 await denied(receiveWebhook(secret,headers(changed),altered,now),"WEBHOOK_SIGNATURE");
 const stale=String(Math.floor(now/1000)-301);
 await denied(receiveWebhook(secret,headers(body,stale),body,now),"WEBHOOK_SIGNATURE");
 const large="x".repeat(65537);
 await denied(receiveWebhook(secret,headers(large),large,now),"WEBHOOK_SIZE");
 await denied(receiveWebhook(secret,headers(changed),changed,now),"EVENT_CONFLICT");
});
test("durable scheduler expires envelopes and queues honest reminder mail",async()=>{
 const seed=await makeDraft("parallel");
 await transaction(async c=>{
  await c.query("UPDATE envelopes SET state='sent',sent_at=now()-interval '4 days',expires_at=now()-interval '1 day' WHERE id=$1",[seed.e.id]);
  for(const r of seed.rs)await automation.queueSigning(c,{...seed.e,state:"sent"},r);
 });
 const reminderSeed=await makeDraft("parallel");
 await transaction(async c=>{
  await c.query("UPDATE envelopes SET state='sent',sent_at=now()-interval '4 days',expires_at=now()+interval '7 days' WHERE id=$1",[reminderSeed.e.id]);
  for(const r of reminderSeed.rs)await automation.queueSigning(c,{...reminderSeed.e,state:"sent"},r);
  await c.query("UPDATE delivery_jobs SET created_at=now()-interval '4 days' WHERE envelope_id=$1 AND kind IN ('signing_request','link_reissue')",[reminderSeed.e.id]);
 });
 await automation.runJobs();
 const reminder=(await getPool().query("SELECT * FROM delivery_jobs WHERE envelope_id=$1 AND recipient_id=$2 AND kind='reminder'",[reminderSeed.e.id,reminderSeed.rs[0].id])).rows[0];
 assert.ok(reminder);
 await getPool().query("UPDATE delivery_jobs SET created_at='1900-01-01' WHERE id=$1",[reminder.id]);
 await automation.runJobs();
 const envelope=await workflow.getEnvelope(seed.owner,seed.e.id);
 assert.equal(envelope.state,"expired");
 assert.ok(envelope.events.some(v=>v.event==="expired"&&v.actor==="scheduler"));
 assert.equal((await getPool().query("SELECT status,last_error FROM delivery_jobs WHERE id=$1",[reminder.id])).rows[0].status,"not_configured");
 assert.equal((await getPool().query("SELECT last_error FROM delivery_jobs WHERE id=$1",[reminder.id])).rows[0].last_error,"not delivered / provider not configured");
});
test("recipient document IDs and completion output IDs cannot cross envelopes; request limits enforced durably",async()=>{
 const f=await sent("parallel"),other=await sent("parallel");await denied(workflow.signingDocument(f.access[0],other.e.documents[0].id),"NOT_FOUND");
 const a:Access={...f.access[0],ip:"synthetic-rate-limit"},key="token:"+hash(a.token);await getPool().query("INSERT INTO request_limits(key,count) VALUES($1,120) ON CONFLICT(key) DO UPDATE SET count=120,window_start=now()",[key]);await denied(workflow.signingView(a),"RATE_LIMIT");assert.ok((await getPool().query("SELECT count FROM request_limits WHERE key=$1",[key])).rows[0].count>120);
});
test("STEP 2 features: contact import, reusable template, real DOCX conversion, drawing and all six field types",async()=>{
 const contactSuffix=randomUUID().slice(0,8),csvText=`name,email\r\nAvery Morgan,avery${contactSuffix}@contact.test\r\nAvery Morgan,avery${contactSuffix}@contact.test\r\nBad Name,bad-email\r\nJordan Lee,jordan${contactSuffix}@contact.test`;
 const imported=await f.importContacts(sender(),csvText);assert.equal(imported.imported,2);assert.deepEqual(imported.errors,[{row:3,error:"Duplicate in CSV"},{row:4,error:"Invalid name/email or column count"}]);
 const docx=await realDocx("SYNTHETIC DOCX integration text");
 const base=await workflow.createEnvelope(sender(),"Synthetic STEP 2 PDF plus DOCX");
 let e=await workflow.uploadDocument(sender(),base.id,base.version,"Step2.pdf",portrait);
 e=await workflow.uploadDocument(sender(),e.id,e.version,"Step2.docx",docx);
 const rs=[{id:randomUUID(),name:"Avery Morgan",email:`avery${contactSuffix}@contact.test`,order:1,accessCode:"Avery-code-123"},{id:randomUUID(),name:"Jordan Lee",email:`jordan${contactSuffix}@contact.test`,order:2}];
 const fields:Field[]=e.documents.flatMap(d=>[{id:randomUUID(),documentId:d.id,recipientId:rs[0].id,type:"signature" as const,page:0,x:60,y:220,width:160,height:40,required:true},{id:randomUUID(),documentId:d.id,recipientId:rs[0].id,type:"initials" as const,page:0,x:60,y:170,width:80,height:28,required:true},{id:randomUUID(),documentId:d.id,recipientId:rs[0].id,type:"name" as const,page:0,x:60,y:130,width:180,height:24,required:true},{id:randomUUID(),documentId:d.id,recipientId:rs[0].id,type:"text" as const,page:0,x:60,y:95,width:240,height:24,required:true},{id:randomUUID(),documentId:d.id,recipientId:rs[0].id,type:"checkbox" as const,page:0,x:60,y:60,width:20,height:20,required:true},{id:randomUUID(),documentId:d.id,recipientId:rs[0].id,type:"date" as const,page:0,x:90,y:60,width:130,height:24,required:true},{id:randomUUID(),documentId:d.id,recipientId:rs[1].id,type:"signature" as const,page:0,x:330,y:220,width:160,height:40,required:true}]);
 e=await workflow.saveDraft(sender(),e.id,{version:e.version,title:e.title,routing:"parallel",recipients:rs,fields});
 assert.equal(e.documents.length,2);assert.ok(e.documents.some(d=>d.converted));assert.equal((await getPool().query("SELECT converter FROM source_files WHERE document_id=$1",[e.documents[1].id])).rows[0].converter,"bounded-docx-layout-v3");
 const template=await f.saveTemplate(sender(),{envelopeId:e.id,name:`Synthetic template ${randomUUID()}`,roles:[{recipientId:rs[0].id,name:"Client"},{recipientId:rs[1].id,name:"Supplier"}]});
 const used=await f.useTemplate(sender(),{templateId:template.id,title:`Synthetic template use 1 ${randomUUID()}`,assignments:[{roleId:rs[0].id,name:"New Client",email:"new.client@client.test"},{roleId:rs[1].id,name:"New Supplier",email:"new.supplier@client.test"}]});
 const reused=await f.useTemplate(sender(),{templateId:template.id,title:`Synthetic template use 2 ${randomUUID()}`,assignments:[{roleId:rs[0].id,name:"Second Client",email:"second.client@client.test"},{roleId:rs[1].id,name:"Second Supplier",email:"second.supplier@client.test"}]});
 assert.notEqual(used.id,reused.id);assert.equal(used.documents.length,2);assert.equal(reused.fields.length,fields.length);
 await workflow.sendEnvelope(sender(),e.id,{version:e.version,confirmed:true,expiresInDays:7});
 const links=await workflow.verificationLinks(sender(),e.id),a={token:links.links.find(l=>l.email===rs[0].email)!.path.split("/").at(-1)!,code:"Avery-code-123",ua:"Synthetic signer"},b={token:links.links.find(l=>l.email===rs[1].email)!.path.split("/").at(-1)!,ua:"Synthetic signer"};
 const assigned=fields.filter(v=>v.recipientId===rs[0].id);
 const view=await workflow.signingView(a);assert.equal(view.branding.name,"Synthetic integration a "+suffix);await workflow.consent(a);await workflow.submit(a,{idempotencyKey:randomUUID(),values:Object.fromEntries(assigned.map(v=>[v.id,v.type==="signature"?"drawn:v1:"+JSON.stringify([[[0.1,0.5],[0.3,0.4],[0.5,0.6]]]):v.type==="initials"?"AM":v.type==="name"?"Avery Morgan":v.type==="text"?"Synthetic typed text":v.type==="checkbox"?true:"2026-11-16"] as [string,string|boolean]))});
 const bFields=fields.filter(v=>v.recipientId===rs[1].id);await workflow.consent(b);const result=await workflow.submit(b,{idempotencyKey:randomUUID(),values:Object.fromEntries(bFields.map(v=>[v.id,"Jordan Lee"] as [string,string]))});assert.equal(result.state,"completed");
 const completed=await workflow.getEnvelope(sender(),e.id);assert.equal(completed.outputs.length,3);
 const log=await f.deliveryLog(admin());const mailJob=log.mail.find(v=>v.envelope_id===e.id);assert.ok(mailJob);
 assert.equal(mailJob.status,"not_configured");assert.equal(mailJob.last_error,"not delivered / provider not configured");
 await denied(f.retryDelivery(admin(),{id:mailJob.id,kind:"mail"}),"RETRY_UNSAFE");
});

async function oneSignerTemplate(owner=sender()) {
  const fixture=await makeDraft("parallel",false,owner);
  const signer=fixture.rs[0];
  const fields=fixture.fields.filter(field=>field.recipientId===signer.id);
  const envelope=await workflow.saveDraft(owner,fixture.e.id,{
    version:fixture.e.version,title:fixture.e.title,routing:"parallel",fields,recipients:[signer],
  });
  const template=await f.saveTemplate(owner,{
    envelopeId:envelope.id,name:"Synthetic roster agreement",roles:[{recipientId:signer.id,name:"Signer"}],
  });
  return {template,envelope,signer,fields,owner};
}

test("bulk preflight is bounded and stale-safe, and a confirmed roster is atomic and private on replay",async()=>{
  const source=await oneSignerTemplate();
  const templateId=source.template.id;
  const csv="name,email\nAvery Morgan,avery-batch@client.test\nJordan Lee,jordan-batch@client.test";
  const bad=await bulkPreview(sender(),{templateId,csv:csv+"\nDuplicate,AVERY-BATCH@CLIENT.TEST\nInvalid,wrong"});
  assert.equal(bad.fingerprint,null);
  assert.deepEqual(bad.rows.filter(row=>"error" in row).map(row=>row.row),[4,5]);
  await denied(bulkPreview(sender(),{templateId,csv:"name,email\n"+Array(26).fill("A,a@client.test").join("\n")}),"CSV_ROWS");
  await denied(bulkPreview(users["b:read-only"],{templateId,csv}),"READ_ONLY");
  await denied(bulkPreview(users["b:admin"],{templateId,csv}),"NOT_FOUND");

  const prior=await bulkPreview(sender(),{templateId,csv});
  await workflow.saveDraft(source.owner,source.envelope.id,{
    version:source.envelope.version,title:"Updated synthetic source",routing:"parallel",fields:source.fields,recipients:[source.signer],
  });
  const requestKey=randomUUID();
  await denied(bulkConfirm(sender(),{templateId,csv,fingerprint:prior.fingerprint,requestKey}),"BATCH_REVIEW_REQUIRED");
  assert.deepEqual(await bulkHistory(sender()),[]);
  const preview=await bulkPreview(sender(),{templateId,csv});
  const request={templateId,csv,fingerprint:preview.fingerprint,requestKey};
  const [batch,replay]=await Promise.all([bulkConfirm(sender(),request),bulkConfirm(sender(),request)]);
  assert.equal(batch.id,replay.id);
  assert.equal(batch.entries.length,2);
  assert.notEqual(batch.entries[0].envelope_id,batch.entries[1].envelope_id);
  assert.ok(batch.entries.every(row=>row.state==="sent"&&row.delivery==="not_configured"));
  await denied(bulkConfirm(sender(),{...request,csv:csv.replace("Jordan Lee","Taylor Hart")}),"BATCH_CONFLICT");
  assert.deepEqual(await bulkHistory(users["a:other-sender"]),[]);
  assert.deepEqual(await bulkHistory(users["b:admin"]),[]);
  await denied(bulkHistory(users["b:read-only"]),"READ_ONLY");
  assert.equal((await bulkHistory(admin()))[0].id,batch.id);

  const ids=batch.entries.map(e=>e.envelope_id);
  const jobs=await getPool().query("SELECT payload FROM delivery_jobs WHERE kind='signing_request' AND envelope_id=ANY($1::uuid[])",[ids]);
  assert.equal(jobs.rowCount,2);
  const payloads=jobs.rows.map(r=>automation.unseal<{text:string}>(r.payload));
  const token=payloads[0].text.split("/sign/")[1];
  const view=await workflow.signingView({token}) as {documents:{id:string}[]};
  const otherId=(await getPool().query("SELECT id FROM documents WHERE envelope_id=ANY($1::uuid[]) AND id<>ALL($2::uuid[]) LIMIT 1",[ids,view.documents.map(d=>d.id)])).rows[0].id;
  await denied(workflow.signingDocument({token},otherId),"NOT_FOUND");
});

test("one PDF-only completion copy is issued, checked, revoked and renewed without signing authority",async()=>{
  const fixture=await makeDraft("sequential");
  const {e,owner,rs}=fixture;
  const configured=await changeCompletionCopy(owner,e.id,{action:"save",email:"Archive@client.test",version:e.version});
  assert.equal(configured.copy?.email,"archive@client.test");
  assert.equal((await getCompletionCopy(admin(),e.id)).copy?.state,"awaiting_completion");
  await denied(getCompletionCopy(users["b:sender"],e.id),"NOT_FOUND");
  await denied(getCompletionCopy(users["a:other-sender"],e.id),"NOT_FOUND");
  await denied(changeCompletionCopy(users["b:read-only"],e.id,{action:"revoke"}),"READ_ONLY");
  await assert.rejects(changeCompletionCopy(owner,e.id,{action:"save",email:"bad address",version:configured.version}));
  await denied(changeCompletionCopy(owner,e.id,{action:"save",email:null,version:e.version}),"VERSION_CONFLICT");
  const getJobs=async()=>(await getPool().query("SELECT * FROM delivery_jobs WHERE envelope_id=$1 AND kind='external_completion_copy' ORDER BY created_at",[e.id])).rows;
  assert.equal((await getJobs()).length,0);
  await workflow.sendEnvelope(owner,e.id,{version:configured.version,confirmed:true,expiresInDays:7});
  await denied(changeCompletionCopy(owner,e.id,{action:"save",email:null,version:configured.version}),"FROZEN");
  const links=await workflow.verificationLinks(owner,e.id);
  for(const [i,r] of rs.entries()){
    const access={token:links.links[i].path.split("/").at(-1)!};
    await workflow.consent(access);
    await workflow.submit(access,payload(fixture,r.id));
    assert.equal((await getJobs()).length,i);
  }
  const [job]=await getJobs();
  const token=automation.unseal(job.payload).text.match(/\/complete\/([\w-]+)/)?.[1];
  assert.ok(token);
  const view=await workflow.completionView({token});
  assert.equal(view.pdfsOnly,true);
  assert.equal(view.outputs.length,2);
  for(const output of view.outputs){
    const d=await workflow.completionView({token},output.id);
    assert.equal(d.kind,"signed_pdf");
    assert.equal(hash(d.bytes),output.sha256);
  }
  const complete=await workflow.getEnvelope(owner,e.id);
  await denied(workflow.completionView({token},complete.outputs.find((entry:any)=>entry.kind==="receipt")!.id),"NOT_FOUND");
  await denied(workflow.completionView({token},complete.documents[0].id),"NOT_FOUND");
  await denied(workflow.signingView({token}),"LINK_INVALID");
  await denied(changeCompletionCopy(admin(),e.id,{action:"renew"}),"COPY_STILL_ACTIVE");
  await getPool().query("UPDATE completion_copies SET expires_at=clock_timestamp()-interval '1 second' WHERE envelope_id=$1",[e.id]);
  assert.equal((await getCompletionCopy(admin(),e.id)).copy?.state,"expired");
  await denied(workflow.completionView({token}),"COMPLETION_LINK_INVALID");
  await changeCompletionCopy(admin(),e.id,{action:"renew"});
  const jobs=await getJobs();
  assert.equal(jobs.length,2);
  const renewed=automation.unseal(jobs[1].payload).text.match(/\/complete\/([\w-]+)/)?.[1];
  assert.ok(renewed&&renewed!==token);
  assert.equal((await workflow.completionView({token:renewed})).outputs.length,2);
  await changeCompletionCopy(owner,e.id,{action:"revoke"});
  await denied(workflow.completionView({token:renewed}),"COMPLETION_LINK_INVALID");
  assert.equal((await workflow.getEnvelope(owner,e.id)).state,"completed");
});

async function claimToken(receipt:string|undefined) {
  assert.ok(receipt);
  const job=(await getPool().query("SELECT * FROM delivery_jobs WHERE event_key=$1",[`signing-start:${receipt}`])).rows[0];
  const token=automation.unseal(job.payload).text.match(/\/start\/verify\/([\w-]+)/)?.[1];
  assert.ok(token);
  return {token,job};
}

test("public start verifies one private envelope per mailbox proof and respects expiry, publisher and publication state",async()=>{
  const source=await oneSignerTemplate();
  const publication={action:"publish",templateId:source.template.id,title:"Synthetic onboarding packet"};
  await denied(managePublication(sender(),publication),"ADMIN_REQUIRED");
  await denied(managePublication(users["b:admin"],publication),"NOT_FOUND");
  const [link]=await managePublication(admin(),publication);
  assert.equal((await listPublications(admin()))[0].id,link.id);
  await denied(managePublication(users["b:admin"],{action:"disable",linkId:link.id}),"NOT_FOUND");
  assert.deepEqual(await publicSigningPage(link.id,{}),{title:publication.title});
  const first={name:"Intake Avery",email:"first@client.test"};
  const queued=await requestSigningVerification(link.id,first,{});
  assert.equal(queued.status,"verification_only");
  assert.deepEqual(await requestSigningVerification(link.id,first,{}),{status:"verification_only"});
  assert.deepEqual(await requestSigningVerification(link.id,first,{}),{status:"verification_only"});
  await denied(requestSigningVerification(link.id,first,{}),"RATE_LIMIT");
  const initial=await claimToken(queued.receipt);
  assert.equal(await transaction(c=>automation.deliveryEligibility(c,initial.job,automation.unseal(initial.job.payload))),"eligible");
  assert.equal((await getPool().query("SELECT envelope_id FROM signing_link_claims WHERE id=$1",[queued.receipt])).rows[0].envelope_id,null);
  const results=await Promise.allSettled([redeemSigningVerification(initial.token,{}),redeemSigningVerification(initial.token,{})]);
  const success=results.find(result=>result.status==="fulfilled");
  const rejection=results.find(result=>result.status==="rejected");
  assert.equal(rejection?.reason.code,"VERIFICATION_INVALID");
  assert.ok(success);
  const access={token:success.value.path.split("/").at(-1)!};
  assert.notEqual(access.token,initial.token);
  await denied(workflow.signingView({token:initial.token}),"LINK_INVALID");
  const view=await workflow.signingView(access);
  assert.equal(view.recipient.email,first.email);
  assert.equal(view.documents.length,2);
  await denied(workflow.getEnvelope(sender(),view.id),"NOT_FOUND");
  await denied(workflow.getEnvelope(users["b:admin"],view.id),"NOT_FOUND");
  assert.equal((await workflow.getEnvelope(admin(),view.id)).owner_id,admin().userId);
  assert.equal((await getPool().query("SELECT count(*)::int AS n FROM delivery_jobs WHERE envelope_id=$1 AND kind='signing_request'",[view.id])).rows[0].n,0);

  const expired=await requestSigningVerification(link.id,{name:"Expired Lee",email:"expired@client.test"},{});
  const expiredToken=await claimToken(expired.receipt);
  await getPool().query("UPDATE signing_link_claims SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.receipt]);
  await denied(redeemSigningVerification(expiredToken.token,{}),"VERIFICATION_INVALID");
  const pending=await requestSigningVerification(link.id,{name:"Disabled Lee",email:"disabled@client.test"},{});
  const pendingToken=await claimToken(pending.receipt);
  await managePublication(admin(),{action:"disable",linkId:link.id});
  await denied(publicSigningPage(link.id,{}),"SIGNING_LINK_CLOSED");
  await denied(redeemSigningVerification(pendingToken.token,{}),"SIGNING_LINK_CLOSED");
  assert.equal(await transaction(c=>automation.deliveryEligibility(c,pendingToken.job,automation.unseal(pendingToken.job.payload))),"cancelled");
  await workflow.consent(access);
  await workflow.submit(access,{idempotencyKey:randomUUID(),values:Object.fromEntries(view.fields.map((field:Field)=>[field.id,field.type==="date"?"2026-11-25":"Intake Avery"]))});
  assert.equal((await workflow.getEnvelope(admin(),view.id)).state,"completed");

  const [republished]=await managePublication(admin(),publication);
  assert.equal(republished.id,link.id);
  await denied(redeemSigningVerification(pendingToken.token,{}),"VERIFICATION_INVALID");
  const suspended=await requestSigningVerification(link.id,{name:"Suspended Lee",email:"suspended@client.test"},{});
  const suspendedToken=await claimToken(suspended.receipt);
  const colleague=users["a:other-sender"];
  await workflow.changeMember(admin(),{memberId:colleague.memberId,role:"admin",active:true});
  await workflow.changeMember(colleague,{memberId:admin().memberId,role:"admin",active:false});
  try {
    await denied(publicSigningPage(link.id,{}),"SIGNING_LINK_CLOSED");
    await denied(redeemSigningVerification(suspendedToken.token,{}),"SIGNING_LINK_CLOSED");
    assert.equal(await transaction(c=>automation.deliveryEligibility(c,suspendedToken.job,automation.unseal(suspendedToken.job.payload))),"cancelled");
  } finally {
    await workflow.changeMember(colleague,{memberId:admin().memberId,role:"admin",active:true});
    await workflow.changeMember(admin(),{memberId:colleague.memberId,role:"sender",active:true});
  }
  await denied(publicSigningPage(link.id,{}),"SIGNING_LINK_CLOSED");
  await managePublication(admin(),publication);
  await denied(redeemSigningVerification(suspendedToken.token,{}),"VERIFICATION_INVALID");
  await workflow.saveDraft(source.owner,source.envelope.id,{
    version:source.envelope.version,title:"New revision",routing:"parallel",fields:source.fields,recipients:[source.signer],
  });
  await denied(publicSigningPage(link.id,{}),"SIGNING_LINK_CLOSED");
  await denied(redeemSigningVerification(suspendedToken.token,{}),"SIGNING_LINK_CLOSED");
  const a=await backupExport(admin()),b=await backupExport(users["b:admin"]);
  assert.ok(a.tables.signing_link_claims.some(row=>row.id===queued.receipt));
  assert.ok(a.tables.bulk_send_entries.length&&a.tables.completion_copies.length);
  assert.equal(b.tables.signing_link_claims.length,0);
  assert.equal(b.tables.bulk_send_entries.length,0);
  assert.equal(b.tables.completion_copies.length,0);
});

test("configured delivery attempts record acceptance, definite failure, and retry for the three milestone jobs",async()=>{
  const source=await oneSignerTemplate();
  const [link]=await managePublication(admin(),{action:"publish",templateId:source.template.id,title:"Synthetic provider check"});
  const fixture=await makeDraft("parallel");
  const settings=["NODE_ENV","EMAIL_DISPATCH_ENABLED","RESEND_API_KEY","EMAIL_FROM","BETTER_AUTH_URL","WEBHOOK_DISPATCH_ENABLED"];
  const saved=Object.fromEntries(settings.map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,{NODE_ENV:"production",EMAIL_DISPATCH_ENABLED:"0",BETTER_AUTH_URL:"https://accord.example.test",WEBHOOK_DISPATCH_ENABLED:"0"});
    await denied(requestSigningVerification(link.id,{name:"Fictional",email:"fictional@example.com"},{}),"VERIFICATION_DELIVERY_UNAVAILABLE");
    Object.assign(process.env,{EMAIL_DISPATCH_ENABLED:"1",RESEND_API_KEY:"controlled-provider-fixture",EMAIL_FROM:"signed@example.com"});
    const request=await requestSigningVerification(link.id,{name:"Fictional",email:"fictional@example.com"},{});
    const queued=await claimToken(request.receipt);
    assert.equal((await signingVerificationStatus(request.receipt!,{})).status,"pending");
    const {e,owner,rs}=fixture;
    const copy=await changeCompletionCopy(owner,e.id,{action:"save",email:"copy@example.com",version:e.version});
    await workflow.sendEnvelope(owner,e.id,{version:copy.version,confirmed:true,expiresInDays:7});
    const signJobs=(await getPool().query("SELECT payload FROM delivery_jobs WHERE envelope_id=$1 AND kind='signing_request' ORDER BY created_at",[e.id])).rows;
    for(const r of rs){
      const data=signJobs.map(row=>automation.unseal(row.payload)).find(data=>data.email===r.email);
      const token=data.text.match(/\/sign\/([\w-]+)/)?.[1];assert.ok(token);
      await workflow.consent({token});
      await workflow.submit({token},payload(fixture,r.id));
    }
    const csv="name,email\nRejected,reject@example.com";
    const templateId=source.template.id;
    const preview=await bulkPreview(sender(),{templateId,csv});
    const batch=await bulkConfirm(sender(),{templateId,csv,fingerprint:preview.fingerprint,requestKey:randomUUID()});
    const selected=(await getPool().query("SELECT id,event_key FROM delivery_jobs WHERE id=$1 OR (envelope_id=$2 AND kind='external_completion_copy') OR (envelope_id=$3 AND kind='signing_request')",[queued.job.id,e.id,batch.entries[0].envelope_id])).rows;
    assert.equal(selected.length,3);
    const responseByAddress:Record<string,number>={"fictional@example.com":422,"copy@example.com":200,"reject@example.com":429};
    const seen=new Set<string>();
    const transport:typeof fetch=async(url,init)=>{
      assert.equal(url,"https://api.resend.com/emails");
      const [address]=JSON.parse(String(init?.body)).to;
      assert.ok(address in responseByAddress);
      assert.match(new Headers(init?.headers).get("idempotency-key")??"",/^[a-f0-9]{64}$/);
      seen.add(address);
      return Response.json({id:"controlled-message"},{status:responseByAddress[address]});
    };
    // Pick the three new jobs ahead of legacy fixture mail in the isolated integration database.
    await getPool().query("UPDATE delivery_jobs SET created_at='2000-01-01',next_at=now() WHERE id=ANY($1::uuid[])",[selected.map(row=>row.id)]);
    await automation.runJobs(transport);
    assert.equal(seen.size,3);
    assert.equal((await signingVerificationStatus(request.receipt!,{})).status,"failed");
    assert.equal((await getCompletionCopy(admin(),e.id)).copy?.delivery,"provider_accepted");
    assert.equal((await bulkHistory(sender())).find(row=>row.id===batch.id)?.entries[0].delivery,"retry");
    const retried=await requestSigningVerification(link.id,{name:"Fictional",email:"fictional@example.com",retryReceipt:request.receipt},{});
    assert.ok(retried.receipt&&retried.receipt!==request.receipt);
    await denied(redeemSigningVerification(queued.token,{}),"VERIFICATION_INVALID");
    assert.equal((await workflow.getEnvelope(owner,e.id)).state,"completed");
  } finally {
    for(const key of settings){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  }
});
