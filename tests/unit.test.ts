import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Children,createElement,isValidElement } from "react";
import { Collapse } from "../components/ui/collapse";
import { Dialog,DialogContent,DialogPortal } from "../components/ui/dialog";
import { AlertDialogContent,AlertDialogPortal } from "../components/ui/alert-dialog";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import postcss from "postcss";
import { XMLParser } from "fast-xml-parser";
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
import { DocumentCover,EnvelopeRecipients,statusFilterOptions } from "../components/dashboard";
import { RecipientPill,RecipientOverflowList } from "../components/envelope-recipients";
import { recipientDisplay,packRecipientRows } from "../lib/recipient-layout";
import { TooltipProvider } from "../components/ui/tooltip";
import { Shell,ApiError } from "../components/app-kit";
import { AccordBrand,WorkspaceLoader } from "../components/accord-brand";
import { ContentLoader } from "../components/content-loader";
import { WorkspaceFrame } from "../components/workspace-frame";
import RouteLoading from "../app/loading";
import { Composer,EnvelopeEditor,EnvelopeNotice } from "../components/composer";
import { SettingsWorkspace,SettingsPage,SettingsNavigation,SettingsDeliveryLog,loadSettingsSection } from "../components/settings";
import { settingsSections,settingsHref,canAccessSettingsSection,brandingSettingsPayload,webhookSettingsPayload,type SettingsSectionId } from "../app/settings/sections";
import SettingsIndex from "../app/(workspace)/settings/page";
import ContactsSettingsPage from "../app/(workspace)/settings/contacts/page";
import BrandingSettingsPage from "../app/(workspace)/settings/branding/page";
import EmailJobsSettingsPage from "../app/(workspace)/settings/email-jobs/page";
import DeliveryLogSettingsPage from "../app/(workspace)/settings/delivery-log/page";
import WebhookSettingsPage from "../app/(workspace)/settings/webhook/page";
import TemplatesSettingsPage from "../app/(workspace)/settings/templates/page";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { envelopePermissions,envelopeStepError,opensEnvelopeDrawer,envelopeForStep,mergeSavedEnvelopeStep,envelopeDraftPayload } from "../lib/envelope-wizard";
import type { EnvelopeView,RecipientView,WorkspaceView } from "../lib/ui-types";

const router={bfcacheId:"fixture",back(){},forward(){},refresh(){},hmrRefresh(){},push(){},replace(){},prefetch(){}};
const renderToStaticMarkup=(node:Parameters<typeof renderMarkup>[0])=>renderMarkup(createElement(AppRouterContext.Provider,{value:router},node));
type MarkupNode={ [name:string]:string|MarkupNode[] };
function markupText(markup:string){
 const nodes:MarkupNode[]=new XMLParser({preserveOrder:true,ignoreAttributes:true,processEntities:false,trimValues:false,parseTagValue:false}).parse(markup);
 const text=(children:MarkupNode[]):string=>children.map(node=>Object.entries(node).map(([name,value])=>name==="#text"?String(value):Array.isArray(value)?text(value):"").join("")).join("");
 return text(nodes);
}

test("markup text inspection follows nested nodes without treating attribute values as text",()=>{
 assert.equal(markupText('<div title="not > visible">Before <span>Northstar <strong>Studio</strong></span> after<img alt="not text"/></div>'),"Before Northstar Studio after");
 assert.equal(markupText('<span>&lt;script&gt;fictional&lt;/script&gt;</span>'),"&lt;script&gt;fictional&lt;/script&gt;");
});

