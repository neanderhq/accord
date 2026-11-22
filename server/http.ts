import { consumeLimit } from "./features";
import { z, ZodError } from "zod";
import { AppError, fail } from "./errors";
import { getAuth } from "./auth";
import { originTrusted } from "./origins";
import { getPool } from "./db";
import type { Principal, Access } from "./workflow";
export const noStore={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export function json(value:unknown,status=200) {return Response.json(value,{status,headers:noStore});}
export async function handled(fn:()=>Promise<Response>) {try{return await fn();}catch(e){
  if(e instanceof AppError) return json({error:e.message,code:e.code},e.status);
  if(e instanceof ZodError) return json({error:e.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; "),code:"VALIDATION_ERROR"},400);
  const pgCode=(e as {code?:string})?.code;
  if(["ECONNREFUSED","ENOTFOUND","ETIMEDOUT","28P01","3D000","42P01"].includes(pgCode??"")) return json({code:"DATABASE_UNAVAILABLE",error:"Database unavailable or migrations missing. Check the isolated development DATABASE_URL and run the committed migration. No success has been recorded."},503);
  console.error("Accord request failed",{code:pgCode??"UNKNOWN"});
  return json({error:"The operation could not be completed. Reload and retry; contact the administrator if it continues.",code:"OPERATION_FAILED"},500);
}}
export function metadata(req:Request) {
  // Never trust browser-supplied forwarding headers. Only explicitly enabled deployment trust reads Cloud Run's appended hop.
  const ip=process.env.TRUST_PROXY_IP==="1" ? req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim().slice(0,64) : undefined;
  return {ip,ua:req.headers.get("user-agent")?.slice(0,512)};
}
export function sameOrigin(req:Request) {
  const expected=process.env.BETTER_AUTH_URL||(process.env.NODE_ENV!=="production"?new URL(req.url).origin:undefined);
  if(!expected || !originTrusted(req.headers.get("origin"),expected)) fail(403,"ORIGIN_REJECTED","The request origin could not be verified. Reload the application.");
}
export async function principal(req:Request):Promise<Principal> {
  getPool();const session=await getAuth().api.getSession({headers:req.headers});if(!session) fail(401,"SIGN_IN_REQUIRED","Sign in to your workspace.");
  const company=req.headers.get("x-company-id");
  const m=(await getPool().query("SELECT company_id FROM memberships WHERE user_id=$1 AND active=true AND ($2::uuid IS NULL OR company_id=$2::uuid) ORDER BY created_at LIMIT 1",[session.user.id,company?z.uuid().parse(company):null])).rows[0];
  await consumeLimit("user:"+session.user.id,240);
  if(!m) fail(403,"MEMBERSHIP_REQUIRED","Your workspace membership is inactive. Contact your administrator.");return {userId:session.user.id,companyId:m.company_id,...metadata(req)};
}
export const access=(req:Request,token:string):Access=>({token,code:req.headers.get("x-access-code")??undefined,...metadata(req)});
export async function boundedBody(req:Request,max:number) {
  if(Number(req.headers.get("content-length")??0)>max) fail(413,"BODY_TOO_LARGE","The request exceeds the allowed size.");
  const reader=req.body?.getReader();if(!reader) return Buffer.alloc(0);const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max){await reader.cancel();fail(413,"BODY_TOO_LARGE","The request exceeds the allowed size.");}chunks.push(r.value);}}finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function body(req:Request) {try{return JSON.parse((await boundedBody(req,256*1024)).toString());}catch(e){if(e instanceof AppError)throw e;fail(400,"JSON_INVALID","The request body is not valid JSON.");}}
export function file(d:{bytes:Buffer;name:string;sha256:string;kind?:string}) {
  const contentType=d.kind==="receipt"?"application/json":"application/pdf";
  return new Response(new Uint8Array(d.bytes),{headers:{...noStore,"Content-Type":contentType,"Content-Length":String(d.bytes.length),"Content-Disposition":`inline; filename="${d.name.replace(/[^a-zA-Z0-9 ._-]/g,"_")}"`,"X-Content-SHA256":d.sha256,"Content-Security-Policy":"sandbox"}});
}
