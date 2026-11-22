import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const temporary=mkdtempSync(join(tmpdir(),'team-esign-auth-'));
try {
  const cli=JSON.parse(readFileSync('node_modules/auth/package.json','utf8'));
  assert.equal(cli.version,'1.7.3');
  const bin=typeof cli.bin==='string'?cli.bin:Object.values(cli.bin)[0];
  const output=join(temporary,'auth-schema.ts');
  const result=spawnSync(process.execPath,[join('node_modules/auth',bin),'generate','--config','.neander/auth-schema-config.ts','--output',output,'--yes'],{stdio:'pipe',encoding:'utf8',env:{...process.env,BETTER_AUTH_URL:'http://localhost:3000'}});
  if(result.status!==0)throw new Error(`Pinned auth schema generation failed: ${result.stderr}`);
  const normalize=v=>v.replace(/\r\n/g,'\n').trim();
  assert.equal(normalize(readFileSync(output,'utf8')),normalize(readFileSync('server/auth-schema.ts','utf8')),'Generated Better Auth schema drift. Regenerate with the pinned CLI and add a Drizzle migration.');
  console.log('auth@1.7.3 generated schema exactly matches server/auth-schema.ts. No database used.');
} finally {rmSync(temporary,{recursive:true,force:true});}
