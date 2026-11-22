import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { getPool, transaction } from "../server/db";
import { syntheticPdf, inspectPdf } from "../server/pdf";
import type { Field } from "../lib/model";

// Synthetic identities only. The pinned Better Auth password hasher owns password encoding.
export async function seedDevelopment(password:string) {
  if(process.env.NODE_ENV==="production" || process.env.TEAM_ESIGN_DEV_DATABASE!=="1") throw new Error("Bootstrap refused: set TEAM_ESIGN_DEV_DATABASE=1 only for an isolated development database.");
  if(password.length<12||password.length>128) throw new Error("Supply TEAM_ESIGN_BOOTSTRAP_PASSWORD with 12–128 characters through the environment card.");
  getPool();
  const passwordHash=await hashPassword(password);
  const pdfs=await Promise.all([syntheticPdf("Studio services agreement"),syntheticPdf("Project schedule",true)]);
  const metadata=await Promise.all(pdfs.map(inspectPdf));
  return transaction(async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtext('team_esign_synthetic_bootstrap'))");
    if((await c.query("SELECT 1 FROM companies WHERE name='Northstar Studio (Synthetic)' LIMIT 1")).rowCount) throw new Error("Synthetic bootstrap already exists. No accounts, passwords or data changed. Use the original bootstrap password.");
    const companies:string[]=[],accounts:{companyId:string;userId:string;role:string;email:string}[]=[];
    for(const [name,prefix] of [["Northstar Studio (Synthetic)","northstar"],["Harbor Design (Synthetic)","harbor"]]) {
      const companyId=randomUUID();await c.query("INSERT INTO companies(id,name) VALUES($1,$2)",[companyId,name]);companies.push(companyId);
      for(const [role,person] of [["admin","Alex Rivera"],["sender","Sam Taylor"],["read-only","Casey Chen"]]) {
        const userId=randomUUID(),email=`${role}@${prefix}.test`;
        await c.query('INSERT INTO "user"(id,name,email,email_verified) VALUES($1,$2,$3,true)',[userId,person,email]);
        await c.query('INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES($1,$2,\'credential\',$2,$3,now())',[randomUUID(),userId,passwordHash]);
        await c.query("INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,$3)",[companyId,userId,role]);accounts.push({companyId,userId,role,email});
      }
    }
    const owner=accounts.find(a=>a.role==="sender")!,envelopeId=randomUUID();
    await c.query("INSERT INTO envelopes(id,company_id,owner_id,title,routing,folder,tags) VALUES($1,$2,$3,'Studio services agreement','sequential','Client agreements',$4)",[envelopeId,owner.companyId,owner.userId,JSON.stringify(["Synthetic","Services"])]);
    const rs=[{id:randomUUID(),name:"Avery Morgan",email:"avery@client.test",order:1},{id:randomUUID(),name:"Jordan Lee",email:"jordan@client.test",order:2}];
    for(const r of rs)await c.query("INSERT INTO recipients(id,envelope_id,name,email,routing_order) VALUES($1,$2,$3,$4,$5)",[r.id,envelopeId,r.name,r.email,r.order]);
    const fields:Field[]=[];
    for(let i=0;i<pdfs.length;i++) {
      const d=randomUUID(),m=metadata[i];
      await c.query("INSERT INTO documents(id,envelope_id,name,original,signing,sha256,size,geometry) VALUES($1,$2,$3,$4,$4,$5,$6,$7)",[d,envelopeId,i?"Project schedule.pdf":"Services agreement.pdf",pdfs[i],m.sha256,m.size,JSON.stringify(m.geometry)]);
      rs.forEach((r,j)=>fields.push({id:randomUUID(),documentId:d,recipientId:r.id,type:"signature",page:0,x:48+j*250,y:100,width:205,height:42,required:true},{id:randomUUID(),documentId:d,recipientId:r.id,type:"date",page:0,x:48+j*250,y:65,width:150,height:24,required:true}));
    }
    await c.query("UPDATE envelopes SET fields=$2 WHERE id=$1",[envelopeId,JSON.stringify(fields)]);
    await c.query("INSERT INTO audit_events(company_id,envelope_id,actor,event,data) VALUES($1,$2,$3,'synthetic_bootstrap',$4)",[owner.companyId,envelopeId,owner.userId,JSON.stringify({documents:metadata.map(m=>m.sha256),recipients:rs.map(r=>r.id),dispatch:false})]);
    return {companies,accounts,envelopeId};
  });
}
if(process.argv[1]?.endsWith("bootstrap.ts")) {
  seedDevelopment(process.env.TEAM_ESIGN_BOOTSTRAP_PASSWORD??"").then(r=>console.log(JSON.stringify({message:"Synthetic accounts and two-document, two-recipient draft persisted atomically. No email sent.",accounts:r.accounts.map(a=>a.email),envelopeId:r.envelopeId},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(process.env.DATABASE_URL)await getPool().end();});
}
