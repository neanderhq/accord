import { handled,json,principal } from "@/server/http";
import { workspace } from "@/server/workflow";
export const dynamic="force-dynamic";
export async function GET(req:Request){return handled(async()=>json(await workspace(await principal(req))));}
