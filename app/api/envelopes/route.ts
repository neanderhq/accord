import { statusExport } from "@/server/export";
import { handled,json,principal,body,sameOrigin,noStore } from "@/server/http";
import { createEnvelope,workspace } from "@/server/workflow";
export const dynamic="force-dynamic";
export async function POST(req:Request){return handled(async()=>{sameOrigin(req);return json(await createEnvelope(await principal(req),(await body(req)).title),201);});}
export async function GET(req:Request){return handled(async()=>new Response(await statusExport(await principal(req),Object.fromEntries(new URL(req.url).searchParams)),{headers:{...noStore,"Content-Type":"text/csv","Content-Disposition":"attachment; filename=envelopes.csv"}}));}
