import { listPublications, managePublication } from "@/server/public-signing";
import { bulkConfirm, bulkHistory, bulkPreview } from "@/server/template-send";
import { z } from 'zod';
import { handled,json,principal,body,sameOrigin,noStore } from '@/server/http';
import * as f from '@/server/features';
import { statusExport } from '@/server/export';
import { backupExport } from '@/server/recovery';
export const dynamic='force-dynamic';
type Context={params:Promise<{resource:string}>};
export async function GET(req:Request,ctx:Context){return handled(async()=>{const p=await principal(req),r=(await ctx.params).resource;
 if(r==='contacts')return json(await f.contactList(p));if(r==='templates')return json(await f.templateList(p));if(r==='colleagues')return json(await f.colleagues(p));if(r==='settings')return json(await f.settings(p));if(r==='deliveries')return json(await f.deliveryLog(p));
 if(r==='signing-links')return json(await listPublications(p));
 if(r==='bulk-send')return json(await bulkHistory(p));
 if(r==='contact-template')return new Response('name,email\r\nAvery Morgan,avery@client.test\r\n',{headers:{...noStore,'Content-Type':'text/csv','Content-Disposition':'attachment; filename=contacts-template.csv'}});
 if(r==='status-export')return new Response(await statusExport(p,Object.fromEntries(new URL(req.url).searchParams)),{headers:{...noStore,'Content-Type':'text/csv','Content-Disposition':'attachment; filename=envelopes.csv'}});
 if(r==='backup')return new Response(JSON.stringify(await backupExport(p)),{headers:{...noStore,'Content-Type':'application/json','Content-Disposition':'attachment; filename=company-export.json'}});
 return json({error:'Not found'},404);});}
export async function POST(req:Request,ctx:Context){return handled(async()=>{sameOrigin(req);const p=await principal(req),r=(await ctx.params).resource,v=await body(req);switch(r){
 case 'signing-links':return json(await managePublication(p,v));
 case 'bulk-preview':return json(await bulkPreview(p,v));case 'bulk-send':return json(await bulkConfirm(p,v));
 case 'contacts':return json(await f.contactSave(p,v));case 'contact-delete':return json(await f.contactDelete(p,z.uuid().parse(v.id)));case 'contact-import':return json(await f.importContacts(p,z.string().max(200000).parse(v.csv)));
 case 'invite':return json(await f.inviteStaff(p,v));case 'template-save':return json(await f.saveTemplate(p,v));case 'template-use':return json(await f.useTemplate(p,v));case 'template-share':return json(await f.shareTemplate(p,v));
 case 'reissue':return json(await f.reissueEnvelope(p,v));case 'recipient-link':return json(await f.rotateRecipient(p,v));case 'reminder':return json(await f.manualReminder(p,v));case 'lifecycle':return json(await f.lifecycle(p,v));case 'settings':return json(await f.saveSettings(p,v));case 'retry':return json(await f.retryDelivery(p,v));default:return json({error:'Not found'},404);}});}
