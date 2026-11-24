import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { degrees, PDFDocument } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
import { getPool, transaction } from "../server/db";
import { syntheticPdf } from "../server/pdf";
import * as workflow from "../server/workflow";
import * as features from "../server/features";
import type { Principal } from "../server/workflow";
import type { Field } from "../lib/model";

const COMPANY_NAME = "QA FlowCo (Synthetic)";
const RIVAL_NAME = "QA Rival (Synthetic)";
const PASSWORD = "QaBrowser-2026";
const IP = "127.0.0.1";
const UA = "QA seed";

type Account = { companyId: string; userId: string; role: "admin" | "sender" | "read-only"; email: string };

async function realDocx(text: string) {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p></w:body></w:document>`;
  const content = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
  return Buffer.from(zipSync({ "[Content_Types].xml": strToU8(content), "word/document.xml": strToU8(document) }, { level: 0 }));
}

async function addDocuments(principal: Principal, envelopeId: string, portrait: Buffer, rotated: Buffer, docx: Buffer) {
  let envelope = await workflow.createEnvelope(principal, envelopeId);
  envelope = await workflow.uploadDocument(principal, envelope.id, 1, "Agreement.pdf", portrait);
  envelope = await workflow.uploadDocument(principal, envelope.id, envelope.version, "Rotated schedule.pdf", rotated);
  if (docx) envelope = await workflow.uploadDocument(principal, envelope.id, envelope.version, "Converted notes.docx", docx);
  return envelope;
}

async function saveDraft(principal: Principal, envelope: Awaited<ReturnType<typeof addDocuments>>, title: string, routing: "parallel" | "sequential", recipients: any[], fields: Field[]) {
  return workflow.saveDraft(principal, envelope.id, { version: envelope.version, title, routing, recipients, fields });
}

async function twoFields(envelope: Awaited<ReturnType<typeof addDocuments>>, recipients: any[]): Promise<Field[]> {
  const agreement = envelope.documents[0];
  return [...recipients.flatMap(recipient => [
    { id: randomUUID(), documentId: agreement.id, recipientId: recipient.id, type: "signature" as const, page: 0, x: 60 + (recipient.order - 1) * 250, y: 100, width: 180, height: 40, required: true },
    { id: randomUUID(), documentId: agreement.id, recipientId: recipient.id, type: "date" as const, page: 0, x: 60 + (recipient.order - 1) * 250, y: 60, width: 150, height: 24, required: true },
  ]), ...envelope.documents.slice(1).map(document => ({ id: randomUUID(), documentId: document.id, recipientId: recipients[0].id, type: "signature" as const, page: 0, x: 60, y: 220, width: 160, height: 40, required: true }))];
}

async function envelopeJson(principal: Principal, id: string) {
  const envelope = await workflow.getEnvelope(principal, id);
  const links: { name: string; email: string; path: string }[] = [];
  return { id, title: envelope.title, state: envelope.state, recipients: envelope.recipients.map(({ name, email }) => ({ name, email })), links };
}

async function accountsJson(companyId: string, rivalId: string) {
  const ids = [companyId, rivalId].filter(Boolean);
  if (!ids.length) return [];
  return (await getPool().query('SELECT u.email,m.role,c.name AS company FROM "user" u JOIN memberships m ON m.user_id=u.id JOIN companies c ON c.id=m.company_id WHERE m.company_id=ANY($1::uuid[]) ORDER BY m.company_id,u.email', [ids])).rows.map(({ email, role, company }) => ({ email, role, company }));
}

async function ensureCompany(c: { query: any }, name: string) {
  const existing = (await c.query("SELECT id FROM companies WHERE name=$1 LIMIT 1", [name])).rows[0]?.id;
  if (existing) return existing;
  const id = randomUUID();
  await c.query("INSERT INTO companies(id,name) VALUES($1,$2)", [id, name]);
  return id;
}

async function ensureAccount(c: { query: any }, companyId: string, role: Account["role"], name: string, email: string, passwordHash: string) {
  let userId = (await c.query('SELECT u.id FROM "user" u JOIN memberships m ON m.user_id=u.id WHERE m.company_id=$1 AND u.email=$2 LIMIT 1', [companyId, email])).rows[0]?.id;
  if (!userId) {
    userId = (await c.query('SELECT id FROM "user" WHERE email=$1 LIMIT 1', [email])).rows[0]?.id;
  }
  if (!userId) {
    userId = randomUUID();
    await c.query('INSERT INTO "user"(id,name,email,email_verified) VALUES($1,$2,$3,true)', [userId, name, email]);
  }
  const membership = (await c.query("SELECT 1 FROM memberships WHERE company_id=$1 AND user_id=$2 LIMIT 1", [companyId, userId])).rowCount;
  if (!membership) await c.query("INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,$3)", [companyId, userId, role]);
  const credential = await c.query("UPDATE account SET password=$2,updated_at=now() WHERE user_id=$1 AND provider_id='credential'", [userId, passwordHash]);
  if (!credential.rowCount) {
    await c.query("INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES($1,$2,'credential',$2,$3,now())", [randomUUID(), userId, passwordHash]);
  }
  return { companyId, userId, role, email };
}

async function latestFixture(principal: Principal, title: string) {
  return (await getPool().query("SELECT id FROM envelopes WHERE company_id=$1 AND title=$2 ORDER BY CASE WHEN state='sent' THEN 0 WHEN jsonb_array_length(fields)>0 AND EXISTS(SELECT 1 FROM recipients WHERE envelope_id=envelopes.id) THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 1", [principal.companyId, title])).rows[0]?.id;
}

async function run() {
  const passwordHash = await hashPassword(PASSWORD);
  const accounts2: Account[] = [];
  let qaCompanyId = "", rivalCompanyId = "";
  await transaction(async c => {
    qaCompanyId = await ensureCompany(c, COMPANY_NAME);
    rivalCompanyId = await ensureCompany(c, RIVAL_NAME);
    accounts2.push(await ensureAccount(c, qaCompanyId, "admin", "Quinn Admin", "qa-admin@flowco.test", passwordHash));
    accounts2.push(await ensureAccount(c, qaCompanyId, "sender", "Sasha Sender", "qa-sender@flowco.test", passwordHash));
    accounts2.push(await ensureAccount(c, qaCompanyId, "read-only", "Riley Viewer", "qa-view@flowco.test", passwordHash));
    accounts2.push(await ensureAccount(c, rivalCompanyId, "admin", "Rowan Rival", "qa-rival@rival.test", passwordHash));
  });
  const sender = accounts2.find(a => a.email === "qa-sender@flowco.test")!;
  process.env.DEV_VERIFICATION_LINKS = "1";
  if (!await getPool().query("SELECT 1 FROM contacts WHERE company_id=$1 LIMIT 1", [qaCompanyId]).then(result => result.rowCount)) {
    await features.importContacts(sender, "name,email\r\nAvery Morgan,avery@client.test\r\nJordan Lee,jordan@client.test");
  }
  const portrait = await syntheticPdf("QA browser agreement");
  const rotatedDocument = await PDFDocument.create(), rotatedPage = rotatedDocument.addPage([700, 900]);
  rotatedPage.setCropBox(30, 40, 600, 800); rotatedPage.setRotation(degrees(90)); rotatedPage.drawText("QA browser schedule", { x: 60, y: 700, size: 12 });
  const rotated = Buffer.from(await rotatedDocument.save()), docx = await realDocx("QA browser converted notes");
  const template = (await getPool().query("SELECT id,name FROM templates WHERE company_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [qaCompanyId])).rows[0];
  if (!template) {
    const templateEnvelopeId = await latestFixture(sender, "QA browser template");
    let templateEnvelope = templateEnvelopeId ? await workflow.getEnvelope(sender, templateEnvelopeId) : undefined;
    if (!templateEnvelope) {
      templateEnvelope = await addDocuments(sender, "QA browser template", portrait, rotated, undefined as any);
      const templateRecipients = [
        { id: randomUUID(), name: "Avery Morgan", email: "avery@client.test", order: 1 },
        { id: randomUUID(), name: "Jordan Lee", email: "jordan@client.test", order: 2 },
      ];
      templateEnvelope = await saveDraft(sender, templateEnvelope, templateEnvelope.title, "parallel", templateRecipients, await twoFields(templateEnvelope, templateRecipients));
    }
    const orderedRecipients = [...templateEnvelope.recipients].sort((a, b) => a.order - b.order);
    await features.saveTemplate(sender, {
      envelopeId: templateEnvelope.id,
      name: "QA browser template",
      roles: orderedRecipients.map((recipient, index) => ({ recipientId: recipient.id, name: index === 0 ? "Client" : "Supplier" })),
    });
  }
  let parallelEnvelope: Awaited<ReturnType<typeof addDocuments>> | undefined;
  if (!parallelEnvelope) {
    parallelEnvelope = await addDocuments(sender, "QA browser parallel draft", portrait, rotated, docx);
  const parallelRecipients = [
    { id: randomUUID(), name: "Avery Morgan", email: "avery@client.test", order: 1, accessCode: "Avery-code-123" },
    { id: randomUUID(), name: "Jordan Lee", email: "jordan@client.test", order: 2 },
  ];
  const agreement = parallelEnvelope.documents[0];
  const averyFields: Field[] = [
    { id: randomUUID(), documentId: agreement.id, recipientId: parallelRecipients[0].id, type: "signature", page: 0, x: 60, y: 220, width: 160, height: 40, required: true },
    { id: randomUUID(), documentId: agreement.id, recipientId: parallelRecipients[0].id, type: "initials", page: 0, x: 60, y: 170, width: 80, height: 28, required: true },
    { id: randomUUID(), documentId: agreement.id, recipientId: parallelRecipients[0].id, type: "name", page: 0, x: 60, y: 130, width: 180, height: 24, required: true },
    { id: randomUUID(), documentId: agreement.id, recipientId: parallelRecipients[0].id, type: "text", page: 0, x: 60, y: 95, width: 240, height: 24, required: true },
    { id: randomUUID(), documentId: agreement.id, recipientId: parallelRecipients[0].id, type: "checkbox", page: 0, x: 60, y: 60, width: 20, height: 20, required: true },
    { id: randomUUID(), documentId: agreement.id, recipientId: parallelRecipients[0].id, type: "date", page: 0, x: 90, y: 60, width: 130, height: 24, required: true },
  ];
  for (const document of parallelEnvelope.documents.slice(1)) {
    averyFields.push(
      { id: randomUUID(), documentId: document.id, recipientId: parallelRecipients[0].id, type: "signature", page: 0, x: 60, y: 220, width: 160, height: 40, required: true },
    { id: randomUUID(), documentId: document.id, recipientId: parallelRecipients[0].id, type: "date", page: 0, x: 90, y: 60, width: 130, height: 24, required: true },
    );
  }
  averyFields.push({ id: randomUUID(), documentId: agreement.id, recipientId: parallelRecipients[1].id, type: "signature", page: 0, x: 330, y: 220, width: 160, height: 40, required: true },
    { id: randomUUID(), documentId: agreement.id, recipientId: parallelRecipients[1].id, type: "date", page: 0, x: 360, y: 220, width: 130, height: 24, required: true });
  await saveDraft(sender, parallelEnvelope, "QA browser parallel draft", "parallel", parallelRecipients, averyFields);
  }
  let sequentialEnvelope: Awaited<ReturnType<typeof addDocuments>> | undefined;
  if (!sequentialEnvelope) {
    sequentialEnvelope = await addDocuments(sender, "QA browser sequential draft", portrait, rotated, undefined as any);
    const recipients = [
      { id: randomUUID(), name: "Avery Morgan", email: "avery@client.test", order: 1, accessCode: "Avery-code-123" },
      { id: randomUUID(), name: "Jordan Lee", email: "jordan@client.test", order: 2 },
    ];
    await saveDraft(sender, sequentialEnvelope, "QA browser sequential draft", "sequential", recipients, await twoFields(sequentialEnvelope, recipients));
  }
  const freshSent = new Map<string, string>();
  for (const title of ["QA browser decline", "QA browser void", "QA browser expired", "QA browser link regeneration"]) {
    const envelope = await addDocuments(sender, title, portrait, rotated, undefined as any);
    const recipients = [
      { id: randomUUID(), name: "Avery Morgan", email: "avery@client.test", order: 1 },
      { id: randomUUID(), name: "Jordan Lee", email: "jordan@client.test", order: 2 },
    ];
    const fields = await twoFields(envelope, recipients);
    const saved = await saveDraft(sender, envelope, title, "parallel", recipients, fields);
    if (title === "QA browser expired") {
      await getPool().query("UPDATE envelopes SET state='sent',sent_at=now()-interval '2 days',expires_at=now()-interval '1 hour' WHERE id=$1", [saved.id]);
    } else {
      await workflow.sendEnvelope(sender, saved.id, { version: saved.version, confirmed: true, expiresInDays: 7 });
    }
    freshSent.set(title, saved.id);
  }
  const envelopes = await Promise.all([
    "QA browser parallel draft",
    "QA browser sequential draft",
    "QA browser decline",
    "QA browser void",
    "QA browser expired",
  ].map(async title => {
    const id = title === "QA browser parallel draft" ? parallelEnvelope.id : title === "QA browser sequential draft" ? sequentialEnvelope.id : freshSent.get(title);
    if (!id) throw new Error(`QA fixture was not created: ${title}`);
    return envelopeJson(sender, id);
  }));
  const finalTemplate = (await getPool().query("SELECT id,name FROM templates WHERE company_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [qaCompanyId])).rows[0];
  return {
    message: "Synthetic QA fixtures ensured. No email sent.",
    accounts: await accountsJson(qaCompanyId, rivalCompanyId),
    password: PASSWORD,
    template: finalTemplate ? { id: finalTemplate.id, name: finalTemplate.name } : null,
    envelopes,
  };
}

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.TEAM_ESIGN_DEV_DATABASE !== "1") {
    console.error("QA seed refused: set TEAM_ESIGN_DEV_DATABASE=1 only for an isolated development database.");
    process.exit(1);
  }
  try { console.log(JSON.stringify(await run())); }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
  finally { await getPool().end().catch(() => undefined); }
}
if (process.argv[1]?.endsWith("qa-seed.ts")) void main();
