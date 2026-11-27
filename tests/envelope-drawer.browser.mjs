// Run against an already-running preview. Every API call is fulfilled with fictional
// in-memory fixtures in a fresh context; unrecognized writes are blocked.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

const origin=process.env.ACCORD_DRAWER_ORIGIN||"http://127.0.0.1:56327";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname),"Use a loopback preview");
const evidence=".next/envelope-drawer-review";
await mkdir(evidence,{recursive:true});
const pdf=await PDFDocument.create();pdf.addPage([612,792]);const bytes=Buffer.from(await pdf.save());
const browser=await chromium.launch({headless:true,...(process.platform==="darwin"?{executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}:{})});
const deadline=setTimeout(()=>void browser.close(),180000);
const checks=[];
const check=(name)=>{checks.push(name);console.log(`PASS ${name}`);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(fn,message)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(50);}throw new Error(message);};

async function fixtureContext({role="admin",width=1440,height=960}={}) {
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:"block"});
  const document={id:randomUUID(),name:"Fixture agreement.pdf",size:bytes.length,sha256:"0".repeat(64),geometry:[{x:0,y:0,width:612,height:792,rotation:0}]};
  const recipient={id:randomUUID(),name:"Avery Morgan",email:"avery@client.test",routing_order:1,status:"pending"};
  const existing={id:randomUUID(),owner_id:"fixture-owner",owner_name:"Alex Rivera",title:"Fixture existing agreement",state:"draft",version:1,routing:"parallel",folder:"Fixture folder",tags:["fixture"],created_at:"2026-11-27T00:00:00Z",documents:[document],recipients:[recipient],fields:[{id:randomUUID(),documentId:document.id,recipientId:recipient.id,type:"signature",page:0,x:20,y:20,width:180,height:40,required:true}],events:[],outputs:[],deliveries:[]};
  const envelopes=new Map([[existing.id,existing]]);
  const state={role,created:0,saves:0,uploads:0,sends:0,workspaceReads:0,failCreate:false,failSave:false,failUpload:false,failSend:false,hold:null,blocked:[],errors:[],copies:new Map()};
  const json=(route,value,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
  await context.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method(),write=!["GET","HEAD"].includes(method);
    if(url.origin!==origin){if(write)state.blocked.push(`${method} external`);return route.abort();}
    if(!url.pathname.startsWith("/api/")){
      if(write){state.blocked.push(`${method} ${url.pathname}`);return route.abort();}
      return route.continue();
    }
    if(url.pathname==="/api/workspace"&&method==="GET"){
      state.workspaceReads++;
      return json(route,{company:{id:"fixture-company",name:"Northstar Studio"},role:state.role,userId:"fixture-owner",verificationOnly:true,developmentLinks:true,envelopes:[...envelopes.values()].map(e=>({...e,document_count:e.documents.length}))});
    }
    if(url.pathname==="/api/manage/colleagues"&&method==="GET")return json(route,[{id:"fixture-colleague",name:"Jordan Lee",email:"jordan@client.test",role:"sender"}]);
    if(url.pathname==="/api/envelopes"&&method==="POST"){
      if(state.hold)await state.hold;
      if(state.failCreate){state.failCreate=false;return json(route,{error:"Fixture create failed. Try again."},503);}
      state.created++;
      const e={...structuredClone(existing),id:randomUUID(),title:request.postDataJSON().title,folder:"",tags:[],documents:[],recipients:[],fields:[]};
      envelopes.set(e.id,e);return json(route,e);
    }
    const match=url.pathname.match(/^\/api\/envelopes\/([^/]+)(?:\/(.+))?$/),e=match&&envelopes.get(match[1]),action=match?.[2];
    if(e){
      if(!action&&method==="GET")return json(route,e);
      if(action==="shares"&&method==="GET")return json(route,[]);
      if(action==="documents"&&method==="GET")return route.fulfill({contentType:"application/pdf",body:bytes});
      if(action==="completion-copy"&&method==="GET")return json(route,{version:e.version,copy:state.copies.get(e.id)||null});
      if(action==="completion-copy"&&method==="POST"){
        if(state.hold)await state.hold;
        const body=request.postDataJSON();assert.equal(body.version,e.version);e.version++;
        const copy=body.email?{email:body.email,state:"awaiting_completion",expiresAt:null,delivery:null}:null;state.copies.set(e.id,copy);
        return json(route,{version:e.version,copy});
      }
      if(action==="documents"&&method==="POST"){
        if(state.hold)await state.hold;
        if(state.failUpload){state.failUpload=false;return json(route,{error:"Fixture upload failed. Try again."},400);}
        assert.equal(Number(request.headers()["x-envelope-version"]),e.version);state.uploads++;e.version++;
        e.documents.push({...document,id:randomUUID(),name:decodeURIComponent(request.headers()["x-file-name"])});return json(route,e);
      }
      if(!action&&method==="PATCH"){
        if(state.hold)await state.hold;
        if(state.failSave){state.failSave=false;return json(route,{error:"This envelope changed. Reload it before saving.",code:"VERSION_CONFLICT"},409);}
        const body=request.postDataJSON();assert.equal(body.version,e.version);
        if(!body.title.trim()||body.recipients.some(r=>!r.name.trim()||!r.email.endsWith(".test")))return json(route,{error:"Enter a recipient name and valid synthetic email."},400);
        state.saves++;Object.assign(e,{...body,version:e.version+1,recipients:body.recipients.map(r=>({id:r.id,name:r.name,email:r.email,routing_order:r.order,status:"pending",has_access_code:!!r.accessCode}))});return json(route,e);
      }
      if(action==="send"&&method==="POST"){
        if(state.hold)await state.hold;
        const body=request.postDataJSON();assert.equal(body.confirmed,true);assert.equal(body.version,e.version);
        if(state.failSend){state.failSend=false;return json(route,{error:"Fixture send failed. Try again."},503);}
        state.sends++;e.state="sent";e.version++;return json(route,{state:"sent"});
      }
    }
    state.blocked.push(`${method} ${url.pathname}`);
    return json(route,{error:"Non-fixture API request blocked."},403);
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror",error=>state.errors.push(error.message));
  await page.goto(`${origin}/envelopes`);await page.getByRole("heading",{name:"Envelopes",exact:true}).waitFor();await page.locator(".document-link").waitFor();
  return {context,page,state,envelopes,existing};
}

