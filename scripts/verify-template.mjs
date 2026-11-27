// Built production image + disposable PostgreSQL. No delivered accounts, files or provider calls.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import pg from 'pg';

const exec = promisify(execFile);
const COMPANY = 'aaca0000-0000-4000-8000-000000000001';
async function main() {
  const image = process.env.NEANDER_TEMPLATE_IMAGE, databaseUrl = process.env.NEANDER_TEMPLATE_TEST_DATABASE_URL, password = process.env.DEMO_PASSWORD;
  assert.ok(image && databaseUrl && password, 'Use a built image and an explicitly disposable PostgreSQL database');
  assert.equal(process.env.DATABASE_URL, databaseUrl);
  const origin = new URL(process.env.BETTER_AUTH_URL);
  assert.ok(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname));
  const name = `accord-check-${randomUUID().slice(0, 12)}`, directory = await mkdtemp(join(tmpdir(), 'accord-check-'));
  const bundle = join(directory, 'neander_environment'), runtimeDatabase = new URL(databaseUrl);
  if (process.platform === 'darwin' && ['127.0.0.1', 'localhost'].includes(runtimeDatabase.hostname)) runtimeDatabase.hostname = 'host.docker.internal';
  const environment = { DATABASE_URL: runtimeDatabase.href, BETTER_AUTH_URL: origin.origin, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, COMPANY_SETUP_KEY: process.env.COMPANY_SETUP_KEY, DEMO_PASSWORD: password };
  await writeFile(bundle, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o644 });
  const db = new pg.Client({ connectionString: databaseUrl });
  let browser, connected = false;
  async function ready() {
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch(`${origin.origin}/api/health`)).ok) return; } catch {}
      await delay(500);
    }
    throw new Error('Accord production image did not become ready');
  }
  async function json(response, status = 200) { assert.equal(response.status(), status, await response.text()); return response.json(); }
  try {
    const networking = process.platform === 'linux' ? ['--network', 'host', '--env', `PORT=${origin.port || 80}`] : ['--publish', `127.0.0.1:${origin.port || 80}:8080`];
    await exec('docker', ['run', '--detach', '--name', name, '--mount', `type=bind,src=${bundle},dst=/run/secrets/neander_environment,readonly`, ...networking, image], { timeout: 60000 });
    await ready(); await db.connect(); connected = true;
    const beforeHash = (await db.query('SELECT password FROM account a JOIN "user" u ON u.id=a.user_id WHERE u.email=$1', ['admin@accord.test'])).rows[0].password;
    await exec('pnpm', ['db:seed'], { timeout: 60000 });
    assert.equal((await db.query('SELECT password FROM account a JOIN "user" u ON u.id=a.user_id WHERE u.email=$1', ['admin@accord.test'])).rows[0].password, beforeHash);
    await exec('pnpm', ['exec', 'playwright', 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } }), page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(`${origin.origin}/login`); assert.match(await page.title(), /Accord/);
    await page.getByLabel('Email address', { exact: true }).fill('admin@accord.test');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Studio services agreement', exact: false }).first().waitFor();
    const workspace = await json(await context.request.get(`${origin.origin}/api/workspace`));
    assert.equal(workspace.company.id, COMPANY); assert.equal(workspace.role, 'admin'); assert.equal(workspace.envelopes.length, 3);
    const archived = workspace.envelopes.find(envelope => envelope.archived_at), draft = workspace.envelopes.find(envelope => envelope.title === 'Studio services agreement');
    assert.ok(archived && draft); assert.equal(draft.document_count, 2);
    const capture = process.env.ACCORD_CAPTURE_DIRECTORY;
    if (capture) { await mkdir(join(capture, 'screenshots'), { recursive: true }); await page.screenshot({ path: join(capture, 'thumbnail.png') }); }
    await page.getByRole('combobox', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'Archived envelopes', exact: true }).click();
    await page.getByRole('link', { name: archived.title, exact: false }).first().waitFor();
    assert.equal(await page.getByRole('link', { name: 'Studio services agreement', exact: false }).count(), 0);
    const exportLink = await page.getByRole('link', { name: 'Export CSV', exact: false }).getAttribute('href');
    assert.equal(new URL(exportLink, origin).searchParams.get('visibility'), 'archived');
    const exported = await context.request.get(new URL(exportLink, origin).href);
    assert.equal(exported.status(), 200); const csv = await exported.text();
    assert.ok(csv.includes(archived.title) && !csv.includes(draft.title)); assert.equal(csv.split('\r\n').length, 2);
    if (capture) await page.screenshot({ path: join(capture, 'screenshots/archived.png') });
    const envelope = await json(await context.request.get(`${origin.origin}/api/envelopes/${draft.id}`));
    const document = envelope.documents[0];
    const pdf = await context.request.get(`${origin.origin}/api/envelopes/${draft.id}/documents?file=${document.id}`);
    assert.equal(pdf.status(), 200); const bytes = await pdf.body(); assert.ok(bytes.subarray(0, 5).toString() === '%PDF-');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), document.sha256);
    await page.goto(`${origin.origin}/envelopes/${draft.id}`);
    await page.getByRole('heading', { name: 'Studio services agreement', exact: true }).waitFor();
    await page.locator('canvas').first().waitFor();
    await page.waitForFunction(() => { const canvas = document.querySelector('.pdf-frame canvas'); return canvas && canvas.width > 500 && canvas.height > 500 && !document.querySelector('.pdf-loading'); });
    assert.equal(await page.locator('.pdf-frame [role=alert]').count(), 0);
    assert.ok(await page.locator('.pdf-frame canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0; for (let index = 0; index < pixels.length; index += 16) if (pixels[index] < 230 && pixels[index + 1] < 230 && pixels[index + 2] < 230 && pixels[index + 3] > 0) ink++;
      return ink > 10;
    }), 'The PDF must contain rendered document content');
    if (capture) await page.screenshot({ path: join(capture, 'screenshots/agreement.png') });
    const contacts = await json(await context.request.get(`${origin.origin}/api/manage/contacts`)); assert.equal(contacts.length, 2);
    const contact = contacts[0], editedName = `Template edit ${randomUUID().slice(0, 8)}`;
    await json(await context.request.post(`${origin.origin}/api/manage/contacts`, { headers: { origin: origin.origin }, data: { id: contact.id, name: editedName, email: contact.email } }));
    await exec('pnpm', ['db:seed'], { timeout: 60000 });
    await exec('docker', ['restart', name], { timeout: 60000 }); await ready();
    const after = await json(await context.request.get(`${origin.origin}/api/manage/contacts`)); assert.equal(after.find(item => item.id === contact.id).name, editedName);
    assert.equal((await fetch(`${origin.origin}/api/envelopes?visibility=archived`)).status, 401);
    for (const [email, role] of [['sender@accord.test', 'sender'], ['viewer@accord.test', 'read-only']]) {
      const isolated = await browser.newContext();
      await json(await isolated.request.post(`${origin.origin}/api/auth/sign-in/email`, { headers: { origin: origin.origin }, data: { email, password } }));
      assert.equal((await json(await isolated.request.get(`${origin.origin}/api/workspace`))).role, role);
      assert.equal((await isolated.request.get(`${origin.origin}/api/manage/settings`)).status(), 403);
      if (role === 'read-only') assert.equal((await isolated.request.post(`${origin.origin}/api/envelopes`, { headers: { origin: origin.origin }, data: { title: 'Forbidden viewer write' } })).status(), 403);
      await isolated.close();
    }
    console.log('PASS: production image, browser login, fictional PDFs, archived UI/CSV, roles, repeat seed preservation and edit persistence after restart');
  } finally {
    await browser?.close(); if (connected) await db.end();
    try { await exec('docker', ['rm', '--force', name], { timeout: 30000 }); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
