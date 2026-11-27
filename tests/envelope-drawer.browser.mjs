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
const pdf=await PDFDocument.create();pdf.addPage([612,792]);pdf.addPage([612,792]);const bytes=Buffer.from(await pdf.save());
const browser=await chromium.launch({headless:true,...(process.platform==="darwin"?{executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}:{})});
const deadline=setTimeout(()=>void browser.close(),180000);
const checks=[];
const check=(name)=>{checks.push(name);console.log(`PASS ${name}`);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(fn,message)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(50);}throw new Error(message);};

async function fixtureContext({role="admin",width=1440,height=960,previewDocuments=false,touch=false}={}) {
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:"block",hasTouch:touch});
  const document={id:randomUUID(),name:"Fixture agreement.pdf",size:bytes.length,sha256:"0".repeat(64),geometry:Array.from({length:2},()=>({x:0,y:0,width:612,height:792,rotation:0}))};
  const recipient={id:randomUUID(),name:"Avery Morgan",email:"avery@client.test",routing_order:1,status:"pending"};
  const existing={id:randomUUID(),owner_id:"fixture-owner",owner_name:"Alex Rivera",title:"Fixture existing agreement",state:"draft",version:1,routing:"parallel",folder:"Fixture folder",tags:["fixture"],created_at:"2026-11-27T00:00:00Z",documents:[document],recipients:[recipient],fields:[{id:randomUUID(),documentId:document.id,recipientId:recipient.id,type:"signature",page:0,x:20,y:20,width:180,height:40,required:true}],events:[{id:"fixture-event",event:"envelope_created",actor:"Alex Rivera",created_at:"2026-11-27T00:15:00Z",data:{}}],outputs:[],deliveries:[]};
  if(previewDocuments)existing.documents.push({...structuredClone(document),id:randomUUID(),name:`Fixture ${"long agreement name ".repeat(12)}appendix.pdf`});
  const envelopes=new Map([[existing.id,existing]]);
  const state={role,created:0,saves:0,uploads:0,uploadTypes:[],sends:0,workspaceReads:0,failCreate:false,failSave:false,failUpload:false,failSend:false,hold:null,blocked:[],errors:[],copies:new Map()};
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
        assert.equal(Number(request.headers()["x-envelope-version"]),e.version);state.uploads++;state.uploadTypes.push(request.headers()["content-type"]);e.version++;
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

async function layout(drawer){
  const result=await drawer.evaluate(el=>{
    const rect=node=>node.getBoundingClientRect(),visible=node=>rect(node).width>0&&rect(node).height>0;
    const labels=[...el.querySelectorAll(".composer-form label")].filter(visible).map(label=>({text:label.textContent,height:rect(label).height,lineHeight:parseFloat(getComputedStyle(label).lineHeight),overflow:label.scrollWidth>label.clientWidth+1}));
    const cards=[...el.querySelectorAll('.composer-form [data-slot="card"]')].filter(visible);
    const gaps=cards.slice(1).map((card,i)=>rect(card).top-rect(cards[i]).bottom);
    const insets=cards.map(card=>rect(card).left-rect(el.querySelector(".composer-form")).left);
    const save=el.querySelector('.composer-actions button:not(.sender-preview):not(.envelope-close)'),close=el.querySelector(".envelope-close");
    return {labels,gaps,insets,closeBesideSave:!save||save.nextElementSibling===close,headingCount:el.querySelectorAll('[data-slot="dialog-title"]').length,overflow:el.scrollWidth>el.clientWidth,heading:getComputedStyle(el.querySelector(".envelope-heading")).backgroundColor,form:getComputedStyle(el.querySelector(".composer-form")).backgroundColor,stroke:getComputedStyle(el.querySelector(".composer-form")).borderWidth,preview:getComputedStyle(el.querySelector(".pdf-frame,.preview-empty")).backgroundColor};
  });
  assert.equal(result.headingCount,1);assert.equal(result.closeBesideSave,true);assert.equal(result.overflow,false);
  assert.equal(result.heading,"rgb(255, 255, 255)");assert.equal(result.preview,result.heading);assert.notEqual(result.form,result.heading);assert.equal(result.stroke,"0px");
  assert.ok(result.labels.length>5);assert.deepEqual(result.labels.filter(label=>label.height>label.lineHeight+1||label.overflow),[]);
  assert.ok(result.gaps.every(gap=>gap>=24),JSON.stringify(result.gaps));assert.ok(result.insets.every(inset=>inset===result.insets[0]));
  assert.equal(await drawer.getByRole("button",{name:"Sender preview",exact:true}).getAttribute("data-variant"),"ghost");
  assert.equal(await drawer.getByRole("button",{name:"Choose files",exact:true}).getAttribute("data-variant"),"default");
  assert.equal(await drawer.locator('input[type="file"]').evaluate(el=>getComputedStyle(el).clipPath),"inset(50%)");
}

