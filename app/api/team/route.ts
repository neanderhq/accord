import { handled,json,principal,sameOrigin,body } from "@/server/http";
import { team,changeMember } from "@/server/workflow";
export const dynamic="force-dynamic";
export async function GET(req:Request){return handled(async()=>json(await team(await principal(req))));}
export async function PATCH(req:Request){return handled(async()=>{sameOrigin(req);return json(await changeMember(await principal(req),await body(req)));});}
