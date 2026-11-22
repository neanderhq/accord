import { handled,json,access,body,sameOrigin,file } from "@/server/http";
import { consent,submit,decline,signingDocument } from "@/server/workflow";
export const dynamic="force-dynamic";
type Context={params:Promise<{token:string;action:string}>};
export async function POST(req:Request,ctx:Context){return handled(async()=>{sameOrigin(req);const {token,action}=await ctx.params,a=access(req,token),v=await body(req);
  if(action==="consent"){if(v.accepted!==true)return json({error:"Explicit consent is required"},400);return json(await consent(a));}
  if(action==="submit")return json(await submit(a,v));
  if(action==="decline")return json(await decline(a,v.reason));
  return json({error:"Not found"},404);
});}
export async function GET(req:Request,ctx:Context){return handled(async()=>{const {token,action}=await ctx.params;if(action!=="document")return json({error:"Not found"},404);return file(await signingDocument(access(req,token),new URL(req.url).searchParams.get("file")??""));});}
