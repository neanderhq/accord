// Use the existing managed preview. All APIs are fictional, isolated browser
// fixtures; unknown API calls and every non-fixture write are blocked.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

let debug;
function gate(){let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};}

export async function navigationFixture(browser,origin,{role="admin",width=1440,reducedMotion="no-preference"}={}){
 assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
 const context=await browser.newContext({viewport:{width,height:960},serviceWorkers:"block",reducedMotion});
 const envelope={id:"fixture-envelope",owner_id:"fixture-owner",owner_name:"Alex Rivera",title:"Fictional navigation agreement",state:"draft",version:1,routing:"parallel",folder:"",tags:[],created_at:"2026-11-27T00:00:00Z",documents:[],recipients:[],fields:[],events:[],outputs:[],deliveries:[]};
 const state={role,company:"fixture-company",user:"fixture-owner",status:200,resourceStatus:200,mutationStatus:200,workspaceReads:0,active:0,maxActive:0,requests:[],blocked:[],errors:[],documents:0,saves:0,envelopes:[envelope],gates:new Map()};
 const json=(route,value,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
 await context.addInitScript(()=>{window.documentSentinel=crypto.randomUUID();window.logoInsertions=0;new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element&&(node.matches(".workspace-loading")||node.querySelector(".workspace-loading")))window.logoInsertions++;}).observe(document,{subtree:true,childList:true});});
 await context.route("**/*",async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method(),path=url.pathname,write=!["GET","HEAD"].includes(method);
  if(url.origin!==origin){if(write)state.blocked.push(`${method} external`);return route.abort();}
  if(!path.startsWith("/api/")){
   if(write){state.blocked.push(`${method} ${path}`);return route.abort();}
   if(request.isNavigationRequest()&&request.resourceType()==="document")state.documents++;
   const held=state.gates.get(`route:${path}`);if(held&&request.headers().rsc)await held.promise;
   return route.continue();
  }
  state.requests.push(`${method} ${path}`);
  if(path==="/api/workspace"&&method==="GET"){
   state.workspaceReads++;state.active++;state.maxActive=Math.max(state.maxActive,state.active);
   // Capture a response before waiting, so revocation tests exercise old data.
   const status=state.status,value=status===200?{company:{id:state.company,name:"Northstar Studio"},role:state.role,userId:state.user,verificationOnly:true,developmentLinks:false,envelopes:structuredClone(state.envelopes)}:{error:"Fictional workspace access denied.",code:status===401?"SIGN_IN_REQUIRED":"MEMBERSHIP_REQUIRED"};
   const held=state.gates.get(path);if(held)await held.promise;state.active--;return json(route,value,status);
  }
  const held=state.gates.get(path);if(held)await held.promise;
  if(method==="GET"){
   if(state.resourceStatus!==200)return json(route,{error:"Fictional resource unavailable.",code:"FIXTURE_FAILURE"},state.resourceStatus);
   if(path==="/api/team")return json(route,[]);
   if(path==="/api/manage/settings")return json(route,{brand_name:"Northstar Studio",brand_color:"#2563eb",logo:null,retention_days:365,webhook_url:null,webhook_configured:false,emailConfigured:false,emailDispatchEnabled:false,schedulerConfigured:false,webhookDispatchEnabled:false});
   if(path==="/api/manage/templates")return json(route,[{id:"fixture-template",name:"Fixture reusable agreement",owner_id:"fixture-owner",created_at:envelope.created_at,roles:[]}]);
   if(["/api/manage/contacts","/api/manage/colleagues","/api/manage/bulk-send","/api/manage/signing-links"].includes(path))return json(route,[]);
   const match=path.match(/^\/api\/envelopes\/([^/]+)(?:\/(.+))?$/),item=match&&state.envelopes.find(e=>e.id===match[1]);
   if(item){if(!match[2])return json(route,item);if(match[2]==="shares")return json(route,[]);if(match[2]==="completion-copy")return json(route,{version:item.version,copy:null});}
  }
  if(path==="/api/manage/template-use"&&method==="POST"){
   assert.equal(request.postDataJSON().templateId,"fixture-template");state.envelopes.push({...structuredClone(envelope),id:"fixture-created",title:request.postDataJSON().title});return json(route,{id:"fixture-created"});
  }
  if(path===`/api/envelopes/${envelope.id}`&&method==="PATCH"){
   if(state.mutationStatus!==200)return json(route,{error:"Fictional editor access denied.",code:"MEMBERSHIP_REQUIRED"},state.mutationStatus);
   const body=request.postDataJSON();assert.equal(body.version,envelope.version);state.saves++;Object.assign(envelope,body,{version:envelope.version+1});return json(route,envelope);
  }
  state.blocked.push(`${method} ${path}`);return json(route,{error:"Non-fixture request blocked."},418);
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror",error=>state.errors.push(error.message));
 debug={page,state};
 const waitReady=async()=>{await page.locator('.document-link').first().waitFor();await page.locator('main[aria-busy="false"]').waitFor();};
 const start=async(path="/envelopes")=>{await page.goto(`${origin}${path}`);if(path==="/envelopes")await waitReady();};
 const identity=async()=>page.evaluate(()=>({sentinel:window.documentSentinel,timeOrigin:performance.timeOrigin,navigation:performance.getEntriesByType("navigation").length,logos:window.logoInsertions}));
 const remember=async()=>page.evaluate(()=>{window.retainedSidebar=document.querySelector(".app-sidebar");window.retainedHeader=document.querySelector(".topbar");});
 const stable=async()=>{assert.equal(await page.evaluate(()=>window.retainedSidebar===document.querySelector(".app-sidebar")&&window.retainedHeader===document.querySelector(".topbar")),true);assert.equal(await page.locator(".workspace-loading").count(),0);};
 const finish=async()=>{assert.deepEqual(state.blocked,[]);assert.deepEqual(state.errors,[]);await context.close();};
 return {context,page,state,start,identity,remember,stable,finish,waitReady};
}