test("branded loading shows only the existing star and a screen-reader status",()=>{
 const markup=renderToStaticMarkup(createElement(WorkspaceLoader));
 assert.match(markup,/<div class="workspace-loading" role="status">/);
 assert.equal((markup.match(/<img\b/g)??[]).length,1);
 assert.ok(decodeURIComponent(markup).includes("/accord.png"));
 assert.match(markup,/<img[^>]*alt=""[^>]*aria-hidden="true"[^>]*width="846"[^>]*height="938"/);
 assert.match(markup,/<span class="sr-only">Loading your workspace<\/span>/);
 assert.equal(markupText(markup),"Loading your workspace");
 assert.doesNotMatch(markup,/<a\b|<aside\b|<footer\b|<nav\b|data-slot="card|skeleton|accord-brand/);
});

test("only initial workspace bootstrap uses the logo; route and resource waits use content skeletons",()=>{
 const render=(children:ReturnType<typeof createElement>)=>renderToStaticMarkup(createElement(PathnameContext.Provider,{value:"/settings/contacts"},children));
 const content=renderToStaticMarkup(createElement(ContentLoader));
 assert.equal(renderToStaticMarkup(createElement(RouteLoading)),content);
 const initial=render(createElement(WorkspaceFrame,{children:"Private content"}));assert.match(initial,/workspace-loading/);assert.doesNotMatch(initial,/Private content|app-sidebar|topbar/);
 const shell=render(createElement(Shell,{loading:true,children:"Private content"}));
 assert.match(shell,/<aside/);assert.match(shell,/class="topbar"/);assert.match(shell,/data-slot="skeleton"/);assert.doesNotMatch(shell,/workspace-loading|Private content/);
 for(const markup of [render(createElement(SettingsWorkspace,{section:"contacts"})),render(createElement(Composer,{id:"fictional-envelope"}))]){
  assert.match(markup,/data-slot="skeleton"/);assert.match(markup,/role="status" aria-busy="true"/);assert.doesNotMatch(markup,/workspace-loading/);
 }
 const section=renderToStaticMarkup(createElement(SettingsPage,{section:"contacts",workspace:{company:{id:"northstar",name:"Northstar Studio"},role:"admin",userId:"fixture-user",envelopes:[],verificationOnly:true,developmentLinks:false}}));
 assert.match(section,/aria-label="Settings navigation"/);assert.match(section,/<h1>Contacts/);assert.match(section,/Loading Contacts/);assert.match(section,/data-slot="skeleton"/);assert.doesNotMatch(section,/workspace-loading/);
});

test("content placeholders shimmer subtly and stop moving for reduced motion",()=>{
 const markup=renderToStaticMarkup(createElement(ContentLoader,{label:"Loading contacts"}));
 assert.match(markup,/role="status" aria-busy="true"/);assert.match(markup,/sr-only">Loading contacts/);assert.match(markup,/aria-hidden="true"/);assert.doesNotMatch(markup,/animate-pulse|<img/);
 const css=postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8"));
 let shimmer=false,reduced=false;
 css.walkRules(".skeleton-shimmer::after",rule=>rule.walkDecls("animation",decl=>{
  if(rule.parent?.type==="root"&&decl.value.includes("content-shimmer"))shimmer=true;
  if(rule.parent?.type==="atrule"&&rule.parent.params.replaceAll(/\s/g,"")==="(prefers-reduced-motion:reduce)"&&decl.value==="none")reduced=true;
 }));
 assert.ok(shimmer);assert.ok(reduced);
});

test("branded loading yields immediately to content and usable workspace errors",()=>{
 const render=(loading:boolean,error?:ApiError)=>renderToStaticMarkup(createElement(PathnameContext.Provider,{value:"/"},createElement(Shell,{loading,error,children:"Private content"})));
 const ready=render(false);
 assert.match(ready,/Private content/);assert.doesNotMatch(ready,/workspace-loading/);
 for(const loading of [true,false]){
  const signedOut=render(loading,new ApiError("Your session ended.","UNAUTHENTICATED",401));
  assert.match(signedOut,/Welcome back/);assert.match(signedOut,/href="\/login"/);assert.doesNotMatch(signedOut,/Your session ended\.|Check again/);
  const unavailable=render(loading,new ApiError("The database is unavailable.","DATABASE_UNAVAILABLE",503));
  assert.match(unavailable,/The database is unavailable\./);assert.match(unavailable,/>Check again<\/button>/);
  for(const markup of [signedOut,unavailable])assert.doesNotMatch(markup,/workspace-loading|Private content/);
 }
});

test("signed-out workspace uses the compact login card without errors or private content",()=>{
 const workspace:WorkspaceView={company:{id:"fictional-company",name:"Northstar Studio"},role:"admin",userId:"fictional-owner",envelopes:[],verificationOnly:true,developmentLinks:false};
 for(const loading of [true,false])for(const message of ["Sign in to your workspace.","Your session ended."]){
  const markup=renderToStaticMarkup(createElement(PathnameContext.Provider,{value:"/envelopes"},createElement(Shell,{workspace,loading,error:new ApiError(message,"UNAUTHENTICATED",401),children:"Private agreement contents"})));
  assert.match(markup,/<main class="login-page">/);assert.match(markup,/class="auth-content"/);
  for(const slot of ["card","card-header","card-description","card-content"])assert.equal((markup.match(new RegExp(`data-slot="${slot}"`,"g"))??[]).length,1);
  assert.match(markup,/<h1 data-slot="card-title">Welcome back<\/h1>/);assert.equal((markup.match(/<h1\b/g)??[]).length,1);
  assert.match(markup,/>Sign in to your company workspace\.<\/div>/);
  const link=markup.match(/<a\b[^>]*>Sign in<\/a>/g)??[];
  assert.equal(link.length,1);assert.match(link[0],/href="\/login"/);assert.match(link[0],/class="[^"]*\bw-full\b/);
  assert.match(markup,/class="brand-link auth-brand"/);assert.match(markup,/class="auth-footer"><span>Private documents\. Clear evidence\.<\/span>/);
  assert.equal(markup.includes(message),false);
  assert.doesNotMatch(markup,/role="alert"|data-slot="alert|<svg\b|eyebrow|SIGNED OUT|WORKSPACE SETUP|setup-state|Action needed|Check again|administrator|Sign in to access|Sign in to your company<|Private agreement contents|Northstar Studio|app-layout|<aside\b|<nav\b|<button\b/);
 }
});

test("non401 workspace errors retain diagnostics, setup guidance and recovery",()=>{
 for(const loading of [true,false])for(const [status,code,message] of [[503,"DATABASE_UNAVAILABLE","The database is unavailable."],[500,"INTERNAL_ERROR","The server could not load your workspace."],[403,"FORBIDDEN","Access to this workspace was denied."]] as const){
  const markup=renderToStaticMarkup(createElement(PathnameContext.Provider,{value:"/envelopes"},createElement(Shell,{loading,error:new ApiError(message,code,status),children:"Private agreement contents"})));
  assert.match(markup,/class="app-layout"/);assert.match(markup,/class="setup-state"/);assert.match(markup,/lucide-database/);
  assert.match(markup,/>WORKSPACE SETUP<\/p>/);assert.match(markup,/<h1>Your workspace needs a connection<\/h1>/);
  assert.match(markup,/Private documents and signing records require the project’s PostgreSQL database\. Nothing is saved until setup is complete\./);
  assert.match(markup,/role="alert"/);assert.match(markup,/>Action needed<\/div>/);assert.ok(markup.includes(message));
  assert.match(markup,/<a\b[^>]*href="\/settings"[^>]*>View setup steps<\/a>/);assert.match(markup,/>Check again<\/button>/);
  assert.match(markup,/Contact your workspace administrator if you need access or help with setup\./);
  assert.doesNotMatch(markup,/Welcome back|login-page|href="\/login"|workspace-loading|Private agreement contents/);
 }
});

test("branded loading fills the viewport and stops spinning with reduced motion",()=>{
 const css=postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8"));
 const declarations=(selector:string)=>{const values=new Map<string,string>();css.walkRules(selector,rule=>{if(rule.parent?.type==="root")rule.walkDecls(declaration=>{values.set(declaration.prop,declaration.value);});});return values;};
 const screen=declarations(".workspace-loading"),mark=declarations(".workspace-loading-mark");
 assert.equal(screen.get("display"),"grid");assert.equal(screen.get("place-items"),"center");
 assert.equal(screen.get("width"),"100%");assert.equal(screen.get("min-height"),"100dvh");
 assert.equal(screen.get("background"),"#f3f3f2");assert.equal(screen.has("background-image"),false);
 assert.equal(mark.get("height"),"auto");assert.equal(mark.get("object-fit"),"contain");
 assert.match(mark.get("animation")??"",/^workspace-loading-spin [2-9]s linear infinite$/);
 let reducedMotionStopsSpin=false;
 css.walkAtRules("media",media=>{if(media.params.replaceAll(/\s/g,"")!=="(prefers-reduced-motion:reduce)")return;media.walkRules(".workspace-loading-mark",rule=>{rule.walkDecls("animation",declaration=>{if(declaration.value==="none")reducedMotionStopsSpin=true;});});});
 assert.equal(reducedMotionStopsSpin,true);
});

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

test("document covers remain stable across renders and ordering, with varied decorative illustrations",()=>{
 const ids=Array.from({length:24},(_,index)=>`envelope-${index}`);
 const render=(id:string)=>renderToStaticMarkup(createElement(DocumentCover,{id}));
 const originals=new Map(ids.map(id=>[id,render(id)]));
 for(const id of ids.toReversed())assert.equal(render(id),originals.get(id));
 assert.ok(new Set(originals.values()).size>=6,"Different envelopes should have varied covers");
 for(const markup of originals.values()){
  assert.match(markup,/aria-hidden="true"/);assert.match(markup,/focusable="false"/);
  assert.match(markup,/<svg[^>]*width="48"[^>]*height="52"/);
  assert.doesNotMatch(markup,/<image|<img|href=|url\(/);
 }
});

test("recipient avatars use email identity across envelopes and names when no email is available",()=>{
 const recipient:RecipientView={id:"recipient-first-envelope",name:"Avery Morgan",email:"avery@client.test",routing_order:1,status:"pending"};
 const render=(value:RecipientView)=>renderToStaticMarkup(createElement(RecipientPill,{recipient:value}));
 const colors=(markup:string)=>markup.match(/class="avatar avatar-tiny"[^>]*style="([^"]+)"/)?.[1];
 const original=render(recipient);
 assert.ok(colors(original));assert.match(original,/>AM<\/span>/);
 assert.ok(original.includes(recipient.name));assert.ok(!original.includes(recipient.email));
 assert.equal(colors(render({...recipient,id:"recipient-other-envelope",name:"Avery Renamed",email:" AVERY@client.test "})),colors(original));
 assert.equal(colors(render({...recipient,email:"",name:" Avery  Morgan "})),colors(render({...recipient,id:"different-id",email:" ",name:"avery morgan"})));
 assert.match(render({...recipient,email:"",name:""}),/>\?<\/span>/);
});

test("recipient pills choose one trimmed label, with email and safe blank fallbacks",()=>{
 for(const [value,expected] of [
  [{name:"  Avery Morgan  ",email:" avery@client.test "},"Avery Morgan"],
  [{name:" \t ",email:" avery@client.test "},"avery@client.test"],
  [{name:" ",email:"\n"},"Recipient"],
  [{name:null,email:undefined},"Recipient"],
 ] as const)assert.equal(recipientDisplay(value).label,expected);
 const markup=renderToStaticMarkup(createElement(RecipientPill,{recipient:{id:"r",name:" ",email:" avery@client.test ",routing_order:1,status:"pending"}}));
 assert.match(markup,/<span class="recipient-label">avery@client.test<\/span>/);
 assert.doesNotMatch(markup,/<small|recipient-details/);
});

test("recipient packing fits as many measured pills as two rows allow and reserves exact +N space",()=>{
 const fit=(widths:number[],width:number,more=30)=>packRecipientRows(widths,width,6,()=>more);
 assert.deepEqual(fit([],200),{visibleCount:0,hiddenCount:0,firstRowCount:0});
 assert.deepEqual(fit([90],200),{visibleCount:1,hiddenCount:0,firstRowCount:1});
 assert.deepEqual(fit(Array(6).fill(40),200),{visibleCount:6,hiddenCount:0,firstRowCount:4});
 assert.deepEqual(fit(Array(9).fill(40),200),{visibleCount:7,hiddenCount:2,firstRowCount:4});
 assert.deepEqual(fit(Array(5).fill(70),160),{visibleCount:3,hiddenCount:2,firstRowCount:2});
 assert.deepEqual(fit([500,500,500],180),{visibleCount:1,hiddenCount:2,firstRowCount:1});
 assert.deepEqual(fit([40,40],0),{visibleCount:0,hiddenCount:2,firstRowCount:0});
 // A digit boundary changes the counter width; use the actual hidden count.
 assert.deepEqual(packRecipientRows(Array(12).fill(40),100,6,hidden=>hidden>=10?54:24),{visibleCount:3,hiddenCount:9,firstRowCount:2});
});

test("recipient packing responds to resize and changed font or label measurements",()=>{
 const widths=Array(9).fill(40),fit=(width:number)=>packRecipientRows(widths,width,6,()=>30);
 assert.deepEqual([fit(100).visibleCount,fit(200).visibleCount,fit(400).visibleCount,fit(100).visibleCount],[3,7,9,3]);
 assert.equal(packRecipientRows(Array(9).fill(80),200,6,()=>30).visibleCount,3);
 assert.equal(packRecipientRows([1000],50,6,()=>30).hiddenCount,0);
 // Every recipient is either rendered once or counted in +N, including large lists.
 const large=packRecipientRows(Array(1000).fill(40),200,6,hidden=>String(hidden).length*8+18);
 assert.equal(large.visibleCount+large.hiddenCount,1000);assert.equal(large.visibleCount,7);
});

test("recipient overflow and truncated labels expose accessible buttons without hidden focus targets",()=>{
 const recipients:RecipientView[]=Array.from({length:5},(_,index)=>({id:`recipient-${index}`,name:`Person ${index}`,email:`person${index}@client.test`,routing_order:index+1,status:"pending"}));
 const markup=renderToStaticMarkup(createElement(EnvelopeRecipients,{recipients}));
 // Until browser measurements are available, all recipients have one disclosure.
 assert.match(markup,/<button[^>]*aria-label="Show 5 more recipients"[^>]*aria-haspopup="dialog"[^>]*>\+5<\/button>/);
 const measurements=markup.slice(markup.indexOf('class="recipient-measurements"'));
 assert.match(measurements,/aria-hidden="true" inert=""/);assert.doesNotMatch(measurements,/<button|tabindex|<a\b/);
 const overflow=renderToStaticMarkup(createElement(RecipientOverflowList,{recipients}));
 assert.equal((overflow.match(/<li>/g)??[]).length,5);
 assert.equal((overflow.match(/class="avatar avatar-tiny"/g)??[]).length,5);
 for(const r of recipients){assert.ok(overflow.includes(r.name));assert.ok(!overflow.includes(r.email));}
 const long={...recipients[0],name:"A very long recipient name ".repeat(30)};
 const truncated=renderToStaticMarkup(createElement(TooltipProvider,null,createElement(RecipientPill,{recipient:long,truncated:true})));
 assert.ok(truncated.includes(`aria-label="${long.name.trim()}"`));assert.match(truncated,/aria-haspopup="dialog"/);
 const empty=renderToStaticMarkup(createElement(EnvelopeRecipients,{recipients:[]}));
 assert.match(empty,/Not added/);assert.doesNotMatch(empty,/class="avatar/);
});

test("recipient styles constrain labels and keep muted pills and circular avatars borderless",()=>{
 const rules=new Map<string,Map<string,string>>();
 postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8")).walkRules(rule=>{
  const declarations=new Map<string,string>();rule.walkDecls(declaration=>{declarations.set(declaration.prop,declaration.value);});rules.set(rule.selector,declarations);
 });
 for(const [property,value] of [["border","0"],["box-shadow","none"],["background","var(--muted)"],["max-width","min(100%,200px)"]])assert.equal(rules.get(".recipient-pill")?.get(property),value);
 assert.equal(rules.get(".recipient-label")?.get("text-overflow"),"ellipsis");
 assert.equal(rules.get(".recipient-measurements")?.get("position"),"absolute");
 assert.equal(rules.get(".avatar-tiny")?.get("width"),"20px");
});

test("signed-in controls use muted borders, enabled hover and clear focus while errors take precedence",()=>{
 const controls=".content-area :is([data-slot=input],[data-slot=select-trigger],textarea)",rules:postcss.Rule[]=[];
 postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8")).walkRules(rule=>{if(rule.selector.startsWith(controls))rules.push(rule);});
 // :where keeps disabled guards weightless; the final error selector wins over hover/focus.
 assert.deepEqual(rules.map(rule=>rule.selector),[
  controls,
  `${controls}:where(:not(:disabled,[aria-disabled=true],[data-disabled],[aria-invalid=true],.border-destructive)):hover`,
  `${controls}:where(:not(:disabled,[aria-disabled=true],[data-disabled])):focus-visible`,
  `${controls}:is([aria-invalid=true],.border-destructive)`,
 ]);
 const declarations=rules.map(rule=>{const values=new Map<string,string>();rule.walkDecls(declaration=>{values.set(declaration.prop,declaration.value);});return values;});
 assert.deepEqual(declarations.map(values=>values.get("border-color")),["var(--border)","var(--input)","var(--ring)","var(--destructive)"]);
 assert.equal(declarations[0].get("box-shadow"),"none");
 assert.equal(declarations[2].get("outline"),"2px solid var(--ring)");assert.equal(declarations[2].get("outline-offset"),"2px");
 for(const values of declarations)for(const property of ["color","opacity","pointer-events","cursor"])assert.equal(values.has(property),false);
});

test("portalled drawers and confirmations own the card background token outside the workspace shell",()=>{
 const surfaces=[...(["dialog","drawer","menu"] as const).map(variant=>DialogContent({variant})),DialogContent({className:"envelope-confirmation"}),AlertDialogContent({})];
 for(const surface of surfaces){
  assert.ok(surface.type===DialogPortal||surface.type===AlertDialogPortal);
  const content=Children.toArray(surface.props.children).find(child=>isValidElement<{"data-slot"?:string}>(child)&&["dialog-content","alert-dialog-content"].includes(child.props["data-slot"]??""));
  assert.ok(isValidElement<{className:string}>(content));
  assert.ok(content.props.className.split(" ").includes("[--background:var(--card)]"));
  assert.ok(content.props.className.split(" ").includes("bg-background"));
 }
 const globals=postcss.parse(readFileSync(new URL("../app/globals.css",import.meta.url),"utf8")),cards=new Map<string,string>();
 for(const selector of [":root",".dark"])globals.walkRules(selector,rule=>rule.walkDecls("--card",decl=>{cards.set(selector,decl.value);}));
 assert.equal(cards.get(":root"),"#ffffff");assert.ok(cards.get(".dark"));assert.notEqual(cards.get(".dark"),cards.get(":root"));
});

test("signed-in empty previews and PDF surrounds match the card surface while the wizard footer inherits it",()=>{
 const css=postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8")),surfaces=new Map<string,string>();
 css.walkRules(rule=>{if(rule.parent?.type!=="root")return;rule.walkDecls("background",decl=>{for(const selector of rule.selectors)surfaces.set(selector,decl.value);});});
 for(const selector of [".app-layout :is(.preview-empty,.pdf-frame)",".envelope-drawer :is(.preview-empty,.pdf-frame)"])assert.equal(surfaces.get(selector),"var(--card)");
 assert.equal(surfaces.get(".envelope-wizard-footer"),"var(--background)");
 assert.equal(surfaces.get(".recipient-pill"),"var(--muted)");
 assert.equal(surfaces.get(".login-page"),"var(--auth-background)");assert.equal(surfaces.get(".workspace-loading"),"#f3f3f2");
});

test("workspace identity is a static muted card with only its name and a rounded-square building icon",()=>{
 for(const role of ["admin","sender","read-only",""])for(const demo of [false,true]){
  const workspace:WorkspaceView={company:{id:"northstar",name:"Northstar Studio"},role,userId:"fixture-user",envelopes:[],verificationOnly:false,developmentLinks:false};
  const markup=renderToStaticMarkup(createElement(PathnameContext.Provider,{value:"/"},createElement(Shell,{workspace,demo,children:"Workspace content"})));
  const card=markup.match(/<div class="workspace-card"[^>]*>.*?<\/div>/)?.[0];
  assert.ok(card);assert.equal(markupText(card),"Northstar Studio");
  assert.match(card,/<span class="workspace-icon" aria-hidden="true"><svg[^>]*class="[^"]*lucide-building-2[^"]*"/);
  assert.doesNotMatch(card,/<a\b|<button\b|<small\b|\b(?:role|tabindex|href|aria-haspopup|aria-expanded|disabled)=|avatar|chevron/);
  assert.doesNotMatch(markup,/aria-haspopup="menu"|workspace-switch|workspace-chevron|workspace-menu for/i);
 }
 const rules=new Map<string,Map<string,string>>();
 postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8")).walkRules(rule=>{
  const declarations=new Map<string,string>();rule.walkDecls(declaration=>{declarations.set(declaration.prop,declaration.value);});rules.set(rule.selector,declarations);
 });
 assert.equal(rules.get(".workspace-card")?.get("background"),"color-mix(in srgb,var(--secondary) 75%,var(--card))");
 assert.equal(rules.get(".workspace-card")?.get("border-radius"),"10px");
 for(const [property,value] of [["display","grid"],["place-items","center"],["width","36px"],["height","36px"],["border-radius","8px"],["background","var(--muted)"]])assert.equal(rules.get(".workspace-icon")?.get(property),value);
});

