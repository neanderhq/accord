import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { getPool } from "../server/db";
import { backupExport, restoreTest } from "../server/recovery";
if(!process.env.DATABASE_URL||process.env.TEAM_ESIGN_DEV_DATABASE!=="1"||process.env.NODE_ENV==="production") {
 console.error("RECOVERY_SETUP_REQUIRED: supply the owner-authorized isolated development DATABASE_URL and TEAM_ESIGN_DEV_DATABASE=1. No restore test ran.");
 process.exit(2);
}
async function main(){try {
 const companies=(await getPool().query("SELECT m.company_id,m.user_id FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.active=true ORDER BY m.created_at LIMIT 1")).rows[0];
 if(!companies)throw new Error("No synthetic company membership exists for recovery verification.");
 const backup=await backupExport({userId:companies.user_id,companyId:companies.company_id});
 const result=await restoreTest(backup);
 console.log(JSON.stringify(result,null,2));
} catch(error) {
 console.error((error as Error).message);
 process.exitCode=1;
} finally { await getPool().end(); }}
void main();
