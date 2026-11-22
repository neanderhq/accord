import { getPool } from "@/server/db";
import { json } from "@/server/http";
export const dynamic="force-dynamic";
export async function GET(){
  const configured={database:!!process.env.DATABASE_URL,authSecret:(process.env.BETTER_AUTH_SECRET?.length??0)>=32,authOrigin:!!process.env.BETTER_AUTH_URL,developmentLinks:process.env.NODE_ENV!=="production"&&process.env.DEV_VERIFICATION_LINKS==="1"};
  let databaseState="missing";
  if(configured.database)try{const result=await getPool().query("SELECT to_regclass('public.companies') IS NOT NULL AND to_regclass('public.rate_limit') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='completion_consistency' AND NOT tgisinternal) AS ready");databaseState=result.rows[0].ready?"reachable_and_migrated":"migration_required";}catch{databaseState="unavailable";}
  return json({configured,databaseState,email:"off",conversion:"PDF only",scheduler:"unconfigured",webhooks:"unconfigured",recovery:"unverified"});
}
