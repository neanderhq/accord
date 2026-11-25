import { changeCompletionCopy, getCompletionCopy } from "@/server/completion-copy";
import { revokeShare, shareList } from "@/server/features";
import { z } from "zod";
import { handled,json,principal,body,sameOrigin,boundedBody,file } from "@/server/http";
import { sendEnvelope,voidEnvelope,uploadDocument,verificationLinks,senderDocument,shareEnvelope } from "@/server/workflow";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string;action:string}>};
export async function POST(req:Request,ctx:Context){return handled(async()=>{
  sameOrigin(req);const p=await principal(req),{id,action}=await ctx.params;
  if(action==="documents") {const version=z.coerce.number().int().positive().parse(req.headers.get("x-envelope-version"));const name=decodeURIComponent(req.headers.get("x-file-name")??"upload.pdf");const kind=req.headers.get("content-type")??"application/pdf";if(!/^[-A-Za-z0-9 ._,()]+$/.test(name)||name.length>120) return json({error:"Invalid file name",code:"FILE_INVALID"},400);if(!/^application\/(pdf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/.test(kind)) return json({error:"Upload PDF or DOCX only",code:"FILE_INVALID"},400);return json(await uploadDocument(p,id,version,name,await boundedBody(req,8*1024*1024)),201);}
  const v=await body(req);
  if(action==="send")return json(await sendEnvelope(p,id,v));
  if(action==="completion-copy")return json(await changeCompletionCopy(p,id,v));
  if(action==="void")return json(await voidEnvelope(p,id,v));
  if(action==="verification-links")return json(await verificationLinks(p,id,z.enum(["sign","complete"]).parse(v.kind??"sign")));
  if(action==="unshare")return json(await revokeShare(p,id,z.string().min(1).max(100).parse(v.userId)));
  if(action==="share")return json(await shareEnvelope(p,id,z.string().min(1).max(100).parse(v.userId)));
  return json({error:"Action not found"},404);
});}
export async function GET(req:Request,ctx:Context){return handled(async()=>{const p=await principal(req),{id,action}=await ctx.params,url=new URL(req.url);if(action==="shares")return json(await shareList(p,id));
  if(action==="completion-copy")return json(await getCompletionCopy(p,id));
  if(!["documents","outputs"].includes(action))return json({error:"Not found"},404);return file(await senderDocument(p,id,z.uuid().parse(url.searchParams.get("file")),action==="outputs"));});}
