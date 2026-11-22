import { handled,json,body,sameOrigin } from '@/server/http';
import { getAuth } from '@/server/auth';
import { requestRecovery,redeemToken,consumeLimit } from '@/server/features';
export const dynamic='force-dynamic';
export async function POST(req:Request,ctx:{params:Promise<{action:string}>}){return handled(async()=>{sameOrigin(req);const {action}=await ctx.params,v=await body(req);await consumeLimit('public-account:'+action,60);if(action==='recover')return json(await requestRecovery(v.email));if(action==='invite'||action==='reset'){const session=action==='invite'?await getAuth().api.getSession({headers:req.headers}):null;return json(await redeemToken(action,v,session?.user.id));}return json({error:'Not found'},404);});}
