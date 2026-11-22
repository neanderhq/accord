import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { verifyPassword } from "better-auth/crypto";

test("first setup is atomic, one-time, rate-limited and auditable",async()=>{
 const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 const schema="setup_test_"+randomUUID().replaceAll("-","");
 try{
  await admin.query(`CREATE SCHEMA "${schema}"`);
  for(const table of ["companies","user","account","session","rate_limit","memberships","audit_events","request_limits"]) await admin.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
  const url=new URL(process.env.DATABASE_URL!);url.searchParams.set("options",`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
  process.env.BETTER_AUTH_URL="http://localhost:3000";process.env.BETTER_AUTH_SECRET="test-auth-secret-"+"x".repeat(32);process.env.COMPANY_SETUP_KEY="test-setup-key-"+"x".repeat(32);
  const {POST}=await import("../app/api/company-setup/route");const {getPool}=await import("../server/db");const {authOptions,getAuth}=await import("../server/auth");assert.equal(authOptions().emailAndPassword.disableSignUp,true);
  const key=process.env.COMPANY_SETUP_KEY,origin="http://localhost:3000";
  const request=(setupKey=key)=>new Request(origin+"/api/company-setup",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({company:"Synthetic setup",name:"First admin",email:"first@example.test",password:"synthetic-password-123",key:setupKey})});
  delete process.env.COMPANY_SETUP_KEY;assert.equal((await POST(request())).status,503);process.env.COMPANY_SETUP_KEY=key;
  const foreign=new Request(origin+"/api/company-setup",{method:"POST",headers:{origin:"https://foreign.example","content-type":"application/json"},body:"{}"});assert.equal((await POST(foreign)).status,403);
  assert.equal((await POST(request("wrong-key-"+"x".repeat(32)))).status,403);
  await admin.query(`DELETE FROM "${schema}".request_limits`);
  await admin.query(`ALTER TABLE "${schema}".audit_events ADD CONSTRAINT reject_setup CHECK (event <> 'first_workspace_created')`);
  assert.equal((await POST(request())).status,500);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM "${schema}".companies`)).rows[0].n,0);
  await admin.query(`ALTER TABLE "${schema}".audit_events DROP CONSTRAINT reject_setup`);
  const results=await Promise.all([POST(request()),POST(request())]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const record=await admin.query(`SELECT c.name,u.email,m.role,a.password,(SELECT count(*)::int FROM "${schema}".audit_events WHERE event='first_workspace_created') AS audits FROM "${schema}".companies c JOIN "${schema}".memberships m ON m.company_id=c.id JOIN "${schema}"."user" u ON u.id=m.user_id JOIN "${schema}".account a ON a.user_id=u.id`);
  assert.equal(record.rowCount,1);assert.equal(record.rows[0].role,"admin");assert.equal(record.rows[0].audits,1);assert.ok(await verifyPassword({hash:record.rows[0].password,password:"synthetic-password-123"}));
  const login=await getAuth().handler(new Request(origin+"/api/auth/sign-in/email",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({email:"first@example.test",password:"synthetic-password-123"})}));assert.equal(login.status,200,await login.clone().text());
  assert.equal((await POST(request())).status,409);assert.equal((await POST(request())).status,409);assert.equal((await POST(request())).status,429);
  await getPool().end();
 }finally{await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}
});
