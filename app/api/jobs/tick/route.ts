import { handled,json,boundedBody } from '@/server/http';
import { authenticateTick,runJobs } from '@/server/automation';
export const dynamic='force-dynamic';
export async function POST(req:Request){return handled(async()=>{authenticateTick(req);await boundedBody(req,1024);return json(await runJobs());});}
