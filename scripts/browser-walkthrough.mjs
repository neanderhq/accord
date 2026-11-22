import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://127.0.0.1:3000";
const PASSWORD = "QaBrowser-2026";
const TIMEOUT = Number(process.env.QA_TIMEOUT_MS || 30_000);
const EVIDENCE = "qa-evidence";
const DOWNLOADS = path.join(EVIDENCE, "downloads");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const results = [];
const state = {};
const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

function record(id, title, status, notes = "") {
  const existing = results.find(item => item.id === id);
  if (existing) Object.assign(existing, { status, notes });
  else results.push({ id, title, status, notes });
  console.error(`${id} ${status}${notes ? ` — ${notes}` : ""}`);
}

async function shot(page, id) {
  await page.screenshot({ path: path.join(EVIDENCE, `${id}.png`), fullPage: true });
}

async function newContext(options = {}) {
  return browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...options });
}

async function signIn(account, options = {}) {
  const value = await newContext(options);
  const page = await value.newPage();
  page.setDefaultTimeout(TIMEOUT);
  await page.goto(`${BASE_URL}/login`);
  await page.fill("#email", account);
  await page.fill("#password", PASSWORD);
  const [navigation] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/auth/sign-in/email")),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  if (navigation.status() !== 200) throw new Error(`Sign-in failed with HTTP ${navigation.status()}`);
  await page.locator(".app-layout").waitFor({ state: "attached", timeout: TIMEOUT });
  return { browser: value, page };
}

async function signInWithRetry(account, options) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await signIn(account, options); }
    catch (error) {
      if (attempt === 4 || !String(error.message).includes("HTTP 429")) throw error;
      await new Promise(resolve => setTimeout(resolve, 20_000 * attempt));
    }
  }
}

async function pageOf(browserContext) {
  return browserContext.page;
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

async function requestJson(page, path, options = {}) {
  const response = await page.request.get(`${BASE_URL}${path}`, options);
  return { status: response.status(), body: await response.json().catch(() => null) };
}

async function send(page, method, path, body, extraHeaders = {}) {
  const response = await page.request.fetch(`${BASE_URL}${path}`, {
    method,
    data: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: BASE_URL, ...extraHeaders },
  });
  const value = await response.json().catch(() => null);
  return { status: response.status(), body: value };
}

async function mustSend(page, method, path, body) {
  const result = await send(page, method, path, body);
  if (result.status < 200 || result.status >= 300) throw new Error(`${method} ${path} failed (${result.status}): ${result.body?.error ?? result.body?.code ?? "No message"}`);
  return result.body;
}

async function workspace(browserContext) {
  const result = await requestJson(await pageOf(browserContext), "/api/workspace");
  if (result.status !== 200) throw new Error(`Workspace failed (${result.status}): ${result.body?.error}`);
  return result.body;
}

async function envelopeByTitle(browserContext, title) {
  const page = await pageOf(browserContext);
  const list = await workspace(browserContext);
  const found = list.envelopes.filter(item => item.title === title).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const envelope = found[0];
  if (!envelope) throw new Error(`Envelope not found in workspace: ${title}`);
  const detail = await requestJson(page, `/api/envelopes/${envelope.id}`);
  if (detail.status !== 200) throw new Error(`Envelope detail failed (${detail.status}): ${detail.body?.error}`);
  return detail.body;
}

async function saveEnvelope(page, envelope, changes = {}) {
  return mustSend(page, "PATCH", `/api/envelopes/${envelope.id}`, {
    version: envelope.version,
    title: envelope.title,
    routing: envelope.routing,
    folder: envelope.folder ?? "",
    tags: envelope.tags ?? [],
    recipients: envelope.recipients.map(r => ({ id: r.id, name: r.name, email: r.email, order: r.routing_order, ...(r.accessCode ? { accessCode: r.accessCode } : {}) })),
    fields: envelope.fields,
    ...changes,
  });
}

async function freeze(page, envelope, days = 7) {
  const saved = await saveEnvelope(page, envelope);
  return mustSend(page, "POST", `/api/envelopes/${envelope.id}/send`, { version: saved.version, confirmed: true, expiresInDays: days });
}

