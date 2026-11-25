import type { PoolClient } from "pg";
import { z } from "zod";
import { mailConfigured, publicOrigin, queueMail } from "./automation";
import { hash, newToken } from "./crypto";
import { transaction } from "./db";
import { AppError, fail } from "./errors";
import { consumeLimit, copyDraft } from "./features";
import { deliveryStatus, externalRecipient, singleSignerTemplate } from "./template-send";
import { audit, freezeDraft, member, type Principal } from "./workflow";

type Publication = {
  id:string; company_id:string; owner_id:string; template_id:string;
  template_fingerprint:string; title:string; active:boolean;
};
type Visitor = Pick<Principal,"ip"|"ua">;
const idInput=z.uuid();
const tokenInput=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const publishInput=z.discriminatedUnion("action",[
  z.object({action:z.literal("publish"),templateId:idInput,title:z.string().trim().min(1).max(120)}),
  z.object({action:z.literal("disable"),linkId:idInput}),
]);

async function requireAdmin(c:PoolClient,p:Principal) {
  if((await member(c,p)).role!=="admin")fail(403,"ADMIN_REQUIRED","Only administrators can manage signing links.");
}
async function list(c:PoolClient,companyId:string) {
  return (await c.query(
    `SELECT l.id,l.template_id,l.title,l.active,t.name AS template_name,
      coalesce(m.active AND m.role='admin',false) AS publisher_active
      FROM published_signing_links l JOIN templates t ON t.id=l.template_id
      LEFT JOIN memberships m ON m.company_id=l.company_id AND m.user_id=l.owner_id
      WHERE l.company_id=$1 ORDER BY l.created_at DESC,l.id`,[companyId],
  )).rows;
}
export async function listPublications(p:Principal) {
  return transaction(async c=>{await requireAdmin(c,p);return list(c,p.companyId);});
}
async function cancelPending(c:PoolClient,linkId:string) {
  await c.query("UPDATE signing_link_claims SET cancelled_at=clock_timestamp() WHERE link_id=$1 AND used_at IS NULL AND cancelled_at IS NULL",[linkId]);
}
export async function managePublication(p:Principal,input:unknown) {
  const v=publishInput.parse(input);
  return transaction(async c=>{
    // Match team administration's company-first order when changing publisher authority.
    await c.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE",[p.companyId]);
    await requireAdmin(c,p);
    if(v.action==="disable"){
      const changed=(await c.query("UPDATE published_signing_links SET active=false WHERE id=$1 AND company_id=$2 RETURNING id",[v.linkId,p.companyId])).rows[0];
      if(!changed)fail(404,"NOT_FOUND","Signing link not found.");
      await cancelPending(c,changed.id);
      await audit(c,{company_id:p.companyId},p,"signing_link_disabled",{linkId:changed.id});
    }else{
      // A link may not exist yet. Serialize publishes before taking the link and template locks.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`publish-signing:${p.companyId}:${v.templateId}`]);
      const existing=(await c.query<Publication>("SELECT * FROM published_signing_links WHERE company_id=$1 AND template_id=$2 FOR UPDATE",[p.companyId,v.templateId])).rows[0];
      const template=await singleSignerTemplate(c,p,v.templateId);
      if(existing?.active&&existing.owner_id===p.userId&&existing.title===v.title&&existing.template_fingerprint===template.fingerprint)return list(c,p.companyId);
      const values=[p.companyId,p.userId,template.id,template.fingerprint,v.title];
      const saved=(await c.query(
        `INSERT INTO published_signing_links(company_id,owner_id,template_id,template_fingerprint,title)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(template_id) DO UPDATE SET
         owner_id=excluded.owner_id,template_fingerprint=excluded.template_fingerprint,title=excluded.title,active=true RETURNING id`,values,
      )).rows[0];
      await cancelPending(c,saved.id);
      await audit(c,{company_id:p.companyId},p,"signing_link_published",{linkId:saved.id,templateId:template.id});
    }
    return list(c,p.companyId);
  });
}

function closed():never {
  return fail(410,"SIGNING_LINK_CLOSED","This signing link is unavailable. Ask the sender for an active link.");
}
function invalid():never {
  return fail(410,"VERIFICATION_INVALID","This verification link expired, was used, or was withdrawn. Request a new email from the signing page.");
}

