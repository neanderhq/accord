// Run against the existing preview; the shared navigation fixture blocks real
// API traffic and writes. No server, database, login or credentials are needed.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { navigationFixture } from "./navigation.browser.mjs";

const origin=process.env.ACCORD_NAVIGATION_ORIGIN||"http://127.0.0.1:56327";
const evidence=".next/sidebar-review";
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.platform==="darwin"?{executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}:{})});
const deadline=setTimeout(()=>void browser.close(),180000),checks=[];
let current;
function pass(name){checks.push(name);console.log(`PASS ${name}`);}
const fixture=async options=>{current=await navigationFixture(browser,origin,options);return current;};
const sidebar=page=>page.locator('#desktop-workspace-navigation');
const toggle=page=>sidebar(page).locator('.sidebar-toggle');
async function settled(page,collapsed){
 await page.waitForFunction(collapsed=>{
  const side=document.querySelector('#desktop-workspace-navigation'),main=document.querySelector('.app-main');
  const width=collapsed?76:240;
  return side?.dataset.collapsed===String(collapsed)&&Math.abs(side.getBoundingClientRect().width-width)<.01&&Math.abs(main.getBoundingClientRect().left-width)<.01;
 },collapsed);
}
async function layout(page,collapsed){
 await settled(page,collapsed);
 const boxes=await page.evaluate(()=>{
  const rect=selector=>{const {x,width}=document.querySelector(selector).getBoundingClientRect();return {x,width};};
  return {side:rect('#desktop-workspace-navigation'),main:rect('.app-main'),content:rect('main'),viewport:innerWidth,scroll:document.documentElement.scrollWidth};
 });
 assert.equal(boxes.side.width,collapsed?76:240);assert.ok(Math.abs(boxes.main.width-(boxes.viewport-boxes.side.width))<1);
 assert.ok(boxes.content.width<=boxes.main.width);assert.ok(boxes.scroll<=boxes.viewport);
 return boxes;
}
async function hint(page,target,label,focus=false){
 await page.mouse.move(700,60);
 if(focus)await target.focus();else{await page.evaluate(()=>document.activeElement?.blur());await target.hover();}
 const content=page.locator('[data-slot="tooltip-content"]').filter({hasText:label}).first();await content.waitFor();
 assert.ok((await content.innerText()).includes(label));
 await page.keyboard.press('Escape');await page.mouse.move(700,60);await page.evaluate(()=>document.activeElement?.blur());await content.waitFor({state:'detached'});
}
async function noClippedControls(page){
 const side=sidebar(page);
 for(const target of [side.locator('.settings-link'),side.getByRole('button',{name:'Sign out',exact:true})]){
  await target.scrollIntoViewIfNeeded();
  assert.equal(await target.evaluate(node=>{const r=node.getBoundingClientRect(),p=node.closest('aside').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=-.5&&r.bottom<=innerHeight+.5&&r.width>=30&&r.height>=30;}),true);
 }
}