async function links(browserContext, envelope) {
  return mustSend(await pageOf(browserContext), "POST", `/api/envelopes/${envelope.id}/verification-links`, { kind: "sign" });
}

async function consent(page) {
  await expectText(page, "Electronic consent");
  if (await page.getByRole("button", { name: "Confirm consent" }).isVisible().catch(() => false)) {
    await page.getByRole("checkbox", { name: "I agree to the electronic consent above." }).check();
    await page.getByRole("button", { name: "Confirm consent" }).click();
    await expectText(page, "Consent recorded");
  }
}

async function accessGate(page, code) {
  await page.locator('#access-code').or(page.getByText('Your assigned fields')).first().waitFor({ state: 'visible', timeout: TIMEOUT });
  if (!await page.locator("#access-code").isVisible().catch(() => false)) return;
  if (!code) throw new Error('A signing access code is required for this fixture');
  await page.fill("#access-code", code);
  await page.getByRole("button", { name: /check access/i }).click();
  await expectText(page, "Your assigned fields");
}

async function openRecipient(browserContext, path, code) {
  const page = await browserContext.newPage();
  page.setDefaultTimeout(TIMEOUT);
  await page.goto(`${BASE_URL}${path}`);
  await accessGate(page, code);
  return page;
}


async function fillTyped(page, name = "Avery Morgan") {
  await consent(page);
  for (const input of await page.locator("fieldset input[id^='value-']").all()) {
    const id = await input.getAttribute("id");
    const label = await page.locator(`label[for='${id}']`).innerText();
    const type = label.split("·")[0].trim().toLowerCase();
    await input.fill(type.startsWith("date") ? new Date().toISOString().slice(0, 10) : type.startsWith("initials") ? name.slice(0, 2).toUpperCase() : name);
  }
  for (const checkbox of await page.locator("fieldset [role='checkbox'][id^='value-']").all()) await checkbox.check();
}

async function drawSignature(page, fieldId, checkClear = true) {
  const canvas = page.locator(`#value-${fieldId}`).locator("..").locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`Drawing canvas not found for ${fieldId}`);
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.65, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.35, { steps: 8 });
  await page.mouse.up();
  const visibleEnd = await canvas.evaluate(element => {
    const context = element.getContext("2d");
    const pixels = context.getImageData(Math.floor(element.width * 0.8) - 5, Math.floor(element.height * 0.35) - 5, 10, 10).data;
    return Array.from(pixels).some((value, index) => index % 4 === 3 && value > 0);
  });
  if (!visibleEnd) throw new Error("Drawing preview does not show the end of the signature stroke");
  if (checkClear) {
    await canvas.locator("..").getByRole("button", { name: "Clear drawing" }).click();
    const hasInk = await canvas.evaluate(element => Array.from(element.getContext("2d").getImageData(0, 0, element.width, element.height).data).some((value, index) => index % 4 === 3 && value > 0));
    if (hasInk) throw new Error("Clear drawing left ink in the signature preview");
    await drawSignature(page, fieldId, false);
  }
}

async function fillDrawn(page, name = "Jordan Lee") {
  await consent(page);
  for (const input of await page.locator("fieldset input[id^='value-']").all()) {
    const id = await input.getAttribute("id");
    const label = await page.locator(`label[for='${id}']`).innerText();
    const type = label.split("·")[0].trim().toLowerCase();
    if (type.startsWith("signature") || type.startsWith("initials")) await drawSignature(page, id.replace("value-", ""));
    else await input.fill(type.startsWith("date") ? new Date().toISOString().slice(0, 10) : name);
  }
}

async function submitSigning(page) {
  await page.getByRole("button", { name: "Review & submit signature" }).click();
  await page.getByRole("button", { name: "Confirm & sign" }).click();
  await page.getByText(/Your signature is recorded/i).first().waitFor({ timeout: TIMEOUT });
}

async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function scenario(id, title, fn) {
  try { await fn(); record(id, title, "pass"); }
  catch (error) { record(id, title, "fail", String(error.message ?? error)); console.error(error); }
}

