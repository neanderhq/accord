import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { getPool } from "../server/db";
import * as features from "../server/features";
import type { Principal } from "../server/workflow";

const COMPANY_NAME = "QA FlowCo (Synthetic)";
const KEEP_TITLES = ["QA browser parallel draft", "QA browser sequential draft", "QA browser template"];
const REASON = "QA cleanup: duplicate draft from failed seed attempt";

async function run() {
  const company = (await getPool().query("SELECT id FROM companies WHERE name=$1 LIMIT 1", [COMPANY_NAME])).rows[0];
  if (!company) throw new Error(`Company not found: ${COMPANY_NAME}`);
  const account = (await getPool().query('SELECT m.user_id FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.company_id=$1 AND u.email=$2 AND m.role=$3 AND m.active=true LIMIT 1', [company.id, "qa-admin@flowco.test", "admin"])).rows[0];
  if (!account) throw new Error("QA admin account not found.");
  const admin: Principal = { companyId: company.id, userId: account.user_id, ip: "127.0.0.1", ua: "QA cleanup" };

  const keepIds = new Set<string>();
  for (const title of KEEP_TITLES) {
    const row = (await getPool().query("SELECT id FROM envelopes WHERE company_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1", [company.id, title])).rows[0];
    if (row) keepIds.add(row.id);
  }
  for (const row of (await getPool().query("SELECT source_envelope_id FROM templates WHERE company_id=$1", [company.id])).rows) keepIds.add(row.source_envelope_id);

  const drafts = (await getPool().query(`SELECT e.id,e.title FROM envelopes e LEFT JOIN envelope_lifecycle l ON l.envelope_id=e.id WHERE e.company_id=$1 AND e.state='draft' AND l.deleted_at IS NULL ORDER BY e.created_at,e.id`, [company.id])).rows;
  const errors: { id: string; title: string; error: string }[] = [];
  let deleted = 0;
  for (const draft of drafts) {
    if (keepIds.has(draft.id)) continue;
    try {
      await features.lifecycle(admin, { envelopeId: draft.id, action: "delete", reason: REASON });
      deleted++;
    } catch (error) {
      errors.push({ id: draft.id, title: draft.title, error: (error as Error).message });
    }
  }

  console.log(JSON.stringify({ draftsFound: drafts.length, kept: keepIds.size, deleted, errors }));
  const remaining = (await getPool().query(`SELECT e.title FROM envelopes e LEFT JOIN envelope_lifecycle l ON l.envelope_id=e.id WHERE e.company_id=$1 AND e.state='draft' AND l.deleted_at IS NULL ORDER BY e.created_at DESC,e.id DESC`, [company.id])).rows.map(row => row.title);
  console.log(JSON.stringify({ remainingDraftTitles: remaining }));
}

async function main() {
  if (process.env.TEAM_ESIGN_DEV_DATABASE !== "1" || process.env.NODE_ENV === "production") {
    console.error("QA cleanup refused: set TEAM_ESIGN_DEV_DATABASE=1 only for an isolated development database.");
    process.exit(1);
  }
  try { await run(); }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
  finally { await getPool().end().catch(() => undefined); }
}
if (process.argv[1]?.endsWith("qa-cleanup.ts")) void main();