try{
 const f=await fixture(),{page,state}=f;await f.start();await f.remember();
 const identity=await f.identity(),documents=state.documents,expanded=await layout(page,false);
 await page.screenshot({path:`${evidence}/expanded.png`});
 await hint(page,toggle(page),'Collapse sidebar',true);
 await toggle(page).click();const compact=await layout(page,true);
 assert.ok(Math.abs(compact.main.width-expanded.main.width-164)<.1);assert.ok(Math.abs(compact.content.width-expanded.content.width-164)<.1);
 assert.deepEqual(await sidebar(page).getByRole('navigation',{name:'Main navigation'}).getByRole('link').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),['Overview','Envelopes','Team']);
 assert.equal(await sidebar(page).getByRole('link',{name:'Envelopes',exact:true}).getAttribute('aria-current'),'page');
 await f.stable();assert.deepEqual(await f.identity(),identity);assert.equal(state.documents,documents);
 pass('expanded 240px and compact 76px widths resize main content together and keep shell, icon order and active state');

 await page.mouse.move(700,60);await toggle(page).evaluate(node=>node.blur());
 await page.waitForFunction(()=>+getComputedStyle(document.querySelector('.sidebar-toggle-mark')).opacity>.99);
 for(const focus of [false,true]){
  if(focus)await toggle(page).focus();else await toggle(page).hover();
  await page.waitForFunction(()=>+getComputedStyle(document.querySelector('.sidebar-expand-icon')).opacity>.99&&+getComputedStyle(document.querySelector('.sidebar-toggle-mark')).opacity<.01);
  assert.equal(await toggle(page).getAttribute('aria-expanded'),'false');await layout(page,true);
  await page.keyboard.press('Escape');await page.mouse.move(700,60);await toggle(page).evaluate(node=>node.blur());
  await page.waitForFunction(()=>+getComputedStyle(document.querySelector('.sidebar-toggle-mark')).opacity>.99);
 }
 await page.screenshot({path:`${evidence}/compact.png`});
 await toggle(page).hover();await page.screenshot({path:`${evidence}/logo-expand-hover.png`});
 await toggle(page).click();await layout(page,false);await toggle(page).click();await layout(page,true);
 pass('top logo mark crossfades to expand on hover and keyboard focus; only activation expands');

 for(const name of ['Overview','Envelopes','Team','Settings & integrations']){
  const link=sidebar(page).getByRole('link',{name,exact:true});assert.equal(await link.count(),1);
  await hint(page,link,name);await hint(page,link,name,true);
 }
 const company=sidebar(page).locator('.workspace-card');await hint(page,company,'Northstar Studio · Administrator');await hint(page,company,'Northstar Studio · Administrator',true);
 const status=sidebar(page).locator('.email-setup-note');await hint(page,status,'Email delivery is off.');await hint(page,status,'Email delivery is off.',true);
 await hint(page,sidebar(page).getByRole('button',{name:'Sign out',exact:true}),'Sign out',true);
 pass('every icon link has an accessible name and hover/focus tooltip; company, role and email status stay discoverable');

 await toggle(page).focus();const tabNames=[];
 for(let i=0;i<8;i++){
  await page.keyboard.press('Tab');tabNames.push(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')));
 }
 assert.deepEqual(tabNames,['Northstar Studio · Administrator','Overview','Envelopes','Team','Settings & integrations',await status.getAttribute('aria-label'),'Sign out','Workspace setup']);
 assert.equal(await sidebar(page).locator('.brand-link').getAttribute('tabindex'),'-1');
 assert.equal(await sidebar(page).locator('.sidebar-note-copy').evaluate(node=>node.inert),true);
 await toggle(page).focus();await page.keyboard.press('Enter');await layout(page,false);assert.equal(await toggle(page).evaluate(node=>node===document.activeElement),true);
 await page.keyboard.press('Space');await layout(page,true);assert.equal(await toggle(page).evaluate(node=>node===document.activeElement),true);
 pass('Tab skips hidden brand/setup links and reaches settings/sign out; Enter and Space toggle without losing focus');

 await sidebar(page).getByRole('link',{name:'Team',exact:true}).click();await page.getByRole('heading',{name:'Team',exact:true}).waitFor();await layout(page,true);await f.stable();
 await sidebar(page).getByRole('link',{name:'Settings & integrations',exact:true}).click();await page.getByLabel('Contact name',{exact:true}).waitFor();await layout(page,true);await f.stable();
 assert.equal(await sidebar(page).locator('.settings-link').getAttribute('aria-current'),'page');
 await page.goBack();await page.getByRole('heading',{name:'Team',exact:true}).waitFor();await layout(page,true);
 assert.equal((await f.identity()).sentinel,identity.sentinel);assert.equal(state.documents,documents);assert.equal((await f.identity()).logos,identity.logos);
 await page.reload();await page.getByText('Team members',{exact:true}).waitFor();await layout(page,true);
 assert.equal(await page.evaluate(()=>localStorage.getItem('accord:sidebar-collapsed')),'true');
 await toggle(page).click();await layout(page,false);await page.reload();await page.getByText('Team members',{exact:true}).waitFor();await layout(page,false);
 assert.equal(await page.evaluate(()=>localStorage.getItem('accord:sidebar-collapsed')),'false');
 await f.remember();
 pass('preference survives soft routes, settings redirect, browser back and hard refresh without soft-route logo spinners');

 const reversals=await page.evaluate(async()=>{
  const button=document.querySelector('.sidebar-toggle'),side=document.querySelector('#desktop-workspace-navigation'),main=document.querySelector('.app-main'),samples=[];
  let recording=true;
  function record(){if(!recording)return;const width=side.getBoundingClientRect().width;samples.push({width,left:main.getBoundingClientRect().left,overflow:document.documentElement.scrollWidth>innerWidth});requestAnimationFrame(record);}
  requestAnimationFrame(record);
  const pause=()=>new Promise(resolve=>setTimeout(resolve,110)),read=()=>side.getBoundingClientRect().width;
  button.click();await pause();const collapsing=read();button.click();const afterExpand=read();await pause();const expanding=read();
  button.click();const afterCollapse=read();await pause();const recollapsing=read();
  button.click();await new Promise(resolve=>setTimeout(resolve,500));recording=false;
  return {collapsing,afterExpand,expanding,afterCollapse,recollapsing,samples};
 });
 assert.ok(reversals.collapsing>76&&reversals.collapsing<240);assert.ok(Math.abs(reversals.afterExpand-reversals.collapsing)<1);
 assert.ok(reversals.expanding>reversals.collapsing);assert.ok(Math.abs(reversals.afterCollapse-reversals.expanding)<1);assert.ok(reversals.recollapsing<reversals.expanding);
 assert.ok(reversals.samples.length>10);for(const s of reversals.samples){assert.ok(Math.abs(s.width-s.left)<1);assert.equal(s.overflow,false);}
 await layout(page,false);await f.stable();
 assert.equal(await sidebar(page).evaluate(node=>getComputedStyle(node).transitionTimingFunction),'cubic-bezier(0.22, 0.61, 0.36, 1)');
 pass('rapid reversals continue from the current width; content follows each eased frame without overflow');

 await sidebar(page).getByRole('link',{name:'Envelopes',exact:true}).click();await f.waitReady();
 for(const width of [901,1024,1280,1440,1920]){
  await page.setViewportSize({width,height:800});await layout(page,false);await noClippedControls(page);
  await toggle(page).click();await layout(page,true);await noClippedControls(page);await toggle(page).click();await layout(page,false);
 }
 for(const height of [600,480]){
  await page.setViewportSize({width:1024,height});await noClippedControls(page);
  const guide=sidebar(page).getByRole('link',{name:'Setup Guide',exact:true});await guide.scrollIntoViewIfNeeded();assert.equal(await guide.isVisible(),true);
  await toggle(page).scrollIntoViewIfNeeded();await toggle(page).click();await layout(page,true);await noClippedControls(page);await toggle(page).scrollIntoViewIfNeeded();await toggle(page).click();await layout(page,false);
 }
 pass('desktop/tablet widths 901–1920px and short viewports keep settings, setup and sign out reachable without horizontal overflow');

 await toggle(page).scrollIntoViewIfNeeded();await toggle(page).click();await layout(page,true);
 for(const width of [900,768,390]){
  await page.setViewportSize({width,height:800});
  assert.equal(await sidebar(page).isVisible(),false);assert.equal(await page.locator('.app-main').evaluate(node=>node.getBoundingClientRect().left),0);
  await page.getByRole('button',{name:'Toggle menu',exact:true}).click();const menu=page.getByRole('dialog',{name:'Workspace menu'});
  await menu.waitFor();assert.equal(await menu.locator('aside').getAttribute('data-collapsed'),'false');assert.equal(await menu.locator('.sidebar-toggle').count(),0);
  for(const name of ['Accord overview','Overview','Envelopes','Team','Settings & integrations'])assert.equal(await menu.getByRole('link',{name,exact:true}).isVisible(),true);
  assert.ok((await menu.locator('.workspace-card').innerText()).includes('Northstar Studio'));assert.equal(await menu.getByRole('button',{name:'Sign out',exact:true}).isVisible(),true);
  assert.equal(await menu.locator('.sidebar-label').first().evaluate(node=>+getComputedStyle(node).opacity),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await menu.getByRole('link',{name:'Team',exact:true}).click();await menu.waitFor({state:'hidden'});await page.getByRole('heading',{name:'Team',exact:true}).waitFor();
 }
 await page.getByRole('button',{name:'Toggle menu',exact:true}).click();
 const reopenedMenu=page.getByRole('dialog',{name:'Workspace menu'});await reopenedMenu.getByRole('link',{name:'Accord overview',exact:true}).focus();
 await reopenedMenu.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.keyboard.press('Escape');await reopenedMenu.waitFor({state:'hidden'});
 await page.setViewportSize({width:1440,height:960});await layout(page,true);
 assert.equal(await page.evaluate(()=>localStorage.getItem('accord:sidebar-collapsed')),'true');
 pass('mobile menu stays fully labeled at 390/768/900px, closes on navigation/Escape, and preserves the desktop preference');
 await f.finish();

 const reduced=await fixture({reducedMotion:'reduce',role:'read-only'});await reduced.start();await toggle(reduced.page).click();await layout(reduced.page,true);
 for(const selector of ['#desktop-workspace-navigation','.app-main','.sidebar-label','.sidebar-toggle-mark','.sidebar-expand-icon']){
  assert.equal(await reduced.page.locator(selector).first().evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
 }
 await toggle(reduced.page).focus();assert.equal(await reduced.page.locator('.sidebar-expand-icon').evaluate(node=>getComputedStyle(node).opacity),'1');
 await hint(reduced.page,sidebar(reduced.page).locator('.workspace-card'),'Northstar Studio · Viewer',true);
 await hint(reduced.page,sidebar(reduced.page).locator('.email-setup-note'),'Ask your administrator to configure delivery.',true);
 assert.equal(await sidebar(reduced.page).getByRole('link',{name:'Setup Guide',exact:true}).count(),0);
 await reduced.page.screenshot({path:`${evidence}/reduced-motion.png`});await reduced.finish();
 pass('reduced motion removes resize/crossfade animation while preserving focus, status discovery and viewer restrictions');

 const disabled=await fixture();await disabled.context.addInitScript(()=>{
  for(const method of ['getItem','setItem']){const original=Storage.prototype[method];Storage.prototype[method]=function(key,...args){if(key==='accord:sidebar-collapsed')throw new DOMException('Fictional storage disabled','SecurityError');return original.call(this,key,...args);};}
 });
 await disabled.start();await layout(disabled.page,false);await toggle(disabled.page).click();await layout(disabled.page,true);
 await sidebar(disabled.page).getByRole('link',{name:'Team',exact:true}).click();await disabled.page.getByRole('heading',{name:'Team',exact:true}).waitFor();await layout(disabled.page,true);await disabled.finish();
 pass('blocked local storage safely falls back to in-memory state across soft navigation');
 console.log(JSON.stringify({checks:checks.length,evidence,origin}));
}catch(error){if(current&&!current.page.isClosed()){console.error(JSON.stringify({url:current.page.url(),errors:current.state.errors,blocked:current.state.blocked}));await current.page.screenshot({path:`${evidence}/failure.png`});}throw error;}finally{clearTimeout(deadline);await browser.close();}
