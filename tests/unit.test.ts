import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { PDFDocument, PDFName, PDFString, degrees, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { fieldInput, recipientInput, draftInput, fieldInside, validateValues, valuesInput, type Field } from "../lib/model";
import { DRAW_PREFIX, parseDrawing } from "../lib/drawing";
import { hash, verifier, verifyCode, newToken } from "../server/crypto";
import { inspectPdf, flatten, syntheticPdf, textPlacement, MAX_BYTES } from "../server/pdf";
import { boundedBody, body, sameOrigin, file, handled } from "../server/http";
import { AppError } from "../server/errors";
import { accountMessage, ORIGIN_MESSAGE, recoveryMessage, RequestTimeout, signInMessage, withLoginTimeout } from "../lib/login-feedback";
import { originTrusted, trustedOrigins } from "../server/origins";
import { matchesFilters } from "../lib/filters";
import { AVATAR_PALETTE,avatarColor,avatarInitials } from "../lib/avatar";
import { InitialsAvatar } from "../components/initials-avatar";

test("avatar initials use first and last graphemes with safe empty-name fallbacks",()=>{
 const cases=[
  ["  Sam\tJames\nTaylor  ","ST"],["Northstar Studio","NS"],["Prince","P"],
  ["e\u0301lodie durand","ÉD"],["李 雷","李雷"],["𠮷田 太郎","𠮷太"],
  ["👩🏽‍💻 Rivera","👩🏽‍💻R"],["ßmith Johnson","SJ"],
 ];
 const segmenter=new Intl.Segmenter("en",{granularity:"grapheme"});
 for(const [name,expected] of cases){const initials=avatarInitials(name);assert.equal(initials,expected);assert.ok(Array.from(segmenter.segment(initials)).length<=2);}
 assert.equal(avatarInitials(undefined,"ME"),"ME");
 assert.equal(avatarInitials(null,"SY"),"SY");
 assert.equal(avatarInitials("\t\n\u00a0","A"),"A");
 assert.equal(avatarInitials(""),"?");
 assert.equal(avatarInitials("","  "),"?");
 assert.equal(avatarInitials("","👩🏽‍💻XYZ"),"👩🏽‍💻X");
});
test("avatar colors prefer stable IDs and normalize name fallbacks deterministically",()=>{
 const expected=avatarColor("user-17","Sam Taylor");
 for(let render=0;render<10;render++)assert.deepEqual(avatarColor("user-17","Sam Taylor"),expected);
 assert.deepEqual(avatarColor(" USER-17 ","Renamed Person"),expected);
 assert.deepEqual(avatarColor("user-17",undefined,"ME"),expected);
 assert.deepEqual(avatarColor(undefined," Élodie   Durand "),avatarColor("", "e\u0301lodie\tDURAND"));
 assert.deepEqual(avatarColor("  ","Sam Taylor"),avatarColor(null,"sam taylor"));
 assert.deepEqual(avatarColor(null,null,"ME"),avatarColor(undefined,"","me"));
 assert.ok(AVATAR_PALETTE.includes(avatarColor()));
 assert.equal(new Set(Array.from({length:128},(_,index)=>avatarColor(`user-${index}`))).size,AVATAR_PALETTE.length);
});
test("avatar pastel palettes have darker initials with at least 4.5 to 1 contrast in either theme",()=>{
 const luminance=(hex:string)=>{
  const [r,g,b]=hex.slice(1).match(/.{2}/g)!.map(channel=>{const value=parseInt(channel,16)/255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;});
  return 0.2126*r+0.7152*g+0.0722*b;
 };
 assert.ok(AVATAR_PALETTE.length>=6&&AVATAR_PALETTE.length<=8);
 for(const {background,foreground} of AVATAR_PALETTE){
  const light=luminance(background),dark=luminance(foreground);
  assert.ok(light>dark);
  assert.ok((light+0.05)/(dark+0.05)>=4.5,`${foreground} on ${background}`);
 }
});
test("avatar component renders decorative identity colors with the circular 36px footprint",()=>{
 const props={id:"user-17",name:"Sam Taylor"},markup=renderToStaticMarkup(createElement(InitialsAvatar,props));
 const {background,foreground}=avatarColor(props.id,props.name);
 assert.equal(renderToStaticMarkup(createElement(InitialsAvatar,props)),markup);
 assert.match(markup,/class="avatar"/);assert.match(markup,/aria-hidden="true"/);assert.match(markup,/>ST<\/span>$/);
 assert.ok(markup.includes(`background-color:${background}`));assert.ok(markup.includes(`color:${foreground}`));
 assert.ok(!markup.includes(props.id));
 for(const fallback of ["ME","SY"])assert.ok(renderToStaticMarkup(createElement(InitialsAvatar,{id:props.id,fallback})).endsWith(`>${fallback}</span>`));
 const declarations=new Map<string,string>();
 postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8")).walkRules(".avatar",rule=>{rule.walkDecls(declaration=>{declarations.set(declaration.prop,declaration.value);});});
 assert.equal(declarations.get("width"),"36px");assert.equal(declarations.get("height"),"36px");
 assert.equal(declarations.get("border-radius"),"50%");assert.equal(declarations.get("border"),"0");assert.equal(declarations.get("box-shadow"),"none");
});

test("sign-in distinguishes incorrect credentials from service errors without exposing details",()=>{
 assert.match(signInMessage("INVALID_EMAIL_OR_PASSWORD"),/Email or password is incorrect/);
 assert.match(signInMessage("TOO_MANY_REQUESTS"),/Too many attempts/);
 assert.match(signInMessage(null),/temporarily unavailable/);
 assert.match(signInMessage("unexpected internal detail"),/temporarily unavailable/);
 assert.equal(signInMessage("INVALID_ORIGIN"),ORIGIN_MESSAGE);
 assert.equal(recoveryMessage("ORIGIN_REJECTED"),ORIGIN_MESSAGE);
 assert.equal(accountMessage(Object.assign(new Error("x"),{code:"ORIGIN_REJECTED"})),ORIGIN_MESSAGE);
 assert.equal(accountMessage(Object.assign(new Error("Invitation expired."),{code:"INVITE_INVALID"})),"Invitation expired.");
 assert.match(accountMessage(new RequestTimeout()),/took too long/);
 assert.match(accountMessage(new TypeError("Failed to fetch")),/couldn.t reach the server/);
 assert.match(recoveryMessage("REQUEST_TIMEOUT"),/may still be processed/);
});
test("login requests time out, abort, and preserve completed results and failures",async()=>{
 let signal:AbortSignal|undefined;
 await assert.rejects(withLoginTimeout(value=>{signal=value;return new Promise(()=>{});},10),RequestTimeout);
 assert.equal(signal?.aborted,true);
 assert.equal(await withLoginTimeout(async()=>"done",100),"done");
 await assert.rejects(withLoginTimeout(async()=>{throw new Error("failure");},100),/failure/);
});
const field=(v:Partial<Field>={}):Field=>({id:randomUUID(),documentId:randomUUID(),recipientId:randomUUID(),type:"signature",page:0,x:10,y:20,width:150,height:35,required:true,...v});
test("SHA-256 is calculated from actual bytes and code verifiers are salted",()=>{
 assert.equal(hash(Buffer.from("abc")),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
 const a=verifier("testing-code"),b=verifier("testing-code");assert.notEqual(a,b);assert.ok(!a.includes("testing-code"));assert.ok(verifyCode("testing-code",a));assert.ok(!verifyCode("wrong-code",a));assert.ok(!verifyCode("x".repeat(65),a));assert.ok(!verifyCode("code","invalid"));
 const token=newToken();assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(hash(token),token);
});
test("draft schemas preserve two recipient assignments and reject external email / nonfinite geometry",()=>{
 const recipients=[{id:randomUUID(),name:"Avery Morgan",email:"avery@client.test",order:1},{id:randomUUID(),name:"Jordan Lee",email:"jordan@client.test",order:2}];
 const data=draftInput.parse({version:1,title:"Synthetic agreement",routing:"sequential",recipients,fields:[]});assert.equal(data.recipients.length,2);assert.doesNotThrow(()=>draftInput.parse({version:1,title:"Draft",routing:"parallel",recipients:[],fields:[]}));
 assert.throws(()=>recipientInput.parse({...recipients[0],email:"person@example.com"}));assert.throws(()=>recipientInput.parse({...recipients[0],accessCode:"short"}));
 assert.throws(()=>fieldInput.parse(field({x:Infinity})));assert.throws(()=>fieldInput.parse(field({width:0})));assert.throws(()=>fieldInput.parse(field({page:50})));
});
test("canonical bounds honor crop offsets, every rotation and exact edges",()=>{
 for(const rotation of [0,90,180,270]){const p={x:-20,y:30,width:400,height:600,rotation};assert.ok(fieldInside(field({x:-20,y:30,width:400,height:600}),p));assert.ok(!fieldInside(field({x:-21,y:30}),p));assert.ok(!fieldInside(field({x:300,y:30,width:100}),p));assert.ok(!fieldInside(field({x:0,y:620,height:30}),p));}
});
test("required fields, consent-independent values, recipient scope and real dates",()=>{
 const s=field(),c=field({type:"checkbox"}),d=field({type:"date"}),optional=field({type:"text",required:false});
 assert.throws(()=>validateValues([s,c,d],{}));assert.throws(()=>validateValues([s,c],{[s.id]:"Avery",[c.id]:false}));assert.throws(()=>validateValues([s],{[s.id]:" ",foreign:"Jordan"}));assert.throws(()=>validateValues([s],{[s.id]:true}));
 assert.throws(()=>validateValues([d],{[d.id]:"2026-02-30"}));assert.throws(()=>validateValues([d],{[d.id]:"2026-13-01"}));assert.doesNotThrow(()=>validateValues([s,c,d,optional],{[s.id]:"Avery Morgan",[c.id]:true,[d.id]:"2028-02-29"}));
 assert.throws(()=>valuesInput.parse({[s.id]:"Avery\nMorgan"}));assert.throws(()=>valuesInput.parse({[s.id]:"😀"}));
});
test("PDF parser preserves immutable bytes, portrait/landscape, crop origins and rotations",async()=>{
 for(const rotation of [0,90,180,270]){const p=await PDFDocument.create(),page=p.addPage([800,600]);page.setCropBox(30,40,700,500);page.setRotation(degrees(rotation));const bytes=Buffer.from(await p.save()),copy=Buffer.from(bytes),meta=await inspectPdf(bytes);assert.deepEqual(meta.geometry,[{x:30,y:40,width:700,height:500,rotation}]);assert.equal(meta.sha256,hash(bytes));assert.equal(meta.size,bytes.length);assert.deepEqual(bytes,copy);}
 assert.equal((await inspectPdf(await syntheticPdf("Portrait"))).geometry[0].width,595.28);assert.equal((await inspectPdf(await syntheticPdf("Landscape",true))).geometry[0].width,792);
});
test("reject malformed, oversized, out-of-media crop and action-bearing PDFs, including direct nested dictionaries",async()=>{
 await assert.rejects(inspectPdf(Buffer.from("not a PDF")),{code:"PDF_INVALID"});await assert.rejects(inspectPdf(Buffer.alloc(MAX_BYTES+1)),{code:"PDF_INVALID"});
 const p=await PDFDocument.create(),page=p.addPage([600,800]);page.setCropBox(-10,0,600,800);await assert.rejects(inspectPdf(await p.save()),{code:"PDF_INVALID"});
 page.setCropBox(0,0,600,800);p.catalog.set(PDFName.of("Names"),p.context.obj({Nested:{JS:PDFString.of("alert(1)")}}));await assert.rejects(inspectPdf(await p.save()),{code:"PDF_INVALID"});
});
test("reject annotated PDFs, too many pages and custom units",async()=>{
 const p=await PDFDocument.create(),page=p.addPage([600,800]);page.node.set(PDFName.of("Annots"),p.context.obj([{Subtype:"Text"}]));await assert.rejects(inspectPdf(await p.save()),{code:"PDF_INVALID"});page.node.delete(PDFName.of("Annots"));page.node.set(PDFName.of("UserUnit"),p.context.obj(2));await assert.rejects(inspectPdf(await p.save()),{code:"PDF_INVALID"});
 const many=await PDFDocument.create();for(let i=0;i<51;i++)many.addPage();await assert.rejects(inspectPdf(await many.save()),{code:"PDF_INVALID"});
});
test("text transforms stay inside canonical rectangles and follow rotated display width",()=>{
 const f={x:30,y:40,width:160,height:36};for(const r of [0,90,180,270]){const t=textPlacement(f,r);assert.equal(t.width,r%180?36:160);assert.equal(t.height,r%180?160:36);for(const [u,v] of [[0,0],[t.width,t.height],[3,5]]){const p=t.point(u,v);assert.ok(p.x>=30&&p.x<=190&&p.y>=40&&p.y<=76);}}
 assert.deepEqual(textPlacement(f,90).point(3,5),{x:185,y:43});assert.deepEqual(textPlacement(f,270).point(3,5),{x:35,y:73});
});
test("flattened output has real PDF content, no interactive fields, and distinct byte hashes",async()=>{
 const original=await syntheticPdf("Synthetic terms"),before=hash(original),f=field({x:48,y:80}),f2=field({type:"checkbox",x:48,y:50,width:20,height:20});
 const out=await flatten(original,[f,f2],{[f.id]:"Avery Morgan",[f2.id]:true});assert.notEqual(hash(out),before);assert.equal(hash(original),before);const pdf=await PDFDocument.load(out);assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getForm().getFields().length,0);const streams=pdf.getPage(0).node.lookup(PDFName.of("Contents"),PDFArray).asArray();
 const content=streams.map(ref=>{const stream=pdf.context.lookup(ref);assert.ok(stream instanceof PDFRawStream);return Buffer.from(decodePDFRawStream(stream).decode()).toString();}).join("\n");
 assert.ok(content.includes("4176657279204D6F7267616E"),"Typed signature is painted into PDF content, not merely metadata");
 assert.ok(!pdf.getPage(0).node.has(PDFName.of("Annots")));
 assert.equal((await inspectPdf(out)).sha256,hash(out));
});
test("flatten removes only empty annotation arrays and preserves real annotations and source bytes",async()=>{
 for(const rotation of [0,90,180,270]) {
  const p=await PDFDocument.create(),empty=p.addPage([600,800]),annotated=p.addPage([600,800]);
  empty.setRotation(degrees(rotation));empty.node.set(PDFName.of("Annots"),p.context.register(p.context.obj([])));
  annotated.node.set(PDFName.of("Annots"),p.context.obj([{Subtype:"Text",Contents:PDFString.of("Preserve this annotation")} ]));
  const original=Buffer.from(await p.save()),copy=Buffer.from(original),f=field({x:48,y:80});
  const out=await flatten(original,[f],{[f.id]:"Avery Morgan"}),pdf=await PDFDocument.load(out);
  assert.ok(!pdf.getPage(0).node.has(PDFName.of("Annots")));
  assert.equal(pdf.getPage(0).getRotation().angle,rotation);
  const annotations=pdf.getPage(1).node.lookup(PDFName.of("Annots"),PDFArray);
  assert.equal(annotations.size(),1);assert.ok(annotations.toString().includes("Preserve this annotation"));
  assert.deepEqual(original,copy);await assert.rejects(inspectPdf(out),{code:"PDF_INVALID"});
 }
});
test("bounded HTTP reader rejects excess bytes even without content-length",async()=>{
 const req=new Request("http://localhost/api",{method:"POST",body:"123456789"});await assert.rejects(boundedBody(req,4),{code:"BODY_TOO_LARGE"});
 await assert.rejects(body(new Request("http://localhost/api",{method:"POST",body:"{"})),{code:"JSON_INVALID"});
});
test("mutations reject foreign origins; private downloads expose digest and no-store",()=>{
 const origin=process.env.BETTER_AUTH_URL??"http://localhost:3000";assert.throws(()=>sameOrigin(new Request(origin+"/api",{headers:{origin:"https://attacker.invalid"}})),{code:"ORIGIN_REJECTED"});
 assert.doesNotThrow(()=>sameOrigin(new Request(origin+"/api",{headers:{origin:new URL(origin).origin}})));
 const response=file({bytes:Buffer.from("abc"),sha256:hash("abc"),name:'bad"\r\n.pdf'});assert.equal(response.headers.get("cache-control"),"no-store, private");assert.equal(response.headers.get("x-content-sha256"),hash("abc"));assert.ok(!response.headers.get("content-disposition")?.includes("\r"));
});
test("setup failures and validation errors have actionable HTTP status, never success",async()=>{
 const r=await handled(async()=>{throw new AppError(503,"DATABASE_SETUP_REQUIRED","Attach an isolated development database");});assert.equal(r.status,503);assert.equal((await r.json()).code,"DATABASE_SETUP_REQUIRED");
});

test("missing-database API returns setup failure, not sample dashboard rows",async()=>{
 const saved=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
 try{const {GET}=await import("../app/api/workspace/route");const r=await GET(new Request("http://localhost:3000/api/workspace"));assert.equal(r.status,503);const value=await r.json();assert.equal(value.code,"DATABASE_SETUP_REQUIRED");assert.ok(!("envelopes" in value));}finally{if(saved===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=saved;}
});
test("loopback origin aliases are trusted only outside production; foreign origins never",()=>{
 assert.deepEqual(trustedOrigins("http://localhost:3000","production"),["http://localhost:3000"]);
 assert.equal(originTrusted("http://127.0.0.1:3000","http://localhost:3000","production"),false);
 for(const alias of ["http://localhost:3000","http://127.0.0.1:3000","http://[::1]:3000"]) assert.equal(originTrusted(alias,"http://localhost:3000","development"),true);
 assert.equal(originTrusted("http://localhost:3000","http://127.0.0.1:3000","test"),true);
 assert.equal(originTrusted("http://127.0.0.1:3001","http://localhost:3000","development"),false);
 assert.equal(originTrusted("https://127.0.0.1:3000","http://localhost:3000","development"),false);
 assert.equal(originTrusted("https://attacker.invalid","http://localhost:3000","development"),false);
 assert.equal(originTrusted(null,"http://localhost:3000","development"),false);
 assert.deepEqual(trustedOrigins("https://esign.example.com","development"),["https://esign.example.com"]);
});
test("status export filters treat 'all' as unset and match recipients like the dashboard",()=>{
 const e={title:"Supplier NDA",owner_name:"Sam",state:"sent",folder:"",tags:[],created_at:"2026-11-10T09:00:00Z",recipients:[{name:"Avery Morgan",email:"avery@client.test"}]};
 assert.equal(matchesFilters(e,{recipient:"all",status:"all",folder:"all",tag:"all",search:""}),true);
 assert.equal(matchesFilters(e,{recipient:"AVERY@client"}),true);
 assert.equal(matchesFilters(e,{recipient:"morgan"}),true);
 assert.equal(matchesFilters(e,{recipient:"other@client.test"}),false);
 assert.equal(matchesFilters(e,{from:"2026-11-11"}),false);
 assert.equal(matchesFilters(e,{from:"2026-11-01",to:"2026-11-10"}),true);
});
test("drawn signatures require complete strokes and drawing-compatible fields",()=>{
 assert.deepEqual(parseDrawing(DRAW_PREFIX+JSON.stringify([[[0.1,0.5],[0.3,0.4]]])),[[[0.1,0.5],[0.3,0.4]]]);
 assert.throws(()=>parseDrawing(DRAW_PREFIX+JSON.stringify([[[0.1,0.5]]])));
 const fields:Field[]=[{id:"text",documentId:"d",recipientId:"r",type:"text",page:0,x:10,y:10,width:100,height:20,required:true}];
 assert.throws(()=>validateValues(fields,{text:DRAW_PREFIX+JSON.stringify([[[0.1,0.5],[0.3,0.4]]])}),/Drawings are only valid for signatures and initials/);
});

test("first workspace setup requires a strong matching key and valid administrator details",async()=>{
 const {setupInput,setupKeyMatches}=await import("../server/company-setup");
 const key="a".repeat(32),input={company:"Synthetic Co",name:"First Admin",email:"ADMIN@example.test",password:"12characters!",key};
 assert.equal(setupInput.parse(input).email,"admin@example.test");
 assert.ok(setupKeyMatches(key,key));assert.ok(!setupKeyMatches(undefined,key));assert.ok(!setupKeyMatches("short","short"));assert.ok(!setupKeyMatches(key,"b".repeat(32)));
 assert.throws(()=>setupInput.parse({...input,key:"short"}),/32–1024/);assert.throws(()=>setupInput.parse({...input,password:"too-short"}));
 const oldKey=process.env.COMPANY_SETUP_KEY;delete process.env.COMPANY_SETUP_KEY;try{const {GET}=await import("../app/api/health/route");assert.equal(GET().status,200);}finally{if(oldKey!==undefined)process.env.COMPANY_SETUP_KEY=oldKey;}
});

test('Resend provider: payload, idempotency key and error mapping without network', async () => {
  const { providerSend, mailProvider } = await import('../server/automation');
  const env = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', EMAIL_DISPATCH_ENABLED: '1', RESEND_API_KEY: 're_synthetic_mock', EMAIL_FROM: 'no-reply@apps.neander.ai' });
    delete process.env.BREVO_API_KEY;
    assert.equal(mailProvider(), 'resend');
    let seen: any;
    const ok = (async (url: any, init: any) => { seen = { url, init }; return Response.json({ id: 'synthetic-resend-id' }, { status: 200 }); }) as typeof fetch;
    const r = await providerSend({ email: 'signer@example.com', subject: 'Please sign', text: 'Plain', html: '<p>Html</p>', key: 'event-key' }, ok);
    assert.equal(r.status, 'provider_accepted'); assert.equal((r as any).providerId, 'synthetic-resend-id');
    assert.equal(seen.url, 'https://api.resend.com/emails');
    assert.equal(seen.init.headers.authorization, 'Bearer re_synthetic_mock');
    assert.match(seen.init.headers['idempotency-key'], /^[0-9a-f]{64}$/);
    const body = JSON.parse(seen.init.body);
    assert.equal(body.from, 'Accord <no-reply@apps.neander.ai>'); assert.deepEqual(body.to, ['signer@example.com']); assert.equal(body.text, 'Plain'); assert.equal(body.html, '<p>Html</p>');
    const status = (code: number) => (async () => Response.json({ name: 'x' }, { status: code })) as typeof fetch;
    assert.equal((await providerSend({ email: 'a@example.com', subject: 's', text: 't', html: 'h', key: 'k1' }, status(429))).status, 'retry');
    assert.equal((await providerSend({ email: 'a@example.com', subject: 's', text: 't', html: 'h', key: 'k2' }, status(500))).status, 'retry');
    assert.equal((await providerSend({ email: 'a@example.com', subject: 's', text: 't', html: 'h', key: 'k3' }, status(403))).status, 'failed');
    assert.equal((await providerSend({ email: 'a@example.com', subject: 's', text: 't', html: 'h', key: 'k4' }, (async () => { throw new Error('reset'); }) as typeof fetch)).status, 'uncertain');
    assert.equal((await providerSend({ email: 'qa@acme.test', subject: 's', text: 't', html: 'h', key: 'k5' }, ok)).status, 'qa_blocked');
  } finally { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); }
});