test("signed-in shell keeps readable footer roles, navigation and one conditional email setup notice",()=>{
 const workspace:WorkspaceView={company:{id:"northstar",name:"Northstar Studio"},role:"admin",userId:"administrator",envelopes:[],verificationOnly:true,developmentLinks:false};
 const render=(value:WorkspaceView)=>renderToStaticMarkup(createElement(PathnameContext.Provider,{value:"/settings"},createElement(Shell,{workspace:value,children:"Workspace content"})));
 const markup=render(workspace);
 assert.match(markup,/<small>Administrator<\/small>/);assert.match(markup,/aria-label="Sign out"/);
 assert.match(markup,/<nav aria-label="Main navigation">.*?href="\/team"/);
 assert.match(markup,/aria-current="page"[^>]*class="settings-link active"/);
 assert.equal((markup.match(/class="email-setup-note"/g)??[]).length,1);
 assert.match(markup,/Email delivery is off/);assert.match(markup,/test or email-disabled mode/);assert.match(markup,/href="\/settings\/email-jobs"[^>]*>Setup Guide/);
 assert.doesNotMatch(markup,/Verification mode|Verification workspace|Synthetic records|Live workspace|Email live|workspace-footnote/);
 const enabled=render({...workspace,verificationOnly:false});
 assert.doesNotMatch(enabled,/email-setup-note|Email delivery is off|Email live|delivered by email/);
 for(const [role,label] of [["sender","Sender"],["read-only","Viewer"]])assert.ok(render({...workspace,role}).includes(`<small>${label}</small>`));
});