async function previewLayout(drawer,{truncated}={}){
  await drawer.locator(".preview-surface").scrollIntoViewIfNeeded();
  await drawer.locator(".pdf-loading").waitFor({state:"hidden"});
  const result=await drawer.locator(".preview-surface").evaluate(el=>{
    const rect=node=>{const {x,y,width,height,right,bottom}=node.getBoundingClientRect();return {x,y,width,height,right,bottom};};
    const toolbar=el.querySelector(".preview-toolbar"),frame=el.querySelector(".pdf-frame"),canvas=el.querySelector(".pdf-canvas"),triggers=[...toolbar.querySelectorAll('[data-slot="select-trigger"]')];
    return {toolbar:rect(toolbar),frame:rect(frame),canvas:rect(canvas),position:getComputedStyle(toolbar).position,background:getComputedStyle(frame).backgroundColor,overflow:el.scrollWidth>el.clientWidth,triggers:triggers.map(trigger=>{
      const value=trigger.querySelector('[data-slot="select-value"]'),icon=trigger.querySelector("svg"),style=getComputedStyle(trigger);
      return {box:rect(trigger),gap:rect(icon).x-rect(value).right,padding:[style.paddingLeft,style.paddingRight],border:style.borderWidth,background:style.backgroundColor,justify:style.justifyContent,truncated:value.scrollWidth>value.clientWidth};
    })};
  });
  assert.equal(result.position,"absolute");assert.equal(result.background,"rgb(255, 255, 255)");assert.equal(result.overflow,false);
  assert.ok(result.toolbar.y>=result.frame.y&&result.toolbar.bottom<=result.canvas.y,"Selectors must stay in the preview gutter, above PDF content");
  const [document,page]=result.triggers;assert.equal(result.triggers.length,2);
  assert.ok(document.box.x>=result.frame.x&&page.box.right<=result.frame.right);assert.ok(document.box.right+15<=page.box.x);
  assert.equal(document.box.y,page.box.y);if(truncated!==undefined)assert.equal(document.truncated,truncated);
  for(const trigger of result.triggers){
    assert.ok(Math.abs(trigger.gap-4)<0.1,JSON.stringify(trigger));assert.deepEqual(trigger.padding,["0px","0px"]);
    assert.equal(trigger.border,"0px");assert.equal(trigger.background,"rgba(0, 0, 0, 0)");assert.match(trigger.justify,/^(flex|flow)-start$/);assert.ok(trigger.box.height>=44);
  }
}