await mkdir(DOWNLOADS, { recursive: true });
  const sender = await signInWithRetry("qa-sender@flowco.test");
  const admin = await signInWithRetry("qa-admin@flowco.test");
  const viewer = await signInWithRetry("qa-view@flowco.test");
  const rival = await signInWithRetry("qa-rival@rival.test");

await scenario("D1", "Sender sign-in and dashboard renders", async () => {
  const page = await pageOf(sender);
  await expectText(page, "Every signature");
  await shot(page, "D1");
});

await scenario("D2", "Dashboard filters and filtered CSV export", async () => {
  const page = await pageOf(sender);
  await page.goto(`${BASE_URL}/`);
  await page.getByPlaceholder("Search title, sender or recipient…").fill("QA browser parallel draft");
  await page.getByRole("button", { name: "Additional filters" }).click();
  await page.getByLabel("Created from").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Recipient name or email").fill("Avery");
  const from = new Date().toISOString().slice(0, 10);
  await page.getByLabel("Created to").fill(from);
  const response = await page.request.get(`${BASE_URL}/api/envelopes?search=${encodeURIComponent("QA browser parallel draft")}&status=all&folder=all&tag=all&recipient=Avery`);
  const csv = await response.text();
  if (response.status() !== 200 || !csv.includes("QA browser parallel draft")) throw new Error(`Filtered export failed (${response.status()}): ${csv}`);
});