test("sidebar server render starts expanded with a named native toggle and labeled navigation",()=>{
 const workspace:WorkspaceView={company:{id:"fixture-company",name:"Northstar Studio"},role:"admin",userId:"fixture-user",envelopes:[],verificationOnly:true,developmentLinks:false};
 const markup=renderToStaticMarkup(createElement(PathnameContext.Provider,{value:"/envelopes"},createElement(Shell,{workspace,children:"Workspace content"})));
 assert.match(markup,/data-sidebar-collapsed="false" data-sidebar-ready="false"/);
 assert.match(markup,/<button[^>]*aria-label="Collapse sidebar"[^>]*aria-expanded="true"[^>]*aria-controls="desktop-workspace-navigation"/);
 assert.equal((markup.match(/aria-label="Collapse sidebar"/g)??[]).length,1);
 for(const name of ["Overview","Envelopes","Team","Settings &amp; integrations","Sign out"])assert.ok(markup.includes(`aria-label="${name}"`));
 assert.match(markup,/aria-label="Envelopes" aria-current="page"[^>]*href="\/envelopes"/);
 assert.match(markup,/href="\/settings\/email-jobs"/);assert.match(markup,/>Workspace content</);
});

test("logo mark can decorate the expansion control without repeating a brand name",()=>{
 const mark=renderToStaticMarkup(createElement(AccordBrand,{markOnly:true}));
 assert.match(mark,/<span aria-hidden="true"/);assert.match(mark,/class="accord-brand-mark"/);assert.match(mark,/alt=""/);
 assert.doesNotMatch(mark,/accord-brand-name|>Accord<|tabindex|<button|<a\b/);
 assert.match(renderToStaticMarkup(createElement(AccordBrand)),/class="accord-brand-name">Accord<\/span>/);
});