try {
  if(process.env.ACCORD_DRAWER_PREVIEW_ONLY!=="1"){
  const {context,page,state,envelopes,existing}=await fixtureContext();
  const drawer=page.locator(".envelope-drawer");
  const details=page.locator(".envelope-drawer");
  await page.getByRole("textbox",{name:"Search envelopes"}).fill("Fixture");
  await page.getByRole("button",{name:"Additional filters"}).click();await page.getByLabel("Recipient",{exact:true}).fill("Avery");
  await page.evaluate(()=>{window.drawerSentinel="preserve-dashboard";});
  await page.locator(".document-link").click();await details.getByLabel("Title",{exact:true}).waitFor();
  await details.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const box=await details.boundingBox();await details.screenshot({path:`${evidence}/desktop-details.png`});assert.equal(box.x,144);assert.equal(box.width,1296);
  assert.equal(await details.locator(".app-sidebar,.workspace-loading,.app-layout").count(),0);
  assert.equal(await page.getByRole("dialog",{name:existing.title,exact:true}).count(),1);
  assert.equal(await details.getByText("Envelope details",{exact:true}).count(),0);
  assert.equal(await details.getByText("Review documents, recipients and signing activity.",{exact:true}).count(),0);
  assert.equal(await details.locator(".envelope-title-row .status").textContent(),"Draft");
  await layout(details);
  const headerBox=await details.locator(".envelope-heading").boundingBox();
  await details.getByRole("tabpanel",{name:"Details",exact:true}).evaluate(el=>{el.scrollTop=600;});
  assert.deepEqual(await details.locator(".envelope-heading").boundingBox(),headerBox);
  assert.ok((await details.locator(".preview-toolbar").boundingBox()).y>=headerBox.y+headerBox.height);
  await details.getByRole("tabpanel",{name:"Details",exact:true}).evaluate(el=>{el.scrollTop=0;});
  assert.equal(await details.getByRole("tab",{name:"Details",exact:true}).getAttribute("aria-selected"),"true");
  await details.getByRole("combobox",{name:"Preview page",exact:true}).click();await page.getByRole("option",{name:"Page 2",exact:true}).click();
  await details.getByLabel("PDF page 2",{exact:true}).waitFor();
  await details.locator("canvas").evaluate(el=>{window.retainedDrawerCanvas=el;});
  await details.getByLabel("Name",{exact:true}).fill("Avery retained edit");
  await details.getByLabel("Completion copy email",{exact:true}).fill("copy@client.test");
  await details.getByLabel("Template name",{exact:true}).fill("Retained template");
  await details.getByRole("button",{name:"Sender preview",exact:true}).click();
  await details.getByRole("tab",{name:"Activity",exact:true}).click();
  assert.equal(await details.getByRole("tabpanel",{name:"Details",exact:true}).isVisible(),false);
  const activity=details.getByRole("tabpanel",{name:"Activity",exact:true});await activity.getByText("envelope created",{exact:true}).waitFor();
  assert.equal(await activity.locator("time").textContent(),"2026-11-27T00:15:00.000Z");assert.equal(await activity.getByText("Alex Rivera",{exact:true}).count(),1);
  await details.screenshot({path:`${evidence}/desktop-activity.png`});
  await details.getByRole("button",{name:"Close",exact:true}).click();
  const discard=page.getByRole("alertdialog",{name:"Discard unsaved changes?"});await discard.waitFor();await discard.getByRole("button",{name:"Keep editing"}).click();
  await details.getByRole("tab",{name:"Details",exact:true}).focus();await page.keyboard.press("ArrowRight");
  assert.equal(await details.getByRole("tab",{name:"Activity",exact:true}).getAttribute("aria-selected"),"true");
  await page.keyboard.press("ArrowLeft");await details.getByLabel("Title",{exact:true}).waitFor();
  assert.equal(await details.getByLabel("Name",{exact:true}).inputValue(),"Avery retained edit");
  assert.equal(await details.getByLabel("Completion copy email",{exact:true}).inputValue(),"copy@client.test");
  assert.equal(await details.getByLabel("Template name",{exact:true}).inputValue(),"Retained template");
  assert.equal(await details.getByRole("combobox",{name:"Preview page",exact:true}).textContent(),"Page 2");
  assert.equal(await details.locator("canvas").evaluate(el=>window.retainedDrawerCanvas===el),true);
  assert.equal(await details.getByRole("button",{name:"Edit fields",exact:true}).count(),1);
  await details.getByRole("button",{name:"Edit fields",exact:true}).click();
  check("single real-title header, adjacent guarded Close, white preview, muted form, aligned labels and spaced widgets; keyboard tabs retain PDF, preview, copy and template edits with exact activity timestamps");
  await details.getByLabel("Title",{exact:true}).fill("Fixture unsaved title");await page.keyboard.press("Escape");
  await discard.waitFor();await discard.getByRole("button",{name:"Keep editing"}).click();
  assert.equal(await details.getByLabel("Title",{exact:true}).inputValue(),"Fixture unsaved title");
  await details.getByRole("button",{name:"Close",exact:true}).click();await discard.getByRole("button",{name:"Discard changes"}).click();await details.waitFor({state:"hidden"});
  assert.equal(await page.getByRole("textbox",{name:"Search envelopes"}).inputValue(),"Fixture");assert.equal(await page.getByLabel("Recipient",{exact:true}).inputValue(),"Avery");
  assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains("document-link")),true);
  await page.getByRole("link",{name:`Open ${existing.title}`,exact:true}).click();await details.getByLabel("Title",{exact:true}).waitFor();
  await page.keyboard.press("Escape");await details.waitFor({state:"hidden"});
  check("desktop title/Open drawers use 90% width, confirm unsaved dismissal, restore focus and preserve filters");

  await page.getByRole("link",{name:"Create envelope",exact:true}).click();await drawer.getByLabel("Envelope title",{exact:true}).fill("Fixture new agreement");
  assert.equal(await page.getByRole("dialog",{name:"Create an envelope",exact:true}).count(),1);assert.equal(await drawer.getByRole("tab").count(),0);assert.equal(await drawer.locator('[data-slot="dialog-title"]').count(),1);
  assert.equal(state.created,0);assert.equal(await drawer.getByText("1. Documents & details",{exact:true}).count(),0);
  state.failCreate=true;await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByText("Fixture create failed. Try again.").waitFor();assert.equal(state.created,0);
  let release;state.hold=new Promise(resolve=>{release=resolve;});
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("button",{name:"Creating…"}).waitFor();await drawer.locator("form").evaluate(form=>{form.requestSubmit();form.requestSubmit();});await page.keyboard.press("Escape");assert.equal(await drawer.isVisible(),true);
  assert.equal(await drawer.getByRole("button",{name:"Close",exact:true}).isDisabled(),true);release();state.hold=null;
  await drawer.getByRole("heading",{name:"Documents & details",exact:true}).waitFor();assert.equal(state.created,1);
  assert.equal(await page.getByRole("dialog",{name:"Fixture new agreement",exact:true}).count(),1);assert.equal(await drawer.getByRole("tab").count(),0);assert.equal(await drawer.locator('[data-slot="dialog-title"]').count(),1);
  const created=[...envelopes.values()].find(e=>e.id!==existing.id);assert.ok(created);
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByText("Add at least one PDF or DOCX before continuing.").waitFor();
  state.failUpload=true;await drawer.getByLabel("Add private PDFs or DOCX").setInputFiles({name:"Fixture upload.pdf",mimeType:"application/pdf",buffer:bytes});await drawer.getByText("Fixture upload failed. Try again.").waitFor();
  await drawer.getByLabel("Add private PDFs or DOCX").setInputFiles({name:"Fixture upload.pdf",mimeType:"application/pdf",buffer:bytes});await wait(()=>state.uploads===1,"Upload did not finish");
  await drawer.getByLabel("Folder",{exact:true}).fill("Saved fixture folder");
  await drawer.getByRole("button",{name:"Back",exact:true}).click();await drawer.getByLabel("Envelope title",{exact:true}).fill("Fixture renamed agreement");
  await drawer.getByRole("button",{name:"Continue",exact:true}).click();await drawer.getByRole("heading",{name:"Documents & details",exact:true}).waitFor();assert.equal(await drawer.getByLabel("Folder",{exact:true}).inputValue(),"Saved fixture folder");
  assert.equal(await drawer.locator(".notice-unsaved").textContent(),"Current step saved. Later steps have unsaved changes.");
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
  const freeze=page.getByRole("dialog",{name:"Freeze this envelope for signing?",exact:true}),review=drawer.getByRole("button",{name:"Review & freeze for signing",exact:true});
  const draftBeforeEscape=structuredClone(created);
  for(let attempt=0;attempt<3;attempt++){
    await review.click();await freeze.waitFor();await page.keyboard.press("Escape");await freeze.waitFor({state:"detached"});
    assert.equal(await drawer.isVisible(),true);assert.equal(await drawer.getAttribute("data-state"),"open");assert.equal(await page.getByRole("alertdialog").count(),0);
    assert.deepEqual(created,draftBeforeEscape);assert.equal(state.sends,0);
    await page.waitForFunction(()=>document.activeElement?.tagName==="BUTTON"&&document.activeElement.textContent?.includes("Review & freeze for signing"));
    assert.equal(await page.locator('[data-slot="dialog-overlay"]').count(),1);
  }
  await drawer.getByRole("button",{name:"Review & freeze for signing",exact:true}).click();state.failSend=true;await freeze.getByRole("button",{name:"Confirm & freeze",exact:true}).click();await freeze.getByText("Fixture send failed. Try again.").waitFor();assert.equal(state.sends,0);
  let releaseFreeze;state.hold=new Promise(resolve=>{releaseFreeze=resolve;});
  await freeze.getByRole("button",{name:"Confirm & freeze",exact:true}).click();await freeze.getByRole("button",{name:"Saving…",exact:true}).waitFor();await page.keyboard.press("Escape");
  assert.equal(await freeze.getAttribute("data-state"),"open");assert.equal(await page.locator(".envelope-drawer").getAttribute("data-state"),"open");assert.equal(state.sends,0);
  releaseFreeze();state.hold=null;await freeze.waitFor({state:"hidden"});await drawer.getByText("Sent documents, fields, recipients and routing are frozen.",{exact:false}).waitFor();assert.equal(state.sends,1);
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
  await mobile.page.getByRole("link",{name:"Create envelope",exact:true}).click();const mobileDrawer=mobile.page.locator(".envelope-drawer");await mobileDrawer.waitFor();
  await mobileDrawer.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const mobileBox=await mobileDrawer.boundingBox();assert.equal(mobileBox.x,0);assert.equal(mobileBox.width,390);
  await mobileDrawer.getByLabel("Envelope title",{exact:true}).fill("Fixture mobile draft");await mobileDrawer.getByRole("button",{name:"Continue",exact:true}).click();await mobileDrawer.getByRole("heading",{name:"Documents & details",exact:true}).waitFor();
  assert.equal(await mobileDrawer.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await mobileDrawer.screenshot({path:`${evidence}/mobile-documents.png`});
  await mobileDrawer.getByRole("button",{name:"Close",exact:true}).click();await mobileDrawer.waitFor({state:"hidden"});
  await mobile.page.locator(".document-link").filter({hasText:"Fixture existing agreement"}).click();const mobileDetails=mobile.page.locator(".envelope-drawer");await mobileDetails.getByLabel("Title",{exact:true}).waitFor();
  await layout(mobileDetails);
  await mobileDetails.getByLabel("Name",{exact:true}).fill("Retained mobile recipient");await mobileDetails.getByRole("tab",{name:"Activity",exact:true}).click();await mobileDetails.getByText("envelope created",{exact:true}).waitFor();await mobileDetails.getByRole("tab",{name:"Details",exact:true}).click();assert.equal(await mobileDetails.getByLabel("Name",{exact:true}).inputValue(),"Retained mobile recipient");
  const scroll=mobileDetails.getByRole("tabpanel",{name:"Details",exact:true});assert.equal(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight),true);await scroll.evaluate(el=>{el.scrollTop=400;});assert.ok(await scroll.evaluate(el=>el.scrollTop)>0);
  assert.equal(await mobileDetails.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await mobileDetails.screenshot({path:`${evidence}/mobile-details.png`});
  assert.deepEqual(mobile.state.blocked,[]);assert.deepEqual(mobile.state.errors,[]);check("mobile drawers fill the viewport, scroll internally and contain the editor");await mobile.context.close();

  for(const role of ["read-only","sender"]){
    const restricted=await fixtureContext({role});
    if(role==="sender")restricted.existing.owner_id="another-fixture-owner";
    else assert.equal(await restricted.page.getByRole("link",{name:"Create envelope",exact:true}).count(),0);
    await restricted.page.locator(".document-link").click();const view=restricted.page.getByRole("dialog",{name:restricted.existing.title,exact:true});await view.getByLabel("Title",{exact:true}).waitFor();
    assert.equal(await view.getByLabel("Title",{exact:true}).isDisabled(),true);assert.equal(await view.getByRole("button",{name:"Save draft",exact:true}).count(),0);assert.equal(await view.getByText("Sharing",{exact:true}).count(),0);
    await view.getByRole("tab",{name:"Activity",exact:true}).click();await view.getByText("envelope created",{exact:true}).waitFor();assert.equal(await view.locator("time").textContent(),"2026-11-27T00:15:00.000Z");
    assert.deepEqual(restricted.state.blocked,[]);assert.deepEqual(restricted.state.errors,[]);await restricted.context.close();
  }
  check("viewer/shared-sender drawers retain ownership and role restrictions");
  const uploads=await fixtureContext();await uploads.page.locator(".document-link").click();const uploadDrawer=uploads.page.locator(".envelope-drawer");await uploadDrawer.getByLabel("Title",{exact:true}).waitFor();
  const chooserReady=uploads.page.waitForEvent("filechooser");await uploadDrawer.getByRole("button",{name:"Choose files",exact:true}).click();const chooser=await chooserReady;assert.equal(chooser.isMultiple(),true);
  await chooser.setFiles([{name:"Fictional PDF.pdf",mimeType:"application/pdf",buffer:bytes},{name:"Fictional DOCX.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",buffer:Buffer.from("Fictional intercepted DOCX")}]);
  await wait(()=>uploads.state.uploads===2,"Multiple uploads did not finish");await uploadDrawer.getByText(/Documents saved privately;/).waitFor();
  assert.deepEqual(uploads.state.uploadTypes,["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  assert.match(await uploadDrawer.locator("#upload-files").textContent(),/Fictional PDF.pdf, Fictional DOCX.docx/);
  await uploadDrawer.getByLabel("Add private PDFs or DOCX").setInputFiles({name:"Too large.pdf",mimeType:"application/pdf",buffer:Buffer.alloc(8*1024*1024+1)});await uploadDrawer.getByText("Too large.pdf exceeds 8 MB",{exact:true}).waitFor();assert.equal(uploads.state.uploads,2);
  for(const width of [1280,1024,768,320]){await uploads.page.setViewportSize({width,height:900});await layout(uploadDrawer);}
  await uploadDrawer.getByLabel("Title",{exact:true}).fill("Saved from Activity");await uploadDrawer.getByRole("tab",{name:"Activity",exact:true}).click();
  let releaseActivitySave;uploads.state.hold=new Promise(resolve=>{releaseActivitySave=resolve;});await uploadDrawer.getByRole("button",{name:"Save draft",exact:true}).click();
  await wait(()=>uploadDrawer.getByRole("button",{name:"Close",exact:true}).isDisabled(),"Activity save did not guard Close");await uploads.page.keyboard.press("Escape");assert.equal(await uploadDrawer.getAttribute("data-state"),"open");
  releaseActivitySave();uploads.state.hold=null;await uploadDrawer.getByText("Draft saved to the database",{exact:true}).waitFor();assert.equal(uploads.state.saves,1);assert.equal(uploads.existing.title,"Saved from Activity");
  assert.deepEqual(uploads.state.blocked,[]);assert.deepEqual(uploads.state.errors,[]);await uploads.context.close();
  check("Choose files opens the multiple-file picker, preserves PDF/DOCX request types and version sequencing, shows names below, rejects over 8 MB locally and contains labels/widgets from 320px to desktop");
  }
  for(const width of [1440,390,320]){
    const controls=await fixtureContext({width,height:960,previewDocuments:true,touch:width<500});
    const p=controls.page;await p.locator(".document-link").click();const view=p.locator(".envelope-drawer");await view.getByLabel("Title",{exact:true}).waitFor();
    await previewLayout(view);
    const documentMenu=view.getByRole("combobox",{name:"Preview document",exact:true}),pageMenu=view.getByRole("combobox",{name:"Preview page",exact:true});
    const activate=async locator=>width<500?locator.tap():locator.click();
    await activate(pageMenu.locator('[data-slot="select-value"]'));await activate(p.getByRole("option",{name:"Page 2",exact:true}));await view.getByLabel("PDF page 2",{exact:true}).waitFor();
    await activate(documentMenu.locator('[data-slot="select-value"]'));await p.getByRole("option",{name:controls.existing.documents[0].name,exact:true}).waitFor();
    await p.keyboard.press("Escape");assert.equal(await view.getAttribute("data-state"),"open");
    await activate(documentMenu);await activate(p.getByRole("option",{name:controls.existing.documents[1].name,exact:true}));
    assert.equal(await pageMenu.textContent(),"Page 1");await view.getByLabel("PDF page 1",{exact:true}).waitFor();await previewLayout(view,{truncated:true});
    await documentMenu.focus();await p.keyboard.press("Tab");assert.equal(await pageMenu.evaluate(el=>document.activeElement===el),true);
    assert.equal(await pageMenu.evaluate(el=>getComputedStyle(el).outlineWidth),"2px");
    await p.keyboard.press("Enter");const firstPage=p.getByRole("option",{name:"Page 1",exact:true}),secondPage=p.getByRole("option",{name:"Page 2",exact:true});await firstPage.waitFor();
    await wait(()=>firstPage.evaluate(el=>document.activeElement===el),"Selected page option did not receive keyboard focus");await p.keyboard.press("ArrowDown");
    await wait(()=>secondPage.evaluate(el=>document.activeElement===el),"ArrowDown did not focus the next page");await p.keyboard.press("Enter");
    assert.equal(await pageMenu.textContent(),"Page 2");await view.getByLabel("PDF page 2",{exact:true}).waitFor();
    await view.getByRole("tab",{name:"Activity",exact:true}).click();await view.getByRole("tab",{name:"Details",exact:true}).click();
    assert.equal(await documentMenu.textContent(),controls.existing.documents[1].name);assert.equal(await pageMenu.textContent(),"Page 2");
    await view.getByLabel("Title",{exact:true}).fill(`Fixture blue notice ${width}`);
    const notice=view.locator(".notice");assert.equal(await notice.getAttribute("role"),"status");assert.equal(await notice.textContent(),"Unsaved changes");
    assert.equal(await notice.locator("svg.lucide-info").getAttribute("aria-hidden"),"true");
    const info=await notice.evaluate(el=>{const icon=el.querySelector("svg"),text=el.querySelector("span"),style=getComputedStyle(el),paint=new OffscreenCanvas(1,1).getContext("2d");paint.fillStyle=style.backgroundColor;paint.fillRect(0,0,1,1);return {color:style.color,background:[...paint.getImageData(0,0,1,1).data],iconLeft:icon.getBoundingClientRect().right<text.getBoundingClientRect().left};});
    assert.equal(info.color,"rgb(29, 78, 216)");assert.deepEqual(info.background,[238,243,253,255]);assert.equal(info.iconLeft,true);
    await view.getByRole("button",{name:"Close",exact:true}).click();const discard=p.getByRole("alertdialog",{name:"Discard unsaved changes?"});await discard.getByRole("button",{name:"Keep editing",exact:true}).click();
    let finishSave;controls.state.hold=new Promise(resolve=>{finishSave=resolve;});await view.getByRole("button",{name:"Save draft",exact:true}).click();
    await wait(()=>documentMenu.isDisabled(),"Document selector was not disabled while saving");assert.equal(await pageMenu.isDisabled(),true);assert.equal(await view.getByRole("button",{name:"Close",exact:true}).isDisabled(),true);
    await p.keyboard.press("Escape");assert.equal(await view.getAttribute("data-state"),"open");finishSave();controls.state.hold=null;
    await notice.getByText("Draft saved to the database",{exact:true}).waitFor();assert.equal(await notice.getAttribute("class"),"notice");assert.equal(await notice.locator("svg").count(),0);
    assert.equal(await documentMenu.isDisabled(),false);assert.equal(await pageMenu.isDisabled(),false);
    await activate(documentMenu);await activate(p.getByRole("option",{name:controls.existing.documents[0].name,exact:true}));await view.getByLabel("PDF page 1",{exact:true}).waitFor();
    await view.locator(".pdf-loading").waitFor({state:"hidden"});const field=view.getByRole("button",{name:"signature field required",exact:true});await field.click();assert.match(await field.getAttribute("class"),/selected/);
    assert.equal(await view.getByLabel("x (pt)",{exact:true}).inputValue(),"20");
    await previewLayout(view);await documentMenu.hover();await view.screenshot({path:`${evidence}/compact-preview-${width}.png`});
    assert.equal(controls.state.saves,1);assert.equal(controls.state.sends,0);assert.deepEqual(controls.state.blocked,[]);assert.deepEqual(controls.state.errors,[]);await controls.context.close();
    check(`${width}px preview overlays stay above readable PDFs with text-only 4px chevrons, long-name truncation, touch/keyboard menus, document reset, retained tabs, blue live unsaved notice and preserved save/dismiss guards`);
  }
  console.log(JSON.stringify({passed:checks.length,checks,evidence}));
} finally {clearTimeout(deadline);await browser.close();}