export async function runNavigationTests(){
const origin=process.env.ACCORD_NAVIGATION_ORIGIN||"http://127.0.0.1:56327";
const evidence=".next/navigation-review";
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.platform==="darwin"?{executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}:{})});
const deadline=setTimeout(()=>void browser.close(),180000);
const fixture=options=>navigationFixture(browser,origin,options),checks=[];
function pass(name){checks.push(name);console.log(`PASS ${name}`);}
try{
 const f=await fixture(),{page,state}=f;
 const boot=gate();state.gates.set("/api/workspace",boot);
 await page.goto(`${origin}/envelopes`,{waitUntil:"domcontentloaded"});await page.locator(".workspace-loading").waitFor();assert.equal(await page.locator(".app-sidebar").count(),0);boot.release();state.gates.delete("/api/workspace");await f.waitReady();
 pass("initial document load shows the Accord star until workspace bootstrap finishes");
 await f.remember();const initial=await f.identity(),documentCount=state.documents;
 const slow=gate();state.gates.set("/api/team",slow);state.gates.set("route:/team",slow);
 await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Team",exact:true}).click();
 await page.locator('main .content-loading [data-slot="skeleton"]').first().waitFor();await f.stable();assert.equal(await page.locator('main [role="status"][aria-busy="true"]').count()>0,true);
 await page.screenshot({path:`${evidence}/desktop-soft-loading.png`});slow.release();state.gates.clear();await page.getByRole("heading",{name:"Team",exact:true}).waitFor();await page.getByText("Team members",{exact:true}).waitFor();await f.stable();
 await page.goBack();await page.getByRole("heading",{name:"Envelopes",exact:true}).waitFor();await f.stable();await page.goForward();await page.getByRole("heading",{name:"Team",exact:true}).waitFor();await f.stable();
 assert.deepEqual(await f.identity(),initial);assert.equal(state.documents,documentCount);assert.ok(state.workspaceReads>=3);assert.equal(state.maxActive,1);
 pass("slow soft routes and back/forward retain shell DOM identity with zero document reloads");
 await page.locator(".settings-link").click();await page.getByRole("heading",{name:"Contacts",exact:true}).waitFor();await page.getByLabel("Contact name",{exact:true}).waitFor();
 await page.locator(".settings-nav").evaluate(node=>{window.retainedSettingsNav=node;});
 const settingsGate=gate();state.gates.set("/api/manage/settings",settingsGate);
 await page.getByRole("navigation",{name:"Settings navigation"}).getByRole("link",{name:"Branding",exact:true}).click();await page.locator('.settings-content .content-loading').waitFor();await f.stable();
 assert.equal(await page.locator(".settings-nav").evaluate(node=>node===window.retainedSettingsNav),true);assert.equal(await page.getByRole("heading",{name:"Branding",exact:true}).count(),1);
 await page.screenshot({path:`${evidence}/settings-content-loading.png`});settingsGate.release();state.gates.clear();await page.getByLabel("Brand name",{exact:true}).waitFor();
 state.resourceStatus=503;await page.getByRole("navigation",{name:"Settings navigation"}).getByRole("link",{name:"Contacts",exact:true}).click();await page.getByText("Fictional resource unavailable.",{exact:true}).waitFor();await f.stable();assert.equal(await page.locator(".settings-nav").count(),1);
 state.resourceStatus=200;await page.getByRole("button",{name:"Try again",exact:true}).click();await page.getByLabel("Contact name",{exact:true}).waitFor();
 pass("settings keeps its navigation and heading through slow data, errors and local retry");
 await page.getByRole("navigation",{name:"Settings navigation"}).getByRole("link",{name:"Reusable templates",exact:true}).click();await page.getByRole("button",{name:"Use template",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Create envelope",exact:true}).click();await page.getByLabel("Title",{exact:true}).waitFor();assert.ok(page.url().endsWith("/envelopes/fixture-created"));assert.equal(await page.locator(".nav-count").textContent(),"2");await f.stable();assert.equal(state.documents,documentCount);assert.equal((await f.identity()).sentinel,initial.sentinel);
 pass("template success navigates with the client router and refreshes workspace counts");
 await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:/Envelopes/}).click();await f.waitReady();
 const envelopeGate=gate();state.gates.set("/api/envelopes/fixture-envelope",envelopeGate);await page.locator('.document-link[href="/envelopes/fixture-envelope"]').click();await page.locator(".envelope-drawer .content-loading").waitFor();await f.stable();envelopeGate.release();state.gates.clear();
 const drawer=page.locator(".envelope-drawer");await drawer.getByLabel("Title",{exact:true}).fill("Fictional unsaved drawer title");await drawer.getByRole("button",{name:"Close",exact:true}).click();await page.getByRole("alertdialog").waitFor();await page.getByRole("button",{name:"Keep editing",exact:true}).click();assert.equal(await drawer.getByLabel("Title",{exact:true}).inputValue(),"Fictional unsaved drawer title");
 const saving=gate();state.gates.set("/api/envelopes/fixture-envelope",saving);await drawer.getByRole("button",{name:"Save draft",exact:true}).click();assert.equal(await drawer.getByRole("button",{name:"Close",exact:true}).isDisabled(),true);await page.keyboard.press("Escape");assert.equal(await drawer.count(),1);saving.release();state.gates.clear();await drawer.getByText("Draft saved to the database",{exact:true}).waitFor();await drawer.getByRole("button",{name:"Close",exact:true}).click();await drawer.waitFor({state:"hidden"});await f.waitReady();await f.stable();
 pass("drawer content shimmers locally; dirty and busy dismissal guards and refresh survive");
 await page.goto(`${origin}/envelopes/fixture-envelope`);await page.getByLabel("Title",{exact:true}).waitFor();await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Team",exact:true}).click();await page.getByRole("heading",{name:"Team",exact:true}).waitFor();await page.goBack();await page.getByLabel("Title",{exact:true}).waitFor();await page.getByLabel("Title",{exact:true}).fill("Fictional dirty standalone");
 page.once("dialog",dialog=>dialog.dismiss());await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Team",exact:true}).click();assert.equal(await page.getByLabel("Title",{exact:true}).inputValue(),"Fictional dirty standalone");
 const canceledBack=page.waitForEvent("dialog").then(dialog=>dialog.dismiss());await page.evaluate(()=>history.back());await canceledBack;assert.equal(await page.getByLabel("Title",{exact:true}).inputValue(),"Fictional dirty standalone");
 page.once("dialog",dialog=>dialog.accept());await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:/Envelopes/}).click();await f.waitReady();
 pass("standalone dirty editors guard client links and browser back without silent data loss");
 const refreshGate=gate();state.gates.set("/api/workspace",refreshGate);await page.reload({waitUntil:"domcontentloaded"});await page.locator(".workspace-loading").waitFor();refreshGate.release();state.gates.clear();await f.waitReady();
 pass("hard refresh shows the initial logo again");await f.finish();

 for(const status of [401,403]){
  const f=await fixture();await f.start();await f.page.goto(`${origin}/envelopes/fixture-envelope`);await f.page.getByLabel("Title",{exact:true}).waitFor();
  const held=gate();f.state.gates.set("/api/workspace",held);await f.page.evaluate(()=>window.dispatchEvent(new Event("focus")));await f.page.waitForFunction(()=>document.querySelector('main[aria-busy="true"]'));
  f.state.mutationStatus=status;await f.page.getByRole("button",{name:"Save draft",exact:true}).click();
  if(status===401)await f.page.getByRole("heading",{name:"Welcome back",exact:true}).waitFor();else await f.page.getByText("Fictional editor access denied.",{exact:true}).waitFor();
  assert.equal(await f.page.locator(".envelope-editor").count(),0);assert.equal(await f.page.getByLabel("Title",{exact:true}).count(),0);held.release();f.state.gates.clear();await f.page.waitForTimeout(80);assert.equal(await f.page.locator(".envelope-editor").count(),0);assert.equal(await f.page.locator(".workspace-loading").count(),0);await f.finish();
  pass(`${status} invalidates the editor and rejects an older successful workspace response`);
 }

 const roles=await fixture();await roles.start();roles.state.role="sender";await roles.page.evaluate(()=>window.dispatchEvent(new Event("focus")));await roles.page.locator(".user-block small").filter({hasText:"Sender"}).waitFor();assert.equal(await roles.page.getByRole("link",{name:"Create envelope",exact:true}).count(),1);
 const teamReads=roles.state.requests.filter(request=>request==="GET /api/team").length;await roles.page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Team",exact:true}).click();await roles.page.getByText("Only company administrators can manage the team.",{exact:true}).waitFor();assert.equal(roles.state.requests.filter(request=>request==="GET /api/team").length,teamReads);await roles.page.locator(".settings-link").click();await roles.page.getByLabel("Contact name",{exact:true}).fill("Fictional previous company contact");assert.equal(await roles.page.getByRole("navigation",{name:"Settings navigation"}).getByRole("link").count(),2);
 roles.state.company="fixture-other-company";roles.state.user="fixture-other-user";roles.state.envelopes=[];await roles.page.evaluate(()=>window.dispatchEvent(new Event("focus")));await roles.page.waitForFunction(()=>document.querySelector(".nav-count")?.textContent==="0");await roles.page.getByLabel("Contact name",{exact:true}).waitFor();assert.equal(await roles.page.getByLabel("Contact name",{exact:true}).inputValue(),"");assert.equal(await roles.page.locator(".workspace-loading").count(),0);await roles.finish();pass("fresh roles remove admin controls; identity/company changes discard prior page data");

 const mobile=await fixture({width:390,reducedMotion:"reduce",role:"read-only"});await mobile.start();assert.equal(await mobile.page.getByRole("link",{name:"Create envelope",exact:true}).count(),0);await mobile.page.getByRole("button",{name:"Toggle menu",exact:true}).click();await mobile.page.locator(".mobile-open .settings-link").click();await mobile.page.getByRole("heading",{name:"Contacts",exact:true}).waitFor();await mobile.page.getByText("Saved contacts",{exact:true}).waitFor();assert.equal(await mobile.page.getByRole("navigation",{name:"Settings navigation"}).getByRole("link").count(),2);assert.equal(await mobile.page.getByRole("button",{name:"Add contact",exact:true}).count(),0);
 const mobileGate=gate();mobile.state.gates.set("/api/manage/templates",mobileGate);await mobile.page.getByRole("navigation",{name:"Settings navigation"}).getByRole("link",{name:"Reusable templates",exact:true}).click();await mobile.page.locator('.settings-content [data-slot="skeleton"]').first().waitFor();assert.equal(await mobile.page.locator('.settings-content [data-slot="skeleton"]').first().evaluate(node=>getComputedStyle(node,"::after").animationName),"none");assert.equal(await mobile.page.locator(".workspace-loading").count(),0);assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobile.page.screenshot({path:`${evidence}/mobile-reduced-motion.png`});mobileGate.release();mobile.state.gates.clear();await mobile.page.getByText("Fixture reusable agreement",{exact:true}).waitFor();await mobile.finish();
 pass("mobile navigation respects viewer access and reduced motion without horizontal overflow");
 console.log(JSON.stringify({checks:checks.length,evidence,origin}));
}catch(error){if(debug&&!debug.page.isClosed()){console.error(JSON.stringify({url:debug.page.url(),errors:debug.state.errors,blocked:debug.state.blocked,requests:debug.state.requests.slice(-15),body:(await debug.page.locator("body").innerText()).slice(-3000)}));await debug.page.screenshot({path:`${evidence}/failure.png`});}throw error;}finally{clearTimeout(deadline);await browser.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runNavigationTests();
