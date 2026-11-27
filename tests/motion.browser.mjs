// Uses an already-running loopback preview. All APIs use fictional in-memory
// fixtures; unknown APIs and every unrecognized write are blocked, never forwarded.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve("tsx/package.json"))("esbuild");
const {outputFiles}=await build({entryPoints:["tests/fixtures/motion-primitives.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'}});
const origin=process.env.ACCORD_MOTION_ORIGIN||"http://127.0.0.1:56327";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname),"Use a loopback preview");
const browser=await chromium.launch({headless:true,...(process.platform==="darwin"?{executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}:{})});
const checks=[];
const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
const settle=locator=>locator.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
const click=locator=>locator.evaluate(el=>el.click());
const emptyPortals=page=>page.waitForFunction(()=>!document.querySelector('[data-slot="dialog-content"],[data-slot="dialog-overlay"],[data-slot="alert-dialog-content"],[data-slot="alert-dialog-overlay"]')&&!document.body.hasAttribute("data-scroll-locked")&&getComputedStyle(document.body).pointerEvents!=="none");

async function fixture({width=1440,reduced=false}={}){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:reduced?"reduce":"no-preference",serviceWorkers:"block"});
 const envelope={id:"motion-envelope",owner_id:"motion-owner",owner_name:"Alex Rivera",title:"Motion fixture agreement",state:"draft",version:1,routing:"parallel",folder:"Fixture folder",tags:["fixture"],created_at:"2026-11-27T00:00:00Z",documents:[],recipients:[],fields:[],events:[],outputs:[],deliveries:[],document_count:0};
 const state={blocked:[],errors:[],reads:0,saves:0,hold:null};
 await context.route("**/*",async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method(),write=!["GET","HEAD"].includes(method);
  const json=(value,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
  if(url.origin!==origin){if(write)state.blocked.push(`${method} external`);return route.abort();}
  if(!url.pathname.startsWith("/api/")){if(write){state.blocked.push(`${method} ${url.pathname}`);return route.abort();}return route.continue();}
  if(method==="GET"){
   if(url.pathname==="/api/workspace"){state.reads++;return json({company:{id:"motion-company",name:"Northstar Studio"},role:"admin",userId:"motion-owner",verificationOnly:true,developmentLinks:false,envelopes:[envelope]});}
   if(url.pathname==="/api/envelopes/motion-envelope")return json(envelope);
   if(url.pathname==="/api/envelopes/motion-envelope/completion-copy")return json({version:envelope.version,copy:null});
   if(["/api/manage/colleagues","/api/envelopes/motion-envelope/shares"].includes(url.pathname))return json([]);
  }
  if(method==="PATCH"&&url.pathname==="/api/envelopes/motion-envelope"){
   if(state.hold)await state.hold;
   const body=request.postDataJSON();assert.equal(body.version,envelope.version);assert.equal(body.title,"Saved motion fixture");
   state.saves++;Object.assign(envelope,{...body,version:envelope.version+1});return json(envelope);
  }
  state.blocked.push(`${method} ${url.pathname}`);return json({error:"Unknown fixture API blocked"},403);
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on("pageerror",e=>state.errors.push(e.message));
 await page.goto(`${origin}/envelopes`);await page.locator(".document-link").waitFor();
 return {page,context,state};
}

// Sample rendered intermediate geometry/opacity by seeking the actual CSS
// animation/transition. This avoids timing guesses on slower CI machines.
async function sample(locator,{duration=200,panel=false,height=false,out=false}={}){
 const result=await locator.evaluate(async(el,{height,panel})=>{
  await new Promise(requestAnimationFrame);
  // Leave Radix presence animations on their real clock; only seek transitions.
  const animations=el.getAnimations().filter(a=>typeof a.transitionProperty==="string");
  const animation=animations.find(a=>a.transitionProperty===(height?"grid-template-rows":panel?"transform":"opacity"));
  if(!animation)throw new Error(`Missing motion on ${el.getAttribute("data-slot")||el.className}: ${el.getAttribute("data-state")} ${getComputedStyle(el).transition} panel=${getComputedStyle(el).getPropertyValue("--motion-panel")} ${JSON.stringify(animations.map(a=>({type:a.constructor.name,property:a.transitionProperty,name:a.animationName})))}`);
  animations.forEach(a=>a.pause());
  const timing=animation.effect.getTiming(),frames=[];
  for(const ratio of [0,.25,.6,.99]){
   animations.forEach(a=>{a.currentTime=Number(a.effect.getTiming().duration)*ratio;});
   await new Promise(requestAnimationFrame);
   const css=getComputedStyle(el),box=el.getBoundingClientRect();
   frames.push({height:box.height,opacity:Number(css.opacity),x:new DOMMatrix(css.transform).m41});
  }
  animations.forEach(a=>a.finish());
  return {duration:timing.duration,easing:timing.easing,frames,width:el.getBoundingClientRect().width};
 },{height,panel});
 assert.equal(result.duration,duration);assert.equal(result.easing,"cubic-bezier(0.22, 0.61, 0.36, 1)");
 const values=result.frames.map(frame=>height?frame.height:panel?frame.x:frame.opacity);
 assert.ok(Math.abs(values[0]-values.at(-1))>(height||panel?5:.5),JSON.stringify(result));
 assert.ok(values.slice(1,-1).every(v=>v>Math.min(values[0],values.at(-1))&&v<Math.max(values[0],values.at(-1))),JSON.stringify(result));
 if(height||!panel)assert.equal(values[0]<values.at(-1),!out);
 return result;
}

async function filters(page,reduced){
 const toggle=page.getByRole("button",{name:"Additional filters"}),region=page.locator("#envelope-advanced-filters");
 assert.equal(await region.evaluate(el=>el.getBoundingClientRect().height),0);
 assert.equal(await region.getAttribute("aria-hidden"),"true");
 await click(toggle);
 if(!reduced)await sample(region,{duration:300,height:true});
 await page.getByLabel("Recipient",{exact:true}).fill("Avery");
 await page.getByLabel("Created from",{exact:true}).fill("2026-01-01");
 await click(toggle);
 assert.equal(await region.getAttribute("inert"),"");
 assert.equal(await page.locator("#envelopes-recipient").evaluate(el=>{el.focus();return document.activeElement===el;}),false);
 assert.doesNotMatch(await page.locator("main").ariaSnapshot(),/textbox "Recipient"/);
 if(!reduced)await sample(region,{duration:300,height:true,out:true});
 await settle(region);assert.equal(await region.evaluate(el=>el.getBoundingClientRect().height),0);
 // Reverse an in-flight transition repeatedly, then reopen with retained values.
 for(let i=0;i<5;i++){await click(toggle);await page.evaluate(()=>new Promise(requestAnimationFrame));}
 await settle(region);
 assert.equal(await page.getByLabel("Recipient",{exact:true}).inputValue(),"Avery");
 assert.equal(await page.getByLabel("Created from",{exact:true}).inputValue(),"2026-01-01");
 await page.getByLabel("Recipient",{exact:true}).fill("");await page.getByLabel("Created from",{exact:true}).fill("");
 if(reduced)assert.equal(await region.evaluate(el=>el.getAnimations().length),0);
 check(`filters: both height directions, inert exit, rapid reversal and retained values (${reduced?"reduced":"normal"})`);
}

async function drawers(page,state,width,reduced){
 const create=page.getByRole("link",{name:"Create envelope",exact:true}),selector='[data-slot="dialog-content"].envelope-drawer';
 for(const kind of ["create","detail"]){
  const trigger=kind==="create"?create:page.locator(".document-link");
  await click(trigger);const drawer=page.locator(selector);await drawer.waitFor();
  if(!reduced)await sample(drawer,{duration:300,panel:true});
  else assert.equal(await drawer.evaluate(el=>el.getAnimations().length),0);
  await settle(drawer);const box=await drawer.boundingBox();assert.equal(Math.round(box.width),width>900?width*.8:width);assert.equal(Math.round(box.x),width>900?width*.2:0);
  await drawer.getByRole("button",{name:"Close",exact:true}).focus();await page.keyboard.press("Tab");
  assert.equal(await drawer.evaluate(el=>el.contains(document.activeElement)),true);
  assert.equal(await page.evaluate(()=>document.body.hasAttribute("data-scroll-locked")),true);
  const reads=state.reads;
  await click(drawer.getByRole("button",{name:"Close",exact:true}));
  if(!reduced){assert.equal(await drawer.getAttribute("data-state"),"closed");assert.equal(state.reads,reads);await sample(drawer,{duration:300,panel:true,out:true});}
  await drawer.waitFor({state:"detached"});await emptyPortals(page);
  await page.waitForFunction(()=>document.activeElement?.matches('a.document-link,a[href="/envelopes/new"]'));
  assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
  await page.waitForFunction(()=>document.querySelectorAll('[data-slot="dialog-overlay"]').length===0);
  assert.equal(state.reads,reads+1,"Close refresh fires exactly once");
  // Reopen immediately after the real unmount and close with Escape.
  await click(trigger);await drawer.waitFor();await page.keyboard.press("Escape");await drawer.waitFor({state:"detached"});await emptyPortals(page);
 }
 check(`drawers: both directions, real unmount, single close, reopen, focus and scroll (${width}px, ${reduced?"reduced":"normal"})`);
}

async function guards(page,state,reduced){
 await click(page.getByRole("link",{name:"Create envelope",exact:true}));const drawer=page.locator(".envelope-drawer");
 await drawer.getByLabel("Envelope title",{exact:true}).fill("Unsaved fictional title");await settle(drawer);await page.keyboard.press("Escape");
 const alert=page.getByRole("alertdialog",{name:"Discard unsaved changes?"});await alert.waitFor();
 if(!reduced)await sample(alert);
 await click(alert.getByRole("button",{name:"Keep editing"}));if(!reduced)await sample(alert,{out:true});await alert.waitFor({state:"detached"});
 assert.equal(await drawer.getByLabel("Envelope title",{exact:true}).inputValue(),"Unsaved fictional title");
 await page.waitForFunction(()=>document.querySelector(".envelope-drawer")?.contains(document.activeElement));
 await page.keyboard.press("Escape");await alert.waitFor();await settle(alert);await click(alert.getByRole("button",{name:"Discard changes"}));
 await drawer.waitFor({state:"detached"});await emptyPortals(page);
 await click(page.locator(".document-link"));await drawer.getByLabel("Title",{exact:true}).fill("Saved motion fixture");
 let release;state.hold=new Promise(resolve=>{release=resolve;});
 await drawer.getByRole("button",{name:"Save draft",exact:true}).click();await page.waitForFunction(()=>document.querySelector(".envelope-editor")?.getAttribute("aria-busy")==="true");
 await page.keyboard.press("Escape");assert.equal(await drawer.getAttribute("data-state"),"open");assert.equal(await drawer.getByRole("button",{name:"Close",exact:true}).isDisabled(),true);
 release();state.hold=null;await drawer.getByText("Draft saved to the database",{exact:true}).waitFor();
 await page.keyboard.press("Escape");await drawer.waitFor({state:"detached"});await emptyPortals(page);assert.equal(state.saves,1);
 await click(page.locator(".document-link"));await drawer.getByLabel("Title",{exact:true}).fill("Unsaved nested fixture");
 const review=drawer.getByRole("button",{name:"Review & freeze for signing",exact:true}),confirmation=page.getByRole("dialog",{name:"Freeze this envelope for signing?",exact:true});
 // Dispatch at the first DOM appearance, before Radix's passive effects can
 // register the inner layer. Keep the trusted keyboard path below as well.
 await page.evaluate(()=>{
  window.immediateConfirmationEscape=new Promise(resolve=>{
   const observer=new MutationObserver(()=>{
    const inner=document.querySelector('.envelope-confirmation[data-state="open"]');if(!inner)return;
    observer.disconnect();
    (document.activeElement||document.body).dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));resolve();
   });
   observer.observe(document.body,{childList:true,subtree:true});
  });
 });
 await click(review);await page.evaluate(()=>window.immediateConfirmationEscape);await confirmation.waitFor({state:"detached"});
 assert.equal(await drawer.getAttribute("data-state"),"open");assert.equal(await page.getByRole("alertdialog").count(),0);
 await page.waitForFunction(()=>document.activeElement?.tagName==="BUTTON"&&document.activeElement.textContent?.includes("Review & freeze for signing"));
 for(let attempt=0;attempt<2;attempt++){
  await click(review);await confirmation.waitFor();await page.keyboard.press("Escape");
  if(!reduced){
   // Hold actual exit animations so a second Escape deterministically lands
   // while the inner layer is closing, without a sleep or a duration guess.
   await confirmation.evaluate(el=>el.getAnimations().forEach(animation=>animation.pause()));
   assert.equal(await confirmation.getAttribute("data-state"),"closed");
   await page.keyboard.press("Escape");assert.equal(await drawer.getAttribute("data-state"),"open");assert.equal(await page.getByRole("alertdialog").count(),0);
   await confirmation.evaluate(el=>el.getAnimations().forEach(animation=>animation.finish()));
  }
  await confirmation.waitFor({state:"detached"});
  assert.equal(await drawer.getByLabel("Title",{exact:true}).inputValue(),"Unsaved nested fixture");
  await page.waitForFunction(()=>document.activeElement?.tagName==="BUTTON"&&document.activeElement.textContent?.includes("Review & freeze for signing"));
  await page.waitForFunction(()=>document.querySelectorAll('[data-slot="dialog-overlay"]').length===1);
  assert.equal(await page.locator('[data-slot="dialog-overlay"]').count(),1);
 }
 // The inner layer's guard must release so the parent's unsaved guard works.
 await page.keyboard.press("Escape");await alert.waitFor();await click(alert.getByRole("button",{name:"Discard changes"}));await drawer.waitFor({state:"detached"});await emptyPortals(page);assert.equal(state.saves,1);
 check(`guards: unsaved/busy dismissal, immediate nested Escape, exit ownership, reopen and retained draft (${reduced?"reduced":"normal"})`);
}

