import { getAuth } from "@/server/auth";
import { handled,json } from "@/server/http";
export const dynamic="force-dynamic";
export async function GET(req:Request){return handled(async()=>{const session=await getAuth().api.getSession({headers:req.headers});return session?json({id:session.user.id,name:session.user.name,email:session.user.email}):json({error:"Sign in required"},401);});}