async function currentPublication(c:PoolClient,id:string,visitor:Visitor) {
  const link=(await c.query<Publication>("SELECT * FROM published_signing_links WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if(!link?.active)closed();
  const p={userId:link.owner_id,companyId:link.company_id,...visitor};
  try {
    await requireAdmin(c,p);
    const template=await singleSignerTemplate(c,p,link.template_id);
    if(link.template_fingerprint!==template.fingerprint)closed();
    return {link,p,template};
  }catch(err){
    if(err instanceof AppError)closed();
    throw err;
  }
}

export async function publicSigningPage(input:string,visitor:Visitor) {
  const id=idInput.parse(input);
  if(visitor.ip)await consumeLimit(`public-signing-page:${visitor.ip}`,60);
  return transaction(async c=>({title:(await currentPublication(c,id,visitor)).link.title}));
}
export async function requestSigningVerification(input:string,body:unknown,visitor:Visitor) {
  const id=idInput.parse(input);
  const v=externalRecipient.extend({retryReceipt:idInput.optional()}).parse(body);
  const synthetic=process.env.NODE_ENV!=="production"&&process.env.TEAM_ESIGN_DEV_DATABASE==="1"&&process.env.DEV_VERIFICATION_LINKS==="1";
  if(visitor.ip)await consumeLimit(`public-signing-ip:${visitor.ip}`,15);
  await consumeLimit(`public-signing-link:${id}`,30);
  await consumeLimit(`public-signing-email:${id}:${v.email}`,3);
  return transaction(async c=>{
    const {link}=await currentPublication(c,id,visitor);
    if(!synthetic&&(!mailConfigured()||process.env.NODE_ENV!=="production"||process.env.EMAIL_DISPATCH_ENABLED!=="1")){
      fail(503,"VERIFICATION_DELIVERY_UNAVAILABLE","Verification email is unavailable. Try again later or contact the sender.");
    }
    const pending=(await c.query(
      `SELECT a.id,j.status FROM signing_link_claims a LEFT JOIN delivery_jobs j
       ON j.event_key='signing-start:'||a.id
       WHERE a.link_id=$1 AND a.email=$2 AND a.used_at IS NULL AND a.cancelled_at IS NULL
         AND a.expires_at>clock_timestamp()`,[id,v.email],
    )).rows[0];
    if(pending){
      if(pending.id!==v.retryReceipt||pending.status!=="failed")return {status:synthetic?"verification_only":"pending"};
      await c.query("UPDATE signing_link_claims SET cancelled_at=clock_timestamp() WHERE id=$1",[pending.id]);
    }
    const token=newToken(),digest=hash(token);
    const claim=(await c.query(
      `INSERT INTO signing_link_claims(link_id,name,email,token_hash,expires_at)
        VALUES($1,$2,$3,$4,clock_timestamp()+interval '15 minutes') RETURNING id`,[id,v.name,v.email,digest],
    )).rows[0];
    await queueMail(c,{companyId:link.company_id,kind:"signing_start_verification",
      key:`signing-start:${claim.id}`,email:v.email,tokenHash:digest,signingClaimId:claim.id,
      subject:"Verify your email to start signing",
      text:`Confirm your email within 15 minutes: ${publicOrigin()}/start/verify/${token}`});
    return {status:synthetic?"verification_only":"pending",receipt:claim.id as string};
  });
}

export async function signingVerificationStatus(input:string,visitor:Visitor) {
  const id=idInput.parse(input);
  if(visitor.ip)await consumeLimit(`public-signing-status-ip:${visitor.ip}`,60);
  await consumeLimit(`public-signing-status:${id}`,20);
  const row=await transaction(async c=>(await c.query(
    `SELECT a.used_at,a.cancelled_at,a.expires_at<=clock_timestamp() AS expired,j.status
      FROM signing_link_claims a LEFT JOIN delivery_jobs j ON j.event_key='signing-start:'||a.id
      WHERE a.id=$1`,[id],
  )).rows[0]);
  if(!row||row.cancelled_at||row.expired)invalid();
  if(row.used_at)return {status:"used"};
  return {status:deliveryStatus(row.status)};
}

export async function redeemSigningVerification(input:string,visitor:Visitor) {
  const digest=hash(tokenInput.parse(input));
  if(visitor.ip)await consumeLimit(`public-signing-verify-ip:${visitor.ip}`,30);
  await consumeLimit(`public-signing-verify:${digest}`,8);
  return transaction(async c=>{
    const entry=(await c.query("SELECT link_id FROM signing_link_claims WHERE token_hash=$1",[digest])).rows[0];
    if(!entry)invalid();
    const {link,p,template}=await currentPublication(c,entry.link_id,visitor);
    const claim=(await c.query(
      `SELECT id,name,email FROM signing_link_claims WHERE token_hash=$1 AND used_at IS NULL
        AND cancelled_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[digest],
    )).rows[0];
    if(!claim)invalid();
    const e=await copyDraft(c,p,link.title,template.snapshot,[{
      roleId:template.role.recipientId,order:template.role.order,name:claim.name,email:claim.email,
    }]);
    const token=newToken();
    await freezeDraft(c,p,e,7,token);
    await c.query("UPDATE signing_link_claims SET used_at=clock_timestamp(),envelope_id=$2 WHERE id=$1",[claim.id,e.id]);
    await audit(c,e,{...visitor,userId:"self-service-signer"},"signing_link_verified",{linkId:link.id});
    return {path:`/sign/${token}`};
  });
}