try {
  const {context,page,state,envelopes,existing}=await fixtureContext();
  const drawer=page.getByRole("dialog",{name:"Create an envelope",exact:true});
  const details=page.getByRole("dialog",{name:"Envelope details",exact:true});
  await page.getByRole("textbox",{name:"Search envelopes"}).fill("Fixture");
  await page.getByRole("button",{name:"Additional filters"}).click();await page.getByLabel("Recipient",{exact:true}).fill("Avery");
  await page.evaluate(()=>{window.drawerSentinel="preserve-dashboard";});
  await page.locator(".document-link").click();await details.getByLabel("Title",{exact:true}).waitFor();
  const box=await details.boundingBox();await details.screenshot({path:`${evidence}/desktop-details.png`});assert.equal(box.x,288);assert.equal(box.width,1152);
  assert.equal(await details.locator(".app-sidebar,.workspace-loading,.app-layout").count(),0);
  await details.getByLabel("Title",{exact:true}).fill("Fixture unsaved title");await page.keyboard.press("Escape");
  const discard=page.getByRole("alertdialog",{name:"Discard unsaved changes?"});await discard.waitFor();await discard.getByRole("button",{name:"Keep editing"}).click();
  assert.equal(await details.getByLabel("Title",{exact:true}).inputValue(),"Fixture unsaved title");
  await details.getByRole("button",{name:"Close",exact:true}).click();await discard.getByRole("button",{name:"Discard changes"}).click();await details.waitFor({state:"hidden"});
  assert.equal(await page.getByRole("textbox",{name:"Search envelopes"}).inputValue(),"Fixture");assert.equal(await page.getByLabel("Recipient",{exact:true}).inputValue(),"Avery");
  assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains("document-link")),true);
  await page.getByRole("link",{name:`Open ${existing.title}`,exact:true}).click();await details.getByLabel("Title",{exact:true}).waitFor();
  await page.keyboard.press("Escape");await details.waitFor({state:"hidden"});
  check("desktop title/Open drawers use 80% width, confirm unsaved dismissal, restore focus and preserve filters");

  await page.getByRole("link",{name:"Create envelope",exact:true}).click();await drawer.getByLabel("Envelope title",{exact:true}).fill("Fixture new agreement");
  assert.equal(state.created,0);assert.equal(await drawer.getByText("1. Documents & details",{exact:true}).count(),0);
  state.failCreate=true;await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByText("Fixture create failed. Try again.").waitFor();assert.equal(state.created,0);
  let release;state.hold=new Promise(resolve=>{release=resolve;});
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("button",{name:"Creating…"}).waitFor();await drawer.locator("form").evaluate(form=>{form.requestSubmit();form.requestSubmit();});await page.keyboard.press("Escape");assert.equal(await drawer.isVisible(),true);
  assert.equal(await drawer.getByRole("button",{name:"Close",exact:true}).isDisabled(),true);release();state.hold=null;
  await drawer.getByRole("heading",{name:"Documents & details",exact:true}).waitFor();assert.equal(state.created,1);
  const created=[...envelopes.values()].find(e=>e.id!==existing.id);assert.ok(created);
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByText("Add at least one PDF or DOCX before continuing.").waitFor();
  state.failUpload=true;await drawer.getByLabel("Add private PDFs or DOCX").setInputFiles({name:"Fixture upload.pdf",mimeType:"application/pdf",buffer:bytes});await drawer.getByText("Fixture upload failed. Try again.").waitFor();
  await drawer.getByLabel("Add private PDFs or DOCX").setInputFiles({name:"Fixture upload.pdf",mimeType:"application/pdf",buffer:bytes});await wait(()=>state.uploads===1,"Upload did not finish");
  await drawer.getByLabel("Folder",{exact:true}).fill("Saved fixture folder");
  await drawer.getByRole("button",{name:"Back",exact:true}).click();await drawer.getByLabel("Envelope title",{exact:true}).fill("Fixture renamed agreement");
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("heading",{name:"Documents & details",exact:true}).waitFor();assert.equal(await drawer.getByLabel("Folder",{exact:true}).inputValue(),"Saved fixture folder");
  assert.equal(created.id,[...envelopes.values()].find(e=>e.id!==existing.id).id);assert.equal(state.created,1);assert.equal(state.uploads,1);
  state.failSave=true;await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByText("This envelope changed. Reload it before saving.").waitFor();assert.equal(await drawer.getByRole("heading",{name:"Documents & details",exact:true}).isVisible(),true);
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("heading",{name:"Recipients & routing",exact:true}).waitFor();
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByText("Add at least one recipient before continuing.").waitFor();
  await drawer.getByRole("button",{name:"Add recipient",exact:true}).click();await drawer.getByRole("button",{name:"Back",exact:true}).click();await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("heading",{name:"Recipients & routing",exact:true}).waitFor();assert.equal(await drawer.getByLabel("Name",{exact:true}).inputValue(),"");await drawer.getByLabel("Name",{exact:true}).fill("Jordan Lee");
  await drawer.getByLabel("Synthetic email",{exact:true}).fill("invalid");await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByText("Enter a recipient name and valid synthetic email.").waitFor();
  await drawer.getByLabel("Synthetic email",{exact:true}).fill("jordan@client.test");
  await drawer.getByRole("button",{name:"Back",exact:true}).click();await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("heading",{name:"Recipients & routing",exact:true}).waitFor();assert.equal(await drawer.getByLabel("Name",{exact:true}).inputValue(),"Jordan Lee");
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("heading",{name:"Signing fields",exact:true}).waitFor();
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByText("Place a required signature for every recipient and at least one field on every document.",{exact:true}).waitFor();
  await drawer.getByRole("button",{name:"Add field on this page",exact:true}).click();await drawer.getByLabel("PDF page 1",{exact:true}).waitFor();
  await drawer.locator(".pdf-field").waitFor();
  const beforeX=Number(await drawer.getByLabel("x (pt)").inputValue());const field=drawer.locator(".pdf-field");await field.scrollIntoViewIfNeeded();const position=await field.boundingBox();await page.mouse.move(position.x+8,position.y+8);await page.mouse.down();await page.mouse.move(position.x+28,position.y-12,{steps:4});await page.mouse.up();
  assert.notEqual(Number(await drawer.getByLabel("x (pt)").inputValue()),beforeX);
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("heading",{name:"Review",exact:true}).waitFor();assert.equal(state.sends,0);
  await drawer.getByRole("button",{name:"Back",exact:true}).click();await drawer.getByRole("heading",{name:"Signing fields",exact:true}).waitFor();assert.equal(await drawer.locator(".pdf-field").count(),1);
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("heading",{name:"Review",exact:true}).waitFor();
  await drawer.screenshot({path:`${evidence}/desktop-review.png`});
  await drawer.getByRole("button",{name:"Review & freeze for signing",exact:true}).click();
  const freeze=page.getByRole("dialog",{name:"Freeze this envelope for signing?",exact:true});await freeze.waitFor();await page.keyboard.press("Escape");await freeze.waitFor({state:"hidden"});assert.equal(await drawer.isVisible(),true);
  await drawer.getByRole("button",{name:"Review & freeze for signing",exact:true}).click();state.failSend=true;await freeze.getByRole("button",{name:"Confirm & freeze",exact:true}).click();await freeze.getByText("Fixture send failed. Try again.").waitFor();assert.equal(state.sends,0);
  await freeze.getByRole("button",{name:"Confirm & freeze",exact:true}).click();await freeze.waitFor({state:"hidden"});await drawer.getByText("Sent documents, fields, recipients and routing are frozen.",{exact:false}).waitFor();assert.equal(state.sends,1);
  assert.equal(state.created,1);assert.equal(state.uploads,1);assert.equal(await page.evaluate(()=>window.drawerSentinel),"preserve-dashboard");assert.equal(page.url(),`${origin}/envelopes`);
  await drawer.getByRole("button",{name:"Close",exact:true}).click();await drawer.waitFor({state:"hidden"});
  await page.getByLabel("Recipient",{exact:true}).fill("");await page.getByRole("textbox",{name:"Search envelopes"}).fill("Fixture renamed agreement");await page.locator(".document-link").filter({hasText:"Fixture renamed agreement"}).waitFor();
  assert.ok(state.workspaceReads>2);assert.deepEqual(state.blocked,[]);assert.deepEqual(state.errors,[]);
  check("creation keeps one draft/uploads through Back/Continue, blocks invalid/error steps, supports PDF dragging and explicitly confirms signing without reload");

  // Both dashboard entry points share the drawer, retain scroll and leave modified clicks alone.
  for(let i=0;i<18;i++){const copy=structuredClone(existing);copy.id=randomUUID();copy.title=`Fixture scroll agreement ${i}`;envelopes.set(copy.id,copy);}
  await page.goto(`${origin}/`);await page.getByRole("heading",{name:"Overview",exact:true}).waitFor();
  await page.getByRole("link",{name:"Create envelope",exact:true}).click();await drawer.getByLabel("Envelope title",{exact:true}).waitFor();await drawer.getByRole("button",{name:"Close",exact:true}).click();await drawer.waitFor({state:"hidden"});
  const scrollLink=page.locator(".document-link").nth(8);await scrollLink.scrollIntoViewIfNeeded();const scrollY=await page.evaluate(()=>window.scrollY);assert.ok(scrollY>0);
  await scrollLink.click();await details.getByLabel("Title",{exact:true}).waitFor();await details.getByRole("button",{name:"Close",exact:true}).focus();await page.keyboard.press("Tab");
  assert.equal(await details.evaluate(el=>el.contains(document.activeElement)),true);
  await page.keyboard.press("Escape");await details.waitFor({state:"hidden"});assert.equal(await page.evaluate(()=>window.scrollY),scrollY);
  const popupReady=context.waitForEvent("page",{timeout:10000});await scrollLink.click({modifiers:[process.platform==="darwin"?"Meta":"Control"]});const popup=await popupReady;await popup.waitForLoadState("domcontentloaded");assert.ok(popup.url().includes("/envelopes/"));assert.equal(await details.count(),0);await popup.close();
  check("Overview uses the same drawer, keyboard focus stays inside, scroll returns and modified clicks open standalone tabs");

  // Direct routes retain the workspace shell and the existing full editor.
  await page.goto(`${origin}/envelopes/${existing.id}`);await page.getByLabel("Title",{exact:true}).waitFor();assert.equal(await page.locator(".app-sidebar").count(),1);await page.getByText("Sharing",{exact:true}).waitFor();
  await page.goto(`${origin}/envelopes/new`);await page.getByLabel("Envelope title",{exact:true}).waitFor();assert.equal(await page.locator(".app-sidebar").count(),1);
  check("direct envelope and creation URLs remain usable standalone");await context.close();

  const mobile=await fixtureContext({width:390,height:844});
  await mobile.page.getByRole("link",{name:"Create envelope",exact:true}).click();const mobileDrawer=mobile.page.getByRole("dialog",{name:"Create an envelope",exact:true});await mobileDrawer.waitFor();
  const mobileBox=await mobileDrawer.boundingBox();assert.equal(mobileBox.x,0);assert.equal(mobileBox.width,390);
  await mobileDrawer.getByLabel("Envelope title",{exact:true}).fill("Fixture mobile draft");await mobileDrawer.getByRole("button",{name:"Continue",exact:true}).click();await mobileDrawer.getByRole("heading",{name:"Documents & details",exact:true}).waitFor();
  assert.equal(await mobileDrawer.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await mobileDrawer.screenshot({path:`${evidence}/mobile-documents.png`});
  await mobileDrawer.getByRole("button",{name:"Close",exact:true}).click();await mobileDrawer.waitFor({state:"hidden"});
  await mobile.page.locator(".document-link").filter({hasText:"Fixture existing agreement"}).click();const mobileDetails=mobile.page.getByRole("dialog",{name:"Envelope details",exact:true});await mobileDetails.getByLabel("Title",{exact:true}).waitFor();
  const scroll=mobileDetails.locator(".envelope-drawer-body");assert.equal(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight),true);await scroll.evaluate(el=>{el.scrollTop=400;});assert.ok(await scroll.evaluate(el=>el.scrollTop)>0);
  assert.equal(await mobileDetails.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await mobileDetails.screenshot({path:`${evidence}/mobile-details.png`});
  assert.deepEqual(mobile.state.blocked,[]);assert.deepEqual(mobile.state.errors,[]);check("mobile drawers fill the viewport, scroll internally and contain the editor");await mobile.context.close();

  for(const role of ["read-only","sender"]){
    const restricted=await fixtureContext({role});
    if(role==="sender")restricted.existing.owner_id="another-fixture-owner";
    else assert.equal(await restricted.page.getByRole("link",{name:"Create envelope",exact:true}).count(),0);
    await restricted.page.locator(".document-link").click();const view=restricted.page.getByRole("dialog",{name:"Envelope details",exact:true});await view.getByLabel("Title",{exact:true}).waitFor();
    assert.equal(await view.getByLabel("Title",{exact:true}).isDisabled(),true);assert.equal(await view.getByRole("button",{name:"Save draft",exact:true}).count(),0);assert.equal(await view.getByText("Sharing",{exact:true}).count(),0);
    assert.deepEqual(restricted.state.blocked,[]);assert.deepEqual(restricted.state.errors,[]);await restricted.context.close();
  }
  check("viewer/shared-sender drawers retain ownership and role restrictions");
  console.log(JSON.stringify({passed:checks.length,checks,evidence}));
} finally {clearTimeout(deadline);await browser.close();}
