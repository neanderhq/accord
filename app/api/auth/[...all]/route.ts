import { getAuth } from "@/server/auth";
import { handled, json } from "@/server/http";
export const dynamic="force-dynamic";
async function auth(req:Request) {return handled(async()=>{
  const path=new URL(req.url).pathname;
  if(path.includes("sign-up")||path.includes("request-password-reset")||path.includes("reset-password")||path.includes("change-email")||path.includes("delete-user")) return json({error:"Public registration and recovery are unavailable. Contact your workspace administrator. No email provider is configured.",code:"CONTROLLED_ACCESS"},403);
  return getAuth().handler(req);
});}
export const GET=auth;export const POST=auth;
