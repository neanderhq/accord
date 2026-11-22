import { handled,json,principal,body,sameOrigin } from "@/server/http";
import { getEnvelope,saveDraft } from "@/server/workflow";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(req:Request,ctx:Context){return handled(async()=>json(await getEnvelope(await principal(req),(await ctx.params).id)));}
export async function PATCH(req:Request,ctx:Context){return handled(async()=>{sameOrigin(req);return json(await saveDraft(await principal(req),(await ctx.params).id,await body(req)));});}
