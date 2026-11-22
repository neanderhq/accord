import { handled,json,access } from "@/server/http";
import { signingView } from "@/server/workflow";
export const dynamic="force-dynamic";
export async function GET(req:Request,ctx:{params:Promise<{token:string}>}){return handled(async()=>json(await signingView(access(req,(await ctx.params).token))));}
