import nextEnv from '@next/env';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd());
if(!process.env.DATABASE_URL||process.env.TEAM_ESIGN_DEV_DATABASE!=='1'||process.env.NODE_ENV==='production') {
 console.error('INTEGRATION_SETUP_REQUIRED: supply an isolated development DATABASE_URL and TEAM_ESIGN_DEV_DATABASE=1 through the environment card; apply pnpm db:migrate first. No integration tests ran. No fallback database is started.');
 process.exitCode=2;
} else {
 const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000});
 let ready=false;
 try{
  await client.connect();
  const result=await client.query("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='completion_consistency' AND NOT tgisinternal) AND to_regclass('public.rate_limit') IS NOT NULL AS ready");
  ready=result.rows[0].ready;
  if(!ready)console.error('INTEGRATION_MIGRATIONS_REQUIRED: required migration guards are absent. Confirm this is the isolated Team eSignature development target, then run pnpm db:migrate. No workflow tests ran; no data was written.');
 }catch{console.error('INTEGRATION_DATABASE_UNAVAILABLE: check the isolated development connection through the environment card. No workflow tests ran.');}
 finally{await client.end();}
 if(!ready)process.exitCode=2;
 else{
  const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/integration.test.ts'],{stdio:'inherit',env:process.env});
  if(result.status!==0) process.exitCode=result.status??1;
  else {const setup=spawnSync(process.execPath,['--import','tsx','--test','tests/company-setup.integration.test.ts'],{stdio:'inherit',env:process.env});process.exitCode=setup.status??1;}
 }
}
