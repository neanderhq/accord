import { body, handled, json, metadata, sameOrigin } from "@/server/http";
import { publicSigningPage, redeemSigningVerification, requestSigningVerification, signingVerificationStatus } from "@/server/public-signing";

export const dynamic="force-dynamic";
type Context={params:Promise<{action:string;token:string}>};

export async function GET(req:Request,ctx:Context) {
  return handled(async()=>{
    const {action,token}=await ctx.params;
    if(action==="start")return json(await publicSigningPage(token,metadata(req)));
    if(action==="status")return json(await signingVerificationStatus(token,metadata(req)));
    return json({error:"Not found"},404);
  });
}

export async function POST(req:Request,ctx:Context) {
  return handled(async()=>{
    sameOrigin(req);
    const {action,token}=await ctx.params;
    if(action==="start")return json(await requestSigningVerification(token,await body(req),metadata(req)),202);
    if(action==="verify")return json(await redeemSigningVerification(token,metadata(req)));
    return json({error:"Not found"},404);
  });
}