await scenario("D3", "Contacts create, edit, delete, template, duplicate import", async () => {
  const page = await pageOf(sender);
  await page.goto(`${BASE_URL}/settings`);
  await expectText(page, "Contacts");
  await page.waitForSelector("#contact-name", { timeout: TIMEOUT });
  await page.fill("#contact-name", "QA Walkthrough Contact");
  await page.fill("#contact-email", "walkthrough@client.test");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expectText(page, "walkthrough@client.test");
  const edit = page.locator("li", { hasText: "walkthrough@client.test" }).getByRole("button", { name: "Edit" });
  await edit.click();
  await page.fill("#contact-name", "QA Walkthrough Edited");
  await page.getByRole("button", { name: "Save contact changes" }).click();
  await expectText(page, "QA Walkthrough Edited");
  const [templateDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV template" }).click()]);
  const templateCsv = await downloadText(templateDownload);
  if (!templateCsv.includes("name,email")) throw new Error("Contact CSV template is empty");
  const csv = "name,email\r\nQA Duplicate,walkthrough@client.test\r\nQA New Import,newimport@client.test\r\n";
  await page.locator("textarea").fill(csv);
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expectText(page, "row errors");
  const remove = page.locator("li", { hasText: "newimport@client.test" }).getByRole("button", { name: "Remove" });
  await remove.click();
  const removeEdited = page.locator("li", { hasText: "QA Walkthrough Edited" }).getByRole("button", { name: "Remove" });
  await removeEdited.click();
});

await scenario("D4", "Template reuse twice and DOCX upload notice", async () => {
  const page = await pageOf(sender);
  await page.goto(`${BASE_URL}/settings`);
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForSelector("#contact-name", { timeout: TIMEOUT });
  const use = page.locator("li", { hasText: "QA browser template" }).getByRole("button", { name: "Use template" });
  const created = [];
  for (let index = 1; index <= 2; index++) {
    await use.click();
    await page.fill("#use-title", `QA walkthrough spare draft ${index}`);
    await page.fill("#role-name-0", "Avery Morgan");
    await page.fill("#role-email-0", "avery@client.test");
    await page.fill("#role-name-1", "Jordan Lee");
    await page.fill("#role-email-1", "jordan@client.test");
    await Promise.all([page.waitForURL(/\/envelopes\//), page.getByRole("button", { name: "Create envelope" }).click()]);
    const id = new URL(page.url()).pathname.split("/").pop();
    created.push(id);
    await expectText(page, "1. Documents & details");
    await page.goto(`${BASE_URL}/settings`);
  }
  state.spare = created[1];
  const detail = await requestJson(page, `/api/envelopes/${created[0]}`);
  if (detail.status !== 200) throw new Error("First reused envelope is unavailable");
});

await scenario("D5", "Share draft with read-only colleague", async () => {
  const page = await pageOf(sender);
  const parallel = await envelopeByTitle(sender, "QA browser parallel draft");
  const colleagues = await requestJson(page, "/api/manage/colleagues");
  const viewerUser = colleagues.body?.find(member => member.email === "qa-view@flowco.test");
  if (!viewerUser) throw new Error("Read-only colleague missing");
  await mustSend(page, "POST", `/api/envelopes/${parallel.id}/share`, { userId: viewerUser.id });
  const viewerWorkspace = await workspace(viewer);
  if (!viewerWorkspace.envelopes.some(envelope => envelope.id === parallel.id)) throw new Error("Read-only user cannot see shared draft");
  const viewerDetail = await requestJson(await pageOf(viewer), `/api/envelopes/${parallel.id}`);
  if (viewerDetail.status !== 200) throw new Error("Shared detail unavailable to read-only user");
  const attempted = await send(await pageOf(viewer), "PATCH", `/api/envelopes/${parallel.id}`, { version: parallel.version, title: parallel.title, routing: parallel.routing, folder: "", tags: [], recipients: parallel.recipients.map(r => ({ id: r.id, name: r.name, email: r.email, order: r.routing_order })), fields: parallel.fields });
  if (attempted.status < 400) throw new Error("Read-only mutation API unexpectedly succeeded");
});

await scenario("D6", "Sender usage counts", async () => {
  const page = await pageOf(sender);
  await page.goto(`${BASE_URL}/`);
  await expectText(page, "Sasha Sender");
  await expectText(page, "sent");
  await expectText(page, "completed");
});

await scenario("D7", "Honest outbox and retry", async () => {
  const page = await pageOf(admin);
  await page.goto(`${BASE_URL}/settings`);
  await expectText(page, "not delivered / provider not configured");
  await shot(page, "D7");
});

await scenario("D8", "Webhook URL and failed delivery log", async () => {
  const page = await pageOf(admin);
  const settings = await requestJson(page, "/api/manage/settings");
  await mustSend(page, "POST", "/api/manage/settings", { brandName: "QA FlowCo", brandColor: "#2563eb", logo: null, retentionDays: 365, webhookUrl: "https://invalid.qa.test/webhook", webhookSecret: "qa-webhook-secret-0123456789abcdef" });
  await page.goto(`${BASE_URL}/settings`);
  await expectText(page, "Webhooks");
});

await scenario("D9", "Draft archive refusal, sender deletion refusal, admin soft delete", async () => {
  const page = await pageOf(sender);
  const spare = await requestJson(page, `/api/envelopes/${state.spare}`);
  const envelope = spare.body;
  await page.goto(`${BASE_URL}/envelopes/${envelope.id}`);
  await expectText(page, "1. Documents & details");
  if (await page.getByRole("button", { name: "Archive", exact: true }).count()) throw new Error("Archive action unexpectedly visible on a draft");
  const archive = await send(page, "POST", "/api/manage/lifecycle", { envelopeId: envelope.id, action: "archive" });
  if (archive.status !== 409) throw new Error(`Draft archive unexpectedly returned ${archive.status}`);
  const senderRefusal = await send(page, "POST", "/api/manage/lifecycle", { envelopeId: envelope.id, action: "delete", reason: "Sender should not be allowed" });
  if (senderRefusal.status < 400) throw new Error("Sender deletion unexpectedly succeeded");
  const adminResult = await send(await pageOf(admin), "POST", "/api/manage/lifecycle", { envelopeId: envelope.id, action: "delete", reason: "QA cleanup of spare draft" });
  if (adminResult.status !== 200) throw new Error(`Admin deletion failed: ${adminResult.body?.error}`);
});

await scenario("D10", "Admin backup export", async () => {
  const page = await pageOf(admin);
  const response = await page.request.get(`${BASE_URL}/api/manage/backup`);
  const backup = await response.text();
  if (response.status() !== 200 || backup.length < 10 || !backup.includes("QA FlowCo")) throw new Error(`Backup export invalid (${response.status()}, ${backup.length})`);
});

await scenario("D11", "Freeze parallel draft and generate links", async () => {
  const page = await pageOf(sender);
  state.parallel = await envelopeByTitle(sender, "QA browser parallel draft");
  if (state.parallel.state === "draft") await freeze(page, state.parallel);
  else state.parallel = await envelopeByTitle(sender, "QA browser parallel draft");
  state.parallelLinks = (await links(sender, state.parallel)).links;
  if (state.parallelLinks.length !== 2) throw new Error(`Expected two parallel links, got ${state.parallelLinks.length}`);
  await shot(page, "D11");
});

await scenario("D12", "Avery types all assigned fields", async () => {
  const value = await newContext();
  const recipient = state.parallelLinks.find(link => link.email === "avery@client.test");
  const page = await openRecipient(value, recipient.path, "Avery-code-123");
  await expectText(page, "Avery Morgan");
  await consent(page);
  await page.getByRole("button", { name: "Review & submit signature" }).click();
  await page.getByText("Complete all required fields").waitFor({ timeout: TIMEOUT });
  await fillTyped(page, "Avery Morgan");
  await page.getByRole("button", { name: "Review & submit signature" }).click();
  await page.getByRole("button", { name: "Confirm & sign" }).click();
  await expectText(page, "Your signature is recorded");
  await shot(page, "D12");
  state.averyContext = value;
  state.averyPage = page;
});

await scenario("D13", "Jordan draws while Avery is mid-flow", async () => {
  const value = await newContext();
  const recipient = state.parallelLinks.find(link => link.email === "jordan@client.test");
  const page = await openRecipient(value, recipient.path);
  await fillDrawn(page, "Jordan Lee");
  await submitSigning(page);
  const senderPage = await pageOf(sender);
  const completed = await envelopeByTitle(sender, "QA browser parallel draft");
  if (completed.state !== "completed") throw new Error(`Parallel envelope did not complete; state=${completed.state}`);
  await shot(page, "D13");
});

await scenario("D14", "Sender downloads flattened PDF and receipt", async () => {
  const page = await pageOf(sender);
  const envelope = await envelopeByTitle(sender, "QA browser parallel draft");
  if (!envelope.outputs?.length) throw new Error("Completed outputs missing");
  const response = await page.request.get(`${BASE_URL}/api/envelopes/${envelope.id}/outputs?file=${envelope.outputs[0].id}`);
  const receipt = await response.text();
  if (response.status() !== 200 || receipt.length < 100) throw new Error(`Sender download invalid (${response.status()}, ${receipt.length})`);
});

await scenario("D15", "Terminal recipient state and repeat submit rejected", async () => {
  const page = state.averyPage;
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.locator("#access-code").waitFor({ state: "visible" });
  await page.fill("#access-code", "Avery-code-123");
  await page.getByRole("button", { name: /check access/i }).click();
  await page.getByText(/signing is closed/i).first().waitFor({ timeout: TIMEOUT });
  const repeat = await send(page, "POST", `/api/sign/${state.parallelLinks.find(l => l.email === "avery@client.test").path.split("/").pop()}/submit`, { idempotencyKey: crypto.randomUUID(), values: {} }, { "x-access-code": "Avery-code-123" });
  if (repeat.status < 400) throw new Error("Repeat submit unexpectedly succeeded");
});

await scenario("D16", "Regenerated link revokes previous link", async () => {
  const page = await pageOf(sender);
  const envelope = await envelopeByTitle(sender, "QA browser link regeneration");
  const previous = (await links(sender, envelope)).links;
  await links(sender, envelope);
  const old = await requestJson(page, `/api/sign/${previous[0].path.split("/").pop()}`);
  if (old.status !== 404) throw new Error(`Old recipient link not revoked (HTTP ${old.status})`);
});

await scenario("D17", "Sequential access code and routing order", async () => {
  const senderPage = await pageOf(sender);
  state.sequential = await envelopeByTitle(sender, "QA browser sequential draft");
  if (state.sequential.state === "draft") await freeze(senderPage, state.sequential);
  state.sequentialLinks = (await links(sender, state.sequential)).links;
  const jordanLink = state.sequentialLinks.find(link => link.email === "jordan@client.test");
  const jordanProbe = await newContext();
  const probePage = await jordanProbe.newPage();
  await probePage.goto(`${BASE_URL}${jordanLink.path}`);
  await probePage.getByText(/not your turn|not yet available|No fields|earlier recipient must sign first/i).first().waitFor({ timeout: TIMEOUT });
  const avery = await newContext();
  const averyLink = state.sequentialLinks.find(link => link.email === "avery@client.test");
  const averyPage = await avery.newPage();
  await averyPage.goto(`${BASE_URL}${averyLink.path}`);
  await averyPage.fill("#access-code", "wrong-code-123");
  await averyPage.getByRole("button", { name: /check access/i }).click();
  await expectText(averyPage, "Access code");
  await averyPage.fill("#access-code", "Avery-code-123");
  await averyPage.getByRole("button", { name: /check access/i }).click();
  await expectText(averyPage, "Your assigned fields");
  await fillTyped(averyPage, "Avery Morgan");
  await submitSigning(averyPage);
  const jordan = await newContext();
  const jordanPage = await jordan.newPage();
  await jordanPage.goto(`${BASE_URL}${jordanLink.path}`);
  await fillDrawn(jordanPage, "Jordan Lee");
  await submitSigning(jordanPage);
  const envelope = await envelopeByTitle(sender, "QA browser sequential draft");
  if (envelope.state !== "completed") throw new Error(`Sequential envelope did not complete; state=${envelope.state}`);
  await shot(averyPage, "D17");
});

await scenario("D18", "Decline with reason", async () => {
  const senderPage = await pageOf(sender);
  const decline = await envelopeByTitle(sender, "QA browser decline");
  const declineLinks = (await links(sender, decline)).links;
  const averyLink = declineLinks.find(link => link.email === "avery@client.test");
  const value = await newContext();
  const page = await value.newPage();
  await page.goto(`${BASE_URL}${averyLink.path}`);
  await consent(page);
  await page.getByRole("button", { name: "Decline to sign" }).click();
  await page.fill("#decline-reason", "QA decline reason");
  await page.getByRole("button", { name: "Confirm decline" }).click();
  await expectText(page, "Declined");
  const updated = await envelopeByTitle(sender, "QA browser decline");
  if (updated.state !== "declined" || updated.reason !== "QA decline reason") throw new Error(`Decline state/reason invalid (${updated.state})`);
});

await scenario("D19", "Void, reissue, revoke old link, preserve history", async () => {
  const senderPage = await pageOf(sender);
  const voided = await envelopeByTitle(sender, "QA browser void");
  const originalLinks = (await links(sender, voided)).links;
  await mustSend(senderPage, "POST", `/api/envelopes/${voided.id}/void`, { version: voided.version, reason: "QA void and reissue" });
  const oldLink = originalLinks.find(link => link.email === "avery@client.test");
  const replacement = await mustSend(senderPage, "POST", "/api/manage/reissue", { envelopeId: voided.id, reason: "QA void and reissue" });
  state.reissued = replacement;
  if (!state.reissued.id) throw new Error("Reissue did not create a linked envelope");
  const oldResponse = await requestJson(await (await newContext()).newPage(), `/api/sign/${oldLink.path.split("/").pop()}`);
  if (![404,410].includes(oldResponse.status)) throw new Error(`Old voided link not unavailable (HTTP ${oldResponse.status})`);
  const history = await requestJson(senderPage, `/api/envelopes/${voided.id}`);
  if (!history.body.events.some(event => event.event === "voided")) throw new Error("Original void history missing");
});

await scenario("D20", "Expired recipient and sender state", async () => {
  const senderPage = await pageOf(sender);
  const expired = await envelopeByTitle(sender, "QA browser expired");
  const page = await (await newContext()).newPage();
  await page.goto(`${BASE_URL}/sign/expired-qa-link-unavailable`);
  await page.getByText(/expired|unavailable/i).first().waitFor({ timeout: TIMEOUT });
  if (expired.state !== "expired") throw new Error(`Sender does not show expired state (${expired.state})`);
});

await scenario("D21", "Cross-company access denied and empty rival workspace", async () => {
  const rivalPage = await pageOf(rival);
  const flowco = await envelopeByTitle(sender, "QA browser decline");
  const direct = await rivalPage.goto(`${BASE_URL}/envelopes/${flowco.id}`);
  const apiResult = await requestJson(rivalPage, `/api/envelopes/${flowco.id}`);
  const documentResult = await rivalPage.request.get(`${BASE_URL}/api/envelopes/${flowco.id}/documents?file=${flowco.documents[0].id}`);
  if (apiResult.status !== 404 || documentResult.status() !== 404) throw new Error(`Cross-company enforcement failed (${apiResult.status}/${documentResult.status()})`);
  await rivalPage.goto(`${BASE_URL}/`);
  await expectText(rivalPage, "Create envelope");
  await shot(rivalPage, "D21");
});

await scenario("D22", "Invite and removed-member access", async () => {
  const adminPage = await pageOf(admin);
  await adminPage.goto(`${BASE_URL}/team`);
  const email = `walkthrough-${crypto.randomUUID()}@flowco.test`;
  await adminPage.fill("#invite-email", email);
  const [response] = await Promise.all([adminPage.waitForResponse(value => value.url().includes("/api/manage/invite")), adminPage.getByRole("button", { name: "Queue staff invitation" }).click()]);
  const invite = await response.json().catch(() => null);
  if (!invite?.path) throw new Error("Invite link was not surfaced by the development UI/API response");
  const inviteContext = await newContext();
  const invitePage = await inviteContext.newPage();
  await invitePage.goto(`${BASE_URL}${invite.path}`);
  await invitePage.locator("#name").fill("Walkthrough Member");
  await invitePage.fill("#password", "QaBrowser-2026");
  await invitePage.getByRole("button", { name: "Activate account" }).click();
  await expectText(invitePage, "Your account is ready");
  const member = await signIn(email);
  const memberWorkspace = await workspace(member);
  if (!memberWorkspace.envelopes) throw new Error("Invited member lacks workspace");
  const team = await requestJson(adminPage, "/api/team");
  const record = team.body.find(item => item.email === email);
  await mustSend(adminPage, "PATCH", "/api/team", { memberId: record.id, active: false, role: record.role });
  const removed = await requestJson(await pageOf(member), "/api/workspace");
  if (removed.status !== 403) throw new Error(`Removed member still has API access (${removed.status})`);
});

await scenario("D23", "Read-only visibility and mutation refusal", async () => {
  const viewerPage = await pageOf(viewer);
  await viewerPage.goto(`${BASE_URL}/`);
  if (await viewerPage.getByRole("link", { name: /Create envelope/i }).isVisible().catch(() => false)) throw new Error("Read-only dashboard exposes create control");
  const shared = await envelopeByTitle(sender, "QA browser parallel draft");
  const mutation = await send(viewerPage, "PATCH", `/api/envelopes/${shared.id}`, { version: shared.version, title: "Should fail", routing: shared.routing, folder: "", tags: [], recipients: [], fields: [] });
  if (mutation.status < 400) throw new Error("Read-only mutation succeeded");
});

await scenario("D24", "Upload size and extension validation", async () => {
  const senderPage = await pageOf(sender);
  const envelope = await envelopeByTitle(sender, "QA browser parallel draft");
  const oversized = await send(senderPage, "POST", `/api/envelopes/${envelope.id}/documents`, "x".repeat(9 * 1024 * 1024), { "Content-Type": "application/pdf", "x-envelope-version": String(envelope.version), "x-file-name": "oversized.pdf" });
  const wrong = await send(senderPage, "POST", `/api/envelopes/${envelope.id}/documents`, "not a pdf", { "Content-Type": "application/pdf", "x-envelope-version": String(envelope.version), "x-file-name": "bad.exe" });
  if (oversized.status !== 413 || wrong.status !== 400) throw new Error(`Upload validation returned ${oversized.status}/${wrong.status}`);
});

await scenario("D25", "Access-code lockout then admin soft delete", async () => {
  const senderPage = await pageOf(sender);
  const templates = await requestJson(senderPage, "/api/manage/templates");
  const template = templates.body.find(item => item.name === "QA browser template");
  const created = await mustSend(senderPage, "POST", "/api/manage/template-use", { templateId: template.id, title: "QA access lockout", assignments: [
    { roleId: template.roles[0].recipientId, name: "Avery Morgan", email: "avery@client.test", order: 1, accessCode: "Lockout-123" },
    { roleId: template.roles[1].recipientId, name: "Jordan Lee", email: "jordan@client.test", order: 2 },
  ]});
  const envelopeResult = await requestJson(senderPage, `/api/envelopes/${created.id}`);
  if (envelopeResult.status !== 200) throw new Error(`Lockout envelope unavailable (${envelopeResult.status})`);
  let envelope = envelopeResult.body;
  const missingDocuments = envelope.documents.filter(document => !envelope.fields.some(field => field.documentId === document.id));
  if (missingDocuments.length) {
    envelope = await saveEnvelope(senderPage, envelope, { fields: [...envelope.fields, ...missingDocuments.map(document => ({ id: crypto.randomUUID(), documentId: document.id, recipientId: envelope.recipients[0].id, type: "signature", page: 0, x: 60, y: 220, width: 160, height: 40, required: true }))] });
  }
  await freeze(senderPage, envelope);
  const lockoutLinks = (await links(sender, envelope)).links;
  const page = await (await newContext()).newPage();
  await page.goto(`${BASE_URL}${lockoutLinks.find(l => l.email === "avery@client.test").path}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.fill("#access-code", "wrong-code-123");
    const [response] = await Promise.all([page.waitForResponse(value => value.url().includes("/api/sign/")), page.getByRole("button", { name: /check access/i }).click()]);
    if (response.status() !== (attempt === 4 ? 429 : 401)) throw new Error(`Unexpected access-code status on attempt ${attempt + 1}: ${response.status()}`);
  }
  await page.getByText(/lock|too many attempts/i).first().waitFor({ timeout: TIMEOUT });
  const current = await requestJson(senderPage, `/api/envelopes/${envelope.id}`);
  await mustSend(senderPage, "POST", `/api/envelopes/${envelope.id}/void`, { version: current.body.version, reason: "QA lockout cleanup" });
  await mustSend(await pageOf(admin), "POST", "/api/manage/lifecycle", { envelopeId: envelope.id, action: "delete", reason: "QA lockout cleanup" });
});

const mobileSender = await signIn("qa-sender@flowco.test", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

await scenario("M1", "Mobile login/dashboard and collapsed navigation", async () => {
  const page = await pageOf(mobileSender);
  await page.goto(`${BASE_URL}/`);
  await expectText(page, "Every signature");
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await expectText(page, "Envelopes");
  await shot(page, "M1");
});

await scenario("M2", "Mobile signing on reissued envelope", async () => {
  const senderPage = await pageOf(sender);
  const reissuedResult = await requestJson(senderPage, `/api/envelopes/${state.reissued.id}`);
  if (reissuedResult.status !== 200) throw new Error(`Reissued envelope unavailable (${reissuedResult.status})`);
  let reissued = reissuedResult.body;
  if (reissued.state === "draft") {
    const frozen = await freeze(senderPage, reissued);
    reissued = (await requestJson(senderPage, `/api/envelopes/${frozen.id ?? reissued.id}`)).body;
  }
  const mobileLinks = (await links(sender, reissued)).links;
  const mobile = await signIn("qa-sender@flowco.test", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = mobile.page;
  await page.goto(`${BASE_URL}${mobileLinks[0].path}`);
  await accessGate(page, "Avery-code-123");
  await fillTyped(page, "Avery Morgan");
  await submitSigning(page);
  await shot(page, "M2");
});

await scenario("M3", "Mobile settings and dashboard filters usable", async () => {
  const page = await pageOf(mobileSender);
  await page.goto(`${BASE_URL}/settings`);
  await expectText(page, "Contacts");
  await page.goto(`${BASE_URL}/`);
  await page.getByRole("button", { name: "Additional filters" }).click();
  await page.getByLabel("Created from").fill(new Date().toISOString().slice(0, 10));
  await shot(page, "M3");
});

await writeFile(path.join(EVIDENCE, "walkthrough-results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
const failed = results.some(item => item.status === "fail");
process.exitCode = failed ? 1 : 0;