test("all six Settings routes select their own page and the index redirects to Contacts",()=>{
 const pages={contacts:ContactsSettingsPage,branding:BrandingSettingsPage,"email-jobs":EmailJobsSettingsPage,"delivery-log":DeliveryLogSettingsPage,webhook:WebhookSettingsPage,templates:TemplatesSettingsPage};
 assert.deepEqual(settingsSections.map(section=>section.id),Object.keys(pages));
 for(const section of settingsSections){
  assert.equal(pages[section.id]().props.section,section.id);
  assert.equal(settingsHref(section.id),`/settings/${section.id}`);
 }
 assert.throws(()=>SettingsIndex(),error=>error instanceof Error&&"digest" in error&&error.digest==="NEXT_REDIRECT;replace;/settings/contacts;307;");
});

test("Settings navigation shows only permitted destinations with one visible current page",()=>{
 for(const role of ["admin","sender","read-only"]){
  const allowed=settingsSections.filter(section=>canAccessSettingsSection(section.id,role));
  assert.deepEqual(allowed.map(section=>section.id),role==="admin"?settingsSections.map(section=>section.id):["contacts","templates"]);
  for(const selected of allowed){
   const markup=renderToStaticMarkup(createElement(SettingsNavigation,{section:selected.id,role}));
   const links=markup.match(/<a\b[^>]*>.*?<\/a>/g)??[];
   assert.equal(links.length,allowed.length);
   const active=links.filter(link=>link.includes('aria-current="page"'));
   assert.equal(active.length,1);assert.ok(active[0].includes(`href="${settingsHref(selected.id)}"`));
   for(const section of settingsSections)assert.equal(markup.includes(`href="${settingsHref(section.id)}"`),canAccessSettingsSection(section.id,role));
  }
 }
 assert.equal(renderToStaticMarkup(createElement(SettingsNavigation,{section:"contacts",role:""})).includes("<a"),false);
});

test("Settings renders one selected section and denies admin deep links before mounting a section",()=>{
 for(const role of ["admin","sender","read-only"]){
  const workspace:WorkspaceView={company:{id:"northstar",name:"Northstar Studio"},role,userId:"fixture-user",envelopes:[],verificationOnly:true,developmentLinks:false};
  for(const section of settingsSections){
   const markup=renderToStaticMarkup(createElement(SettingsPage,{section:section.id,workspace}));
   assert.equal((markup.match(/<h1>/g)??[]).length,1);
   const mounted=Array.from(markup.matchAll(/data-settings-section="([^"]+)"/g),match=>match[1]);
   if(canAccessSettingsSection(section.id,role)){
    assert.deepEqual(mounted,[section.id]);assert.doesNotMatch(markup,/role="alert"/);
   }else{
    assert.deepEqual(mounted,[]);assert.match(markup,/role="alert"/);assert.match(markup,/don’t have access/);
    assert.doesNotMatch(markup,/Loading|webhook-secret|brand-name|Download recovery export|Bulk send from a template/);
   }
   const shell=renderToStaticMarkup(createElement(PathnameContext.Provider,{value:settingsHref(section.id)},createElement(Shell,{workspace,children:"Settings content"})));
   assert.match(shell,/aria-current="page"[^>]*class="settings-link active"/);
   assert.ok(shell.includes(`<strong>${section.title.replaceAll("&","&amp;")}</strong>`));
   assert.ok(!shell.includes(`<strong>settings/${section.id}</strong>`));
   if(role!=="admin")assert.doesNotMatch(shell,/Setup Guide/);
  }
 }
});