test('DOCX conversion keeps tables and explicit page breaks', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const { convertDocx } = await import('../server/docx');
  const { PDFDocument } = await import('pdf-lib');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (t: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`;
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const doc = `<?xml version="1.0"?><w:document ${W}><w:body>${p('Services agreement', 'Heading1')}${p('Fees &amp; term — see table')}<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6000"/></w:tblGrid><w:tr>${cell('Item')}${cell('Amount')}</w:tr><w:tr>${cell('Consulting')}${cell('EUR 1,000 per month')}</w:tr></w:tbl><w:p><w:r><w:br w:type="page"/></w:r></w:p>${p('Signature page')}<w:sectPr/></w:body></w:document>`;
  const bytes = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(doc) }));
  const out = await convertDocx(bytes);
  assert.equal(out!.converter, 'bounded-docx-layout-v3');
  const pdf = await PDFDocument.load(out!.bytes);
  assert.equal(pdf.getPageCount(), 2, 'the explicit page break starts page 2');
  const page1 = pdf.getPage(0).node.Contents();
  const streams = page1 && 'asArray' in (page1 as any) ? (page1 as any).asArray().map((r: any) => pdf.context.lookup(r)) : [page1];
  const ops = streams.map((st: any) => Buffer.from(st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents()).toString('latin1')).join('\n');
  assert.ok((ops.match(/\nh\nS\n/g) ?? []).length >= 4, 'one stroked border per table cell (2x2 table)');
  assert.ok(/166\.4\d* 21 l/.test(ops) && /332\.8\d* 21 l/.test(ops), 'column widths follow the document grid (1:2)');
});