async function primitives(page,reduced){
 await page.addScriptTag({content:outputFiles[0].text});await page.getByRole("button",{name:"Fixture dialog",exact:true}).waitFor();
 for(const [label,slot] of [["Fixture select","select-content"],["Fixture dropdown","dropdown-menu-content"],["Fixture popover","popover-content"],["Fixture tooltip","tooltip-content"],["Fixture dialog","dialog-content"],["Fixture alert","alert-dialog-content"]]){
  const trigger=label==="Fixture select"?page.getByRole("combobox",{name:label}):page.getByRole("button",{name:label,exact:true});
  await trigger.scrollIntoViewIfNeeded();
  if(label==="Fixture tooltip")await trigger.hover();else if(label==="Fixture dropdown"||label==="Fixture select")await trigger.click();else await click(trigger);
  const content=page.locator(`[data-slot="${slot}"]`);await content.waitFor();
  if(!reduced)await sample(content);else assert.equal(await content.evaluate(el=>el.getAnimations().length),0);
  await settle(content);await page.keyboard.press("Escape");
  if(!reduced)await sample(content,{out:true});
  await content.waitFor({state:"detached"});
  if(label!=="Fixture tooltip")await page.waitForFunction(label=>{const el=document.activeElement;return el?.textContent?.includes(label)||el?.getAttribute("aria-label")===label;},label);
  await page.mouse.move(0,0);
 }
 await emptyPortals(page);
 check(`shared select, dropdown, popover, tooltip, Dialog and AlertDialog: opacity/easing in both directions and focus (${reduced?"reduced":"normal"})`);
}

try{
 for(const width of [1440,390])for(const reduced of [false,true]){
  const {page,context,state}=await fixture({width,reduced});
  await filters(page,reduced);await drawers(page,state,width,reduced);await guards(page,state,reduced);
  if(width===390){
   const toggle=page.getByRole("button",{name:"Toggle menu"});await click(toggle);const menu=page.locator(".mobile-workspace-menu");await menu.waitFor();
   if(!reduced){const motion=await sample(menu,{duration:300,panel:true});assert.ok(motion.frames[0].x<0);}await settle(menu);
   await page.keyboard.press("Escape");if(!reduced)await sample(menu,{duration:300,panel:true,out:true});await menu.waitFor({state:"detached"});await emptyPortals(page);
   await page.waitForFunction(()=>document.activeElement?.getAttribute("aria-label")==="Toggle menu");check(`mobile workspace menu enters/exits from left and returns focus (${reduced?"reduced":"normal"})`);
  }
  if(width===1440)await primitives(page,reduced);
  assert.deepEqual(state.blocked,[]);assert.deepEqual(state.errors,[]);await context.close();
 }
 console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await browser.close();}
