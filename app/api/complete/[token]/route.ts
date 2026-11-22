import { handled,json,access,file } from "@/server/http";
import { completionView } from "@/server/workflow";
export const dynamic="force-dynamic";
export async function GET(req:Request,ctx:{params:Promise<{token:string}>}){return handled(async()=>{const outputId=new URL(req.url).searchParams.get("file")??undefined;const result=await completionView(access(req,(await ctx.params).token),outputId);return outputId?file(result as {name:string;bytes:Buffer;sha256:string;kind:string}):json(result);});}