test('transactional email template: product heading, action button and plain-text fallback', async () => {
  const { renderEmail } = await import('../server/email-template');
  const m = renderEmail({ kind: 'signing_request', subject: 'Signature requested: NDA <draft>', text: 'Review and sign NDA: https://example.com/sign/abc', company: 'Acme Demo Ltd', brandColor: '#123456' });
  assert.match(m.html, /Accord/); assert.match(m.html, /Signature requested/);
  assert.match(m.html, /<a href="https:\/\/example.com\/sign\/abc"[^>]*>Review and sign<\/a>/);
  assert.ok(m.html.includes('NDA &lt;draft&gt;') && !m.html.includes('<draft>'), 'subject is escaped');
  assert.match(m.html, /#123456/); assert.match(m.html, /on behalf of Acme Demo Ltd/);
  assert.match(m.text, /^Accord/); assert.match(m.text, /Review and sign: https:\/\/example.com\/sign\/abc/);
  assert.ok(!/<(a|html|table|p)[\s>]/.test(m.text), 'plain text has no HTML markup');
  assert.doesNotMatch(m.html + m.text, /Neander|Team eSignature|DocuSign/i);
  // The body is not repeated: a reminder shows the heading and one sentence, and a sender notice drops the trailing call to action.
  const r = renderEmail({ kind: 'reminder', subject: 'Reminder: Signature requested: NDA', text: 'Review and sign NDA: https://example.com/sign/abc' });
  assert.equal((r.html.match(/NDA/g) ?? []).length, 2, 'title appears in <title> and once in the body');
  assert.doesNotMatch(r.text, /Signature requested/);
  const n = renderEmail({ kind: 'sender_notification', subject: 'Envelope voided: NDA', text: '"NDA" is now voided. The activity record keeps every step. View the envelope: https://example.com/envelopes/1' });
  assert.match(n.text, /keeps every step\.\n\nView envelope: https:/); assert.doesNotMatch(n.html, /View the envelope/);
  const c = renderEmail({ kind: 'completion_copy', subject: 'Completed documents: NDA', text: 'Download your completed PDFs and receipt: https://example.com/complete/1' });
  assert.match(c.text, /\nNDA\nDownload your completed PDFs and receipt\n/);
});

test('webhook DNS pinning answers both lookup call styles (ES-15)', async () => {
  const { pinnedLookup } = await import('../server/automation');
  const lookup = pinnedLookup({ address: '93.184.216.34', family: 4 });
  const all = await new Promise<any>(r => lookup('example.com', { all: true }, (_e: any, v: any) => r(v)));
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
  const one = await new Promise<any[]>(r => lookup('example.com', {}, (_e: any, a: any, f: any) => r([a, f])));
  assert.deepEqual(one, ['93.184.216.34', 4]);
});

test('DOCX conversion keeps spaces between runs, merged-cell widths, list markers and accents', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const { convertDocx } = await import('../server/docx');
  const { PDFDocument } = await import('pdf-lib');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const run = (t: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r>`;
  const listP = (t: string, numId: number, ilvl = 0) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(t)}</w:p>`;
  const cell = (t: string, span = 1) => `<w:tc>${span > 1 ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : ''}<w:p>${run(t)}</w:p></w:tc>`;
  const numbering = `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="\uf0b7"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const doc = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p>${run('Bold', '<w:rPr><w:b/></w:rPr>')}${run(' ')}${run('and italic')}</w:p>
    ${listP('Scope', 1)}${listP('Fees', 1)}${listP('Late fees', 1, 1)}${listP('Term', 1)}${listP('Point', 2)}
    <w:p>${run('Caf\u00e9 d\u00e9j\u00e0 vu \u20ac 5')}</w:p>
    <w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell('Merged', 2)}${cell('C3')}</w:tr><w:tr>${cell('A')}${cell('B')}${cell('C')}</w:tr></w:tbl>
  </w:body></w:document>`.replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const bytes = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(doc), 'word/numbering.xml': strToU8(numbering) }));
  const out = await convertDocx(bytes);
  const pdf = await PDFDocument.load(out!.bytes);
  const page = pdf.getPage(0).node.Contents();
  const streams = page && 'asArray' in (page as any) ? (page as any).asArray().map((r: any) => pdf.context.lookup(r)) : [page];
  const ops = streams.map((st: any) => Buffer.from(st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents()).toString('latin1')).join('\n');
  const shown = [...ops.matchAll(/<([0-9A-F]+)> Tj/g)].map(m => Buffer.from(m[1], 'hex').toString('latin1'));
  assert.ok(shown.includes('Bold and italic'), 'the space-only run between two runs is kept');
  for (const t of ['1.', 'Scope', '2.', 'Fees', '(a)', 'Late fees', '3.', 'Term', '\x95', 'Point']) assert.ok(shown.includes(t), `list marker or item ${JSON.stringify(t)} drawn`);
  assert.ok(shown.includes('Caf\xe9 d\xe9j\xe0 vu \x80 5'), 'Western European characters are encoded, not refused');
  assert.ok(/\n332\.85\d* 21 l/.test(ops), 'the merged cell spans two of three equal columns (2/3 of 499.28 pt)');
  assert.ok(/ 380\.85\d* [\d.]+ cm/.test(ops), 'the third cell starts right after the merged cell');
  const greek = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body><w:p>${run('\u03a9mega')}</w:p></w:body></w:document>`.replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))) }));
  await assert.rejects(convertDocx(greek), /DOCX_INVALID|cannot be safely converted/, 'other scripts are refused, never silently dropped');
});

test('typed signing values accept Western European characters and refuse other scripts', async () => {
  const { valuesInput } = await import('../lib/model');
  assert.ok(valuesInput.safeParse({ name: 'Jos\u00e9 Garc\u00eda', text: 'Niccol\u00f2 \u2013 \u20ac 1.000' }).success, 'accented names and euro sign are accepted');
  assert.equal(valuesInput.safeParse({ name: '\u0391\u03bb\u03ad\u03be\u03b1\u03bd\u03b4\u03c1\u03bf\u03c2' }).success, false, 'Greek is refused because the PDF fonts cannot draw it');
});

test("visibility filter separates active, archived and deleted envelopes (list and CSV export)", () => {
  const base = { created_at: "2026-11-20T10:00:00.000Z", title: "T", owner_name: "O", recipients: [], state: "voided", folder: "", tags: [] };
  const active = { ...base, archived_at: null, deleted_at: null };
  const archived = { ...base, archived_at: "2026-11-21T19:42:50.503Z", deleted_at: null };
  const deleted = { ...base, archived_at: "2026-11-21T19:42:50.503Z", deleted_at: "2026-11-22T00:00:00.000Z" };
  for (const v of [undefined, "active"] as const) {
    assert.equal(matchesFilters(active, { visibility: v }), true);
    assert.equal(matchesFilters(archived, { visibility: v }), false);
    assert.equal(matchesFilters(deleted, { visibility: v }), false);
  }
  assert.deepEqual([active, archived, deleted].map(e => matchesFilters(e, { visibility: "archived" })), [false, true, false]);
  assert.deepEqual([active, archived, deleted].map(e => matchesFilters(e, { visibility: "deleted" })), [false, false, true]);
});
