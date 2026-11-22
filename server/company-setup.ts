import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { transaction } from "./db";
import { fail } from "./errors";
import { consumeLimit } from "./features";

export const setupInput=z.object({company:z.string().trim().min(1).max(100),name:z.string().trim().min(1).max(100),email:z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)),password:z.string().min(12).max(128),key:z.string().min(32,"The setup key must be 32–1024 characters and match the configured key.").max(1024,"The setup key must be 32–1024 characters and match the configured key.")});
export function setupKeyMatches(configured:string|undefined,provided:string) {
  if(!configured || configured.length<32 || configured.length>1024) return false;
  const digest=(value:string)=>createHash("sha256").update(value,"utf8").digest();
  return timingSafeEqual(digest(configured),digest(provided));
}
export async function setupCompany(input:unknown,meta:{ip?:string;ua?:string}={}) {
  await consumeLimit("first-company-setup",5);
  const configured=process.env.COMPANY_SETUP_KEY;
  if(!configured || configured.length<32 || configured.length>1024) fail(503,"SETUP_KEY_UNAVAILABLE","Company setup is unavailable. Ask the deployment administrator to configure a private COMPANY_SETUP_KEY of 32–1024 characters.");
  const value=setupInput.parse(input);
  if(!setupKeyMatches(configured,value.key)) fail(403,"SETUP_KEY_INVALID","The setup key is incorrect. It must match the configured key and be 32–1024 characters long.");
  const encoded=await hashPassword(value.password);
  return transaction(async client=>{
    await client.query("LOCK TABLE companies IN SHARE ROW EXCLUSIVE MODE");
    if((await client.query("SELECT 1 FROM companies LIMIT 1")).rowCount) fail(409,"SETUP_COMPLETE","A company already exists. Ask an administrator for an invitation.");
    if((await client.query('SELECT 1 FROM "user" WHERE lower(email)=$1',[value.email])).rowCount) fail(409,"ACCOUNT_EXISTS","An account already uses this email address. Contact an administrator.");
    const companyId=randomUUID(),userId=randomUUID();
    await client.query("INSERT INTO companies(id,name) VALUES($1,$2)",[companyId,value.company]);
    await client.query('INSERT INTO "user"(id,name,email,email_verified) VALUES($1,$2,$3,true)',[userId,value.name,value.email]);
    await client.query("INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES($1,$2,'credential',$2,$3,clock_timestamp())",[randomUUID(),userId,encoded]);
    await client.query("INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'admin')",[companyId,userId]);
    await client.query("INSERT INTO audit_events(company_id,actor,event,ip,ua,data) VALUES($1,$2,'first_workspace_created',$3,$4,'{}'::jsonb)",[companyId,userId,meta.ip??null,meta.ua??null]);
    return {created:true};
  });
}