test("Settings loads only the selected page's data and makes no admin requests for other roles",async()=>{
 const endpoints:Record<SettingsSectionId,string[]>={contacts:["/api/manage/contacts"],branding:["/api/manage/settings"],"email-jobs":["/api/manage/settings","/api/manage/deliveries"],"delivery-log":["/api/manage/deliveries"],webhook:["/api/manage/settings"],templates:["/api/manage/templates","/api/manage/colleagues"]};
 for(const role of ["admin","sender","read-only"]){
  for(const section of settingsSections){
   const requests:string[]=[];
   const request=async<T>(path:string)=>{requests.push(path);return [] as T;};
   if(canAccessSettingsSection(section.id,role)){
    await loadSettingsSection(section.id,role,request);
    assert.deepEqual(requests,endpoints[section.id]);
   }else{
    await assert.rejects(loadSettingsSection(section.id,role,request),/Only company administrators/);
    assert.deepEqual(requests,[]);
   }
  }
 }
});

test("delivery tables show independent accessible empty rows only when their own delivery list is empty",()=>{
 const mail={id:"mail-fixture",envelope_id:null,kind:"signing_invitation",status:"failed",attempts:1,last_error:"Fictional mail failure",created_at:"2026-11-27T00:00:00Z"};
 const webhook={id:"webhook-fixture",envelope_id:"envelope-fixture",event:"envelope.completed",status:"failed",attempts:1,last_error:"Fictional webhook failure",created_at:"2026-11-27T00:00:00Z"};
 for(const hasMail of [false,true])for(const hasWebhooks of [false,true]){
  const log={mail:hasMail?[mail]:[],webhooks:hasWebhooks?[webhook]:[],mailAttempts:[],webhookAttempts:[],runs:[]};
  const markup=renderToStaticMarkup(createElement(SettingsDeliveryLog,{log,role:"admin",busy:false,onRetry:()=>{}}));
  const tables=markup.match(/<table\b[^>]*>[\s\S]*?<\/table>/g)??[];
  assert.equal(tables.length,2);
  for(const [index,populated,message,detail] of [[0,hasMail,"No mail deliveries yet.",mail.last_error],[1,hasWebhooks,"No webhook deliveries yet.",webhook.last_error]] as const){
   const table:string=tables[index];
   const body=table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
   assert.ok(body);assert.equal((table.match(/<th\b/g)??[]).length,5);
   assert.equal((body.match(/<tr\b/g)??[]).length,1);
   assert.equal(body.includes(message),!populated);
   if(populated){
    assert.equal((body.match(/<td\b/g)??[]).length,5);assert.ok(body.includes(detail));
    assert.match(body,/>Retry<\/button>/);assert.doesNotMatch(body,/colspan=/i);
   }else{
    assert.match(body,/^<tr\b[^>]*><td\b[^>]*\bcolspan="5"[^>]*>No (mail|webhook) deliveries yet\.<\/td><\/tr>$/i);
    assert.doesNotMatch(body,/<button\b/);
   }
  }
 }
 const loading=renderToStaticMarkup(createElement(SettingsDeliveryLog,{log:undefined,role:"admin",busy:false,onRetry:()=>{}}));
 assert.doesNotMatch(loading,/No (mail|webhook) deliveries yet\./);
});

test("Branding saves preserve the saved webhook URL and omit its unchanged secret",()=>{
 const current={brand_name:"Northstar Studio",brand_color:"#9b5272",logo:"data:image/png;base64,fictional-logo",retention_days:730,webhook_url:"https://events.example.com/accord"};
 const edits={brandName:"Northstar Legal",brandColor:"#345678",logo:current.logo,retentionDays:180};
 const payload=JSON.parse(JSON.stringify(brandingSettingsPayload(current,edits)));
 assert.deepEqual(payload,{...edits,webhookUrl:current.webhook_url});
 assert.equal("webhookSecret" in payload,false);
 assert.equal(brandingSettingsPayload({...current,webhook_url:null},edits).webhookUrl,null);
 assert.equal(current.brand_name,"Northstar Studio");assert.equal(current.retention_days,730);
});

