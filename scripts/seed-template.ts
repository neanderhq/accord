// Fictional template data only. An existing workspace is preserved in full on repeat runs.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { syntheticPdf, inspectPdf } from '../server/pdf';
import type { Field } from '../lib/model';

export const DEMO_COMPANY_ID = 'aaca0000-0000-4000-8000-000000000001';
export async function seedTemplate(databaseUrl = process.env.DATABASE_URL, password = process.env.DEMO_PASSWORD) {
  if (!databaseUrl || !password || password.length < 12 || password.length > 128) throw new Error('DATABASE_URL and a 12–128 character DEMO_PASSWORD are required');
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query('INSERT INTO companies(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id', [DEMO_COMPANY_ID, 'Northstar Studio']);
    if (!created.rowCount) { await client.query('COMMIT'); return { created: false }; }
    const encoded = await hashPassword(password);
    const users: Record<string, string> = {};
    for (const [role, prefix, name] of [['admin', 'admin', 'Alex Rivera'], ['sender', 'sender', 'Sam Taylor'], ['read-only', 'viewer', 'Casey Chen']]) {
      const id = randomUUID(); users[role] = id;
      await client.query('INSERT INTO "user"(id,name,email,email_verified) VALUES($1,$2,$3,true)', [id, name, `${prefix}@accord.test`]);
      await client.query("INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES($1,$2,'credential',$2,$3,now())", [randomUUID(), id, encoded]);
      await client.query('INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,$3)', [DEMO_COMPANY_ID, id, role]);
    }
    await client.query("INSERT INTO company_settings(company_id,brand_name,brand_color) VALUES($1,'Accord','#2563eb')", [DEMO_COMPANY_ID]);
    for (const [name, email] of [['Avery Morgan', 'avery@client.test'], ['Jordan Lee', 'jordan@client.test']]) {
      await client.query('INSERT INTO contacts(company_id,name,email) VALUES($1,$2,$3)', [DEMO_COMPANY_ID, name, email]);
    }
    const pdfs = await Promise.all([syntheticPdf('Fictional studio services agreement'), syntheticPdf('Fictional project schedule', true)]);
    const metadata = await Promise.all(pdfs.map(inspectPdf));
    for (const [title, routing, archived] of [['Studio services agreement', 'sequential', false], ['Design proposal', 'parallel', false], ['Archived project agreement', 'parallel', true]] as const) {
      const envelopeId = randomUUID();
      await client.query("INSERT INTO envelopes(id,company_id,owner_id,title,routing,folder,tags) VALUES($1,$2,$3,$4,$5,'Client agreements',$6)", [envelopeId, DEMO_COMPANY_ID, users.sender, title, routing, JSON.stringify(['Sample', 'Services'])]);
      const recipients = [{ id: randomUUID(), name: 'Avery Morgan', email: 'avery@client.test' }, { id: randomUUID(), name: 'Jordan Lee', email: 'jordan@client.test' }];
      for (const [index, recipient] of recipients.entries()) {
        await client.query('INSERT INTO recipients(id,envelope_id,name,email,routing_order) VALUES($1,$2,$3,$4,$5)', [recipient.id, envelopeId, recipient.name, recipient.email, index + 1]);
      }
      const fields: Field[] = [];
      for (const [index, bytes] of pdfs.entries()) {
        const documentId = randomUUID(), meta = metadata[index];
        await client.query('INSERT INTO documents(id,envelope_id,name,original,signing,sha256,size,geometry) VALUES($1,$2,$3,$4,$4,$5,$6,$7)', [documentId, envelopeId, index ? 'Project schedule.pdf' : 'Services agreement.pdf', bytes, meta.sha256, meta.size, JSON.stringify(meta.geometry)]);
        for (const [position, recipient] of recipients.entries()) {
          fields.push({ id: randomUUID(), documentId, recipientId: recipient.id, type: 'signature', page: 0, x: 48 + position * 250, y: 100, width: 205, height: 42, required: true }, { id: randomUUID(), documentId, recipientId: recipient.id, type: 'date', page: 0, x: 48 + position * 250, y: 65, width: 150, height: 24, required: true });
        }
      }
      await client.query('UPDATE envelopes SET fields=$2 WHERE id=$1', [envelopeId, JSON.stringify(fields)]);
      await client.query('INSERT INTO envelope_shares(envelope_id,user_id) VALUES($1,$2)', [envelopeId, users['read-only']]);
      if (archived) {
        await client.query("UPDATE envelopes SET state='sent',sent_at=now()-interval '14 days',expires_at=now()+interval '7 days' WHERE id=$1", [envelopeId]);
        await client.query("UPDATE envelopes SET state='voided',reason='Fictional archived example; no signing request was delivered' WHERE id=$1", [envelopeId]);
        await client.query("INSERT INTO envelope_lifecycle(envelope_id,archived_at) VALUES($1,now()-interval '7 days')", [envelopeId]);
      }
      await client.query("INSERT INTO audit_events(company_id,envelope_id,actor,event,data) VALUES($1,$2,$3,'template_seeded',$4)", [DEMO_COMPANY_ID, envelopeId, users.admin, JSON.stringify({ fictional: true, emailSent: false, signed: false })]);
    }
    await client.query('COMMIT');
    return { created: true };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
if (process.argv[1]?.endsWith('seed-template.ts')) seedTemplate()
  .then(result => console.log(result.created ? 'Accord fictional workspace created' : 'Accord existing workspace preserved'))
  .catch(error => { console.error(error instanceof Error ? error.message : 'SEED_FAILED'); process.exitCode = 1; });