test("Webhook saves preserve brand, logo and retention and change the secret only when supplied",()=>{
 const current={brand_name:"Northstar Studio",brand_color:"#9b5272",logo:"data:image/png;base64,fictional-logo",retention_days:730,webhook_url:"https://events.example.com/accord"};
 const expected={brandName:current.brand_name,brandColor:current.brand_color,logo:current.logo,retentionDays:current.retention_days,webhookUrl:"https://hooks.example.com/updated"};
 const unchanged=JSON.parse(JSON.stringify(webhookSettingsPayload(current,{url:expected.webhookUrl,secret:""})));
 assert.deepEqual(unchanged,expected);assert.equal("webhookSecret" in unchanged,false);
 const secret="fictional-unit-secret-with-at-least-32-characters";
 assert.deepEqual(webhookSettingsPayload(current,{url:expected.webhookUrl,secret}),{...expected,webhookSecret:secret});
 assert.deepEqual(webhookSettingsPayload(current,{url:"",secret:""}),{...expected,webhookUrl:null});
 assert.equal(webhookSettingsPayload({...current,logo:null},{url:expected.webhookUrl,secret:""}).logo,null);
 assert.equal(current.webhook_url,"https://events.example.com/accord");
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
test("status filter options use sentence-case labels and preserve list and CSV filter values",()=>{
 assert.deepEqual(statusFilterOptions,[
  {value:"all",label:"All statuses"},{value:"draft",label:"Draft"},{value:"sent",label:"Sent"},
  {value:"viewed",label:"Viewed"},{value:"part-signed",label:"Part signed"},{value:"completed",label:"Completed"},
  {value:"declined",label:"Declined"},{value:"voided",label:"Voided"},{value:"expired",label:"Expired"},
 ]);
 for(const {value:state} of statusFilterOptions.slice(1)){
  const e={title:"Supplier NDA",owner_name:"Sam",state,folder:"",tags:[],created_at:"2026-11-10T09:00:00Z"};
  for(const {value:status} of statusFilterOptions)assert.equal(matchesFilters(e,{status}),status==="all"||status===state);
 }
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


const drawerEnvelope:EnvelopeView={id:"fixture-envelope",owner_id:"fixture-owner",title:"Fixture agreement",state:"draft",version:1,routing:"parallel",folder:"",tags:[],created_at:"2026-11-27T00:00:00Z",documents:[{id:"fixture-document",name:"Fixture.pdf",sha256:"fictional-digest",size:100,geometry:[{x:0,y:0,width:612,height:792,rotation:0}]}],recipients:[{id:"fixture-recipient",name:"Avery Morgan",email:"avery@client.test",routing_order:1,status:"pending"}],fields:[],events:[],outputs:[],deliveries:[]};
const drawerWorkspace:WorkspaceView={company:{id:"fixture-company",name:"Northstar Studio"},role:"sender",userId:"fixture-owner",envelopes:[],verificationOnly:true,developmentLinks:false};

test("collapse retains controls and values but hides closed content from keyboard and accessibility",()=>{
 for(const open of [false,true]){
  const markup=renderToStaticMarkup(createElement(Collapse,{open,id:"fixture-filters"},createElement("input",{defaultValue:"Avery",name:"recipient"})));
  assert.match(markup,/value="Avery"/);assert.match(markup,/id="fixture-filters"/);
  assert.equal(markup.includes('inert=""'),!open);
  assert.equal(markup.includes('aria-hidden="true"'),!open);
  assert.equal(markup.includes('data-state="open"'),open);
 }
});

test("motion uses shared eased durations and reduced motion removes animations and delays entirely",()=>{
 const globals=postcss.parse(readFileSync(new URL("../app/globals.css",import.meta.url),"utf8"));
 const motion=postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8"));
 const values=new Map<string,string>();motion.walkRules(":root",rule=>rule.walkDecls(decl=>{values.set(decl.prop,decl.value);}));
 assert.ok(parseInt(values.get("--motion-popup")!)>=180&&parseInt(values.get("--motion-popup")!)<=220);
 assert.ok(parseInt(values.get("--motion-panel")!)>=260&&parseInt(values.get("--motion-panel")!)<=320);
 assert.match(values.get("--motion-ease")!,/^cubic-bezier\(/);
 const reduced=new Map<string,string>();globals.walkAtRules("media",media=>{if(media.params.includes("prefers-reduced-motion: reduce"))media.walkDecls(decl=>{reduced.set(decl.prop,decl.value);assert.equal(decl.important,true);});});
 assert.equal(reduced.get("animation"),"none");assert.equal(reduced.get("transition"),"none");assert.equal(reduced.get("scroll-behavior"),"auto");
});

test("wizard steps require a title, documents, recipients and complete signing assignments in order",()=>{
 assert.equal(envelopeStepError({...drawerEnvelope,title:" "},0),"Enter an envelope title.");
 assert.equal(envelopeStepError({...drawerEnvelope,documents:[],recipients:[]},0),null);
 assert.match(envelopeStepError({...drawerEnvelope,documents:[]},1)??"",/Add at least one PDF/);
 assert.equal(envelopeStepError({...drawerEnvelope,recipients:[]},1),null);
 assert.match(envelopeStepError({...drawerEnvelope,recipients:[]},2)??"",/Add at least one recipient/);
 assert.equal(envelopeStepError(drawerEnvelope,2),null);
 assert.match(envelopeStepError(drawerEnvelope,3)??"",/required signature for every recipient/);
 const signature:Field={id:"fixture-field",documentId:"fixture-document",recipientId:"fixture-recipient",type:"signature",page:0,x:20,y:20,width:180,height:40,required:true};
 const ready={...drawerEnvelope,fields:[signature]};
 assert.equal(envelopeStepError(ready,3),null);assert.equal(envelopeStepError(ready,4),null);
 assert.match(envelopeStepError({...ready,fields:[{...signature,required:false}]},3)??"",/required signature/);
 assert.match(envelopeStepError({...ready,documents:[...ready.documents,{...ready.documents[0],id:"unassigned-document"}]},3)??"",/every document/);
 for(const changed of [{x:600},{documentId:"other-document"},{recipientId:"other-recipient"},{page:1}])assert.match(envelopeStepError({...ready,fields:[{...signature,...changed}]},3)??"",/Every field must fit/);
});

test("embedded editor retains owner and role gates and provides inline loading without a workspace shell",()=>{
 for(const [role,owner,editable] of [["admin","another-owner",true],["sender","fixture-owner",true],["sender","another-owner",false],["read-only","fixture-owner",false]] as const){
  const workspace={...drawerWorkspace,role},envelope={...drawerEnvelope,owner_id:owner};
  assert.deepEqual(envelopePermissions(workspace,envelope),{canManage:editable,editable});
  assert.deepEqual(envelopePermissions(workspace,{...envelope,state:"sent"}),{canManage:editable,editable:false});
  const markup=renderToStaticMarkup(createElement(EnvelopeEditor,{id:envelope.id,workspace,initialEnvelope:envelope,embedded:true}));
  assert.equal(markup.includes("Save draft"),editable);assert.equal(markup.includes("Review &amp; freeze for signing"),editable);
  assert.equal(markup.includes("Sharing"),editable);assert.equal(markup.includes("Reusable template"),editable);
  assert.match(markup,/1. Documents &amp; details/);assert.match(markup,/2. Recipients &amp; routing/);assert.match(markup,/Activity · UTC/);
  assert.doesNotMatch(markup,/app-sidebar|workspace-loading|All envelopes|app-layout/);
 }
 const loading=renderToStaticMarkup(createElement(EnvelopeEditor,{id:"fixture-envelope",workspace:drawerWorkspace,embedded:true}));
 assert.match(loading,/role="status" aria-busy="true"/);assert.match(loading,/sr-only">Loading envelope/);assert.doesNotMatch(loading,/workspace-loading|app-layout|app-sidebar/);
 const frozen=renderToStaticMarkup(createElement(EnvelopeEditor,{id:drawerEnvelope.id,workspace:drawerWorkspace,initialEnvelope:{...drawerEnvelope,state:"sent"},embedded:true}));
 assert.doesNotMatch(frozen,/Save draft|Review &amp; freeze for signing/);assert.match(frozen,/Reminders &amp; links|Signing &amp; evidence/);
});

test("drawer uses one real dialog title with status, default Details and retained inactive Activity; wizard has no activity controls",()=>{
 const render=(creation=false)=>renderToStaticMarkup(createElement(Dialog,{open:true},createElement(EnvelopeEditor,{id:drawerEnvelope.id,workspace:drawerWorkspace,initialEnvelope:drawerEnvelope,embedded:true,creation,onDismiss:()=>{}})));
 const markup=render();
 assert.equal((markup.match(/data-slot="dialog-title"/g)??[]).length,1);
 assert.match(markup,/<h2[^>]*data-slot="dialog-title"[^>]*>Fixture agreement<\/h2>/);
 assert.match(markup,/class="envelope-title-row">.*?Fixture agreement.*?status-draft/);
 assert.doesNotMatch(markup,/Envelope details|Review documents, recipients and signing activity\./);
 assert.match(markup,/aria-selected="true"[^>]*[^<]*id="[^"]*trigger-details"/);
 assert.match(markup,/data-state="inactive"[^>]*[^<]*id="[^"]*content-activity"/);
 assert.match(markup,/Activity · UTC/);
 const wizard=render(true);
 assert.equal((wizard.match(/data-slot="dialog-title"/g)??[]).length,1);
 assert.doesNotMatch(wizard,/role="tablist"|Activity · UTC/);
 assert.match(wizard,/Envelope creation steps/);
});

test("unsaved notices announce their message with a decorative info icon while saved and other notices keep their own styling",()=>{
 assert.equal(renderToStaticMarkup(createElement(EnvelopeNotice,{notice:""})),"");
 for(const unsaved of ["Unsaved changes","Current step saved. Later steps have unsaved changes."]){
  const markup=renderToStaticMarkup(createElement(EnvelopeNotice,{notice:{unsaved}}));
  assert.match(markup,/<p class="notice notice-unsaved" role="status"><svg/);
  const icon=markup.match(/<svg\b[^>]*>/)?.[0];assert.ok(icon);assert.match(icon,/aria-hidden="true"/);assert.match(icon,/class="[^"]*lucide-info/);
  assert.ok(markup.includes(`<span>${unsaved}</span>`));
 }
 for(const notice of ["Draft saved to the database","Envelope shared.","Documents saved privately; review their fields."]){
  const markup=renderToStaticMarkup(createElement(EnvelopeNotice,{notice}));
  assert.match(markup,/<p class="notice" role="status">/);assert.doesNotMatch(markup,/notice-unsaved|<svg/);
 }
 const rules=new Map<string,Map<string,string>>();
 postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8")).walkRules(rule=>{const declarations=new Map<string,string>();rule.walkDecls(decl=>{declarations.set(decl.prop,decl.value);});rules.set(rule.selector,declarations);});
 const unsaved=rules.get(".envelope-feedback .notice-unsaved")!;
 assert.equal(unsaved.get("color"),"#1d4ed8");assert.match(unsaved.get("background")!,/#2563eb 8%/);
 assert.equal(rules.get(".notice")?.get("background"),"var(--muted)");
});

test("preview selectors retain accessible labels and empty-state disabling with scoped borderless four-pixel spacing",()=>{
 const render=(envelope=drawerEnvelope)=>renderToStaticMarkup(createElement(EnvelopeEditor,{id:envelope.id,workspace:drawerWorkspace,initialEnvelope:envelope,embedded:true}));
 const toolbar=render().match(/class="preview-surface"><div class="preview-toolbar">(.*?)<\/div>/)?.[1];
 assert.ok(toolbar);assert.equal((toolbar.match(/role="combobox"/g)??[]).length,2);
 assert.match(toolbar,/aria-label="Preview document"/);assert.match(toolbar,/aria-label="Preview page"/);
 const empty=render({...drawerEnvelope,documents:[]}).match(/class="preview-toolbar">(.*?)<\/div>/)?.[1];
 assert.ok(empty);assert.match(empty,/<button[^>]*disabled=""[^>]*aria-label="Preview document"/);assert.doesNotMatch(empty,/aria-label="Preview page"/);
 const rules=new Map<string,Map<string,string>>();
 postcss.parse(readFileSync(new URL("../app/style.css",import.meta.url),"utf8")).walkRules(rule=>{const declarations=new Map<string,string>();rule.walkDecls(decl=>{declarations.set(decl.prop,decl.value);});rules.set(rule.selector,declarations);});
 const trigger=rules.get(".content-area .envelope-editor .preview-toolbar [data-slot=select-trigger]")!;
 for(const [key,value] of [["gap","4px"],["padding","0"],["border","0"],["background","transparent"],["justify-content","flex-start"],["min-height","44px"]])assert.equal(trigger.get(key),value);
 assert.equal(rules.get(".envelope-editor .preview-toolbar")?.get("position"),"absolute");
 assert.equal(rules.get(".envelope-editor .preview-toolbar [data-slot=select-value]")?.get("text-overflow"),"ellipsis");
});

test("drawer links keep modified clicks and new-tab behavior while ordinary clicks embed the editor",()=>{
 const click={button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,defaultPrevented:false};
 assert.equal(opensEnvelopeDrawer(click),true);
 for(const changed of [{button:1},{button:2},{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true},{defaultPrevented:true}])assert.equal(opensEnvelopeDrawer({...click,...changed}),false);
});


test("saving earlier wizard steps retains unfinished later inputs without submitting them",()=>{
 const saved={...drawerEnvelope,recipients:[],fields:[],version:4};
 const later={...drawerEnvelope,version:5,title:"Renamed fixture",folder:"New folder",recipients:[{...drawerEnvelope.recipients[0],name:"",email:"unfinished",accessCode:"secret-code"}],fields:[{id:"new-field",documentId:"fixture-document",recipientId:"fixture-recipient",type:"signature" as const,page:0,x:900,y:20,width:180,height:40,required:true}]};
 const title=envelopeForStep(later,saved,0);assert.equal(title.title,later.title);assert.equal(title.version,5);assert.equal(title.folder,saved.folder);assert.deepEqual(title.recipients,[]);assert.deepEqual(title.fields,[]);
 const documents=envelopeForStep(later,saved,1);assert.equal(documents.folder,later.folder);assert.deepEqual(documents.recipients,[]);assert.deepEqual(documents.fields,[]);
 const merged=mergeSavedEnvelopeStep(later,{...documents,version:6},1);assert.equal(merged.version,6);assert.equal(merged.id,later.id);assert.deepEqual(merged.documents,later.documents);assert.deepEqual(merged.recipients,later.recipients);assert.deepEqual(merged.fields,later.fields);
 assert.deepEqual(envelopeDraftPayload(merged).recipients[0],{id:"fixture-recipient",name:"",email:"unfinished",order:1,accessCode:"secret-code"});
 assert.deepEqual(envelopeForStep(later,saved,2).recipients,later.recipients);assert.deepEqual(envelopeForStep(later,saved,2).fields,[]);assert.deepEqual(envelopeForStep(later,saved,3).fields,later.fields);
});
