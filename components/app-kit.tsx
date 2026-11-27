"use client";
import { useEffect,useState,type ReactElement,type ReactNode } from "react";
import Link from "./workspace-link";
import { usePathname } from "next/navigation";
import { settingsSections,settingsHref } from "@/app/settings/sections";
import { LayoutDashboard,Files,Users,Settings,ArrowUpRight,Mail,Building2,Database,LogOut,Menu,TriangleAlert,PanelLeftClose,PanelLeftOpen } from "lucide-react";
import { AccordBrand } from "@/components/accord-brand";
import { InitialsAvatar } from "@/components/initials-avatar";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Card,CardHeader,CardDescription,CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert,AlertTitle,AlertDescription } from "@/components/ui/alert";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip,TooltipContent,TooltipProvider,TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceView } from "@/lib/ui-types";
import { api,ApiError } from "@/lib/client-api";
import { emptyWorkspace,useWorkspaceNavigation } from "./workspace-context";
import { ContentLoader } from "./content-loader";
export { api,ApiError } from "@/lib/client-api";
export { useWorkspace } from "./workspace-context";
export function Choice({value,onChange,options,label,disabled=false}:{disabled?:boolean;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];label:string}){return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label} className="w-full"><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;}
export function ErrorNotice({error}:{error:Error|string|null}){return error?<Alert variant="destructive"><TriangleAlert/><AlertTitle>Action needed</AlertTitle><AlertDescription>{typeof error==="string"?error:error.message}</AlertDescription></Alert>:null;}
export function Status({state}:{state:string}){return <Badge variant="outline" className={`status status-${state}`}><span className="status-dot"/>{({"part-signed":"Part signed",draft:"Draft",sent:"Awaiting signature",viewed:"Viewed",completed:"Completed",voided:"Voided",declined:"Declined",expired:"Expired"} as Record<string,string>)[state]??state}</Badge>;}
const nav=[{label:"Overview",href:"/",icon:LayoutDashboard},{label:"Envelopes",href:"/envelopes",icon:Files},{label:"Team",href:"/team",icon:Users}];
const sidebarPreference="accord:sidebar-collapsed";
function SidebarHint({children,label,enabled=true}:{children:ReactElement;label:string;enabled?:boolean}){return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger>{enabled&&<TooltipContent side="right" sideOffset={12}>{label}</TooltipContent>}</Tooltip>;}
export function Shell({children,workspace=emptyWorkspace,demo=false,loading=false,error,refreshError,refreshing=false,refresh}:{children:ReactNode;workspace?:WorkspaceView;demo?:boolean;loading?:boolean;error?:ApiError|null;refreshError?:ApiError|null;refreshing?:boolean;refresh?:()=>Promise<void>}) {
 const path=usePathname(),[mobile,setMobile]=useState(false);
 const [collapsed,setCollapsed]=useState(false),[preferenceReady,setPreferenceReady]=useState(false);
 useEffect(()=>{
   // Presentation only: the server and first client render share the same state.
   try{setCollapsed(localStorage.getItem(sidebarPreference)==="true");}catch{/* Storage may be disabled. */}
   setPreferenceReady(true);
 },[]);
 const toggleSidebar=()=>{
   const next=!collapsed;setCollapsed(next);
   try{localStorage.setItem(sidebarPreference,String(next));}catch{/* Keep the in-memory preference. */}
 };
 const {pendingHref}=useWorkspaceNavigation(),routePending=!!pendingHref;
 const settingsPending=routePending&&path.startsWith("/settings")&&pendingHref.startsWith("/settings");
 useEffect(() => {
   const desktop = window.matchMedia("(min-width: 901px)");
   const closeOnDesktop = () => { if (desktop.matches) setMobile(false); };
   desktop.addEventListener("change", closeOnDesktop);
   return () => desktop.removeEventListener("change", closeOnDesktop);
 }, []);
 const closeMenu = () => setMobile(false);
 const settingsActive = path==="/settings"||path.startsWith("/settings/");
 const settingsSection = settingsSections.find(section=>path===settingsHref(section.id));
 const companyName = workspace.company.name.replace(" (Synthetic)","");
 const roleLabel = ({admin:"Administrator",sender:"Sender","read-only":"Viewer"} as Record<string,string>)[workspace.role]??"Member";
 if(error?.status===401)return <AuthFrame><Card><CardHeader><h1 data-slot="card-title">Welcome back</h1><CardDescription>Sign in to your company workspace.</CardDescription></CardHeader><CardContent><Button asChild size="lg" className="w-full"><Link href="/login">Sign in</Link></Button></CardContent></Card></AuthFrame>;
 const sidebar = (mobileMenu=false) => {
 const compact=collapsed&&!mobileMenu;
 const workspaceLabel=`${companyName} · ${demo?"Synthetic preview · Display only":roleLabel}`;
 const emailLabel=`Email delivery is off. Signing emails aren’t delivered in this test or email-disabled mode.${workspace.role!=="admin"?" Ask your administrator to configure delivery.":""}`;
 return <aside id={mobileMenu?undefined:"desktop-workspace-navigation"} aria-label={mobileMenu?"Workspace menu":"Workspace sidebar"} data-collapsed={compact} className={`app-sidebar${mobileMenu?" mobile-open":""}`}>
 <div className="sidebar-header"><Link href="/" className="brand-link" onClick={closeMenu} aria-label="Accord overview" aria-hidden={compact||undefined} inert={compact} tabIndex={compact?-1:undefined}><AccordBrand/></Link>
 {!mobileMenu&&<SidebarHint label={compact?"Expand sidebar":"Collapse sidebar"}><Button variant="ghost" size="icon" className="sidebar-toggle" data-slot="button" aria-label={compact?"Expand sidebar":"Collapse sidebar"} aria-expanded={!compact} aria-controls="desktop-workspace-navigation" onClick={toggleSidebar}><AccordBrand markOnly className="sidebar-toggle-mark"/><PanelLeftOpen className="sidebar-expand-icon" aria-hidden="true"/><PanelLeftClose className="sidebar-collapse-icon" aria-hidden="true"/></Button></SidebarHint>}</div>
 <SidebarHint enabled={compact} label={workspaceLabel}><div className="workspace-card" role={compact?"group":undefined} tabIndex={compact?0:undefined} aria-label={compact?workspaceLabel:undefined}><span className="workspace-icon" aria-hidden="true"><Building2 size={18}/></span><span className="workspace-identity"><strong>{companyName}</strong></span></div></SidebarHint>
 <p className="nav-caption" aria-hidden={compact||undefined}>Workspace</p><nav aria-label="Main navigation">{nav.map(n=>{const active=path===n.href||(n.href==="/envelopes"&&path.startsWith("/envelopes/"));return <SidebarHint key={n.href} enabled={compact} label={n.label==="Envelopes"?`Envelopes · ${workspace.envelopes.length}`:n.label}><Link onClick={closeMenu} href={n.href} aria-label={n.label} aria-current={active?"page":undefined} className={active?"active":""}><n.icon size={18} aria-hidden="true"/><span className="sidebar-label">{n.label}</span>{n.label==="Envelopes"&&<span className="nav-count" aria-hidden={compact||undefined}>{workspace.envelopes.length}</span>}</Link></SidebarHint>;})}</nav>
 <div className="sidebar-bottom"><p className="nav-caption" aria-hidden={compact||undefined}>Manage</p><SidebarHint enabled={compact} label="Settings & integrations"><Link href="/settings" aria-label="Settings & integrations" aria-current={settingsActive?"page":undefined} className={`settings-link${settingsActive?" active":""}`} onClick={closeMenu}><Settings size={18} aria-hidden="true"/><span className="sidebar-label">Settings & integrations</span></Link></SidebarHint>{workspace.verificationOnly&&<SidebarHint enabled={compact} label={emailLabel}><div className="email-setup-note" role={compact?"group":undefined} tabIndex={compact?0:undefined} aria-label={compact?emailLabel:undefined}><Mail size={16} aria-hidden="true"/><div className="sidebar-note-copy" inert={compact} aria-hidden={compact||undefined}><strong>Email delivery is off</strong><p>Signing emails aren’t delivered in this test or email-disabled mode.</p>{workspace.role==="admin"?<Link href="/settings/email-jobs" onClick={closeMenu} tabIndex={compact?-1:undefined}>Setup Guide <ArrowUpRight size={12} aria-hidden="true"/></Link>:<p>Ask your administrator to configure delivery.</p>}</div></div></SidebarHint>}<div className={`user-block${demo?" user-block-demo":""}`}><InitialsAvatar id={workspace.userId} fallback={demo?"SY":"ME"}/><div className="sidebar-user-copy" aria-hidden={compact||undefined}><strong>{demo?"Synthetic preview":"Your workspace"}</strong><small>{demo?"Display only":roleLabel}</small></div>{!demo&&<SidebarHint label="Sign out"><Button variant="ghost" size="icon" data-slot="button" aria-label="Sign out" onClick={async()=>{await api("/api/auth/sign-out",{method:"POST",body:"{}"});location.href="/login";}}><LogOut aria-hidden="true"/></Button></SidebarHint>}</div></div></aside>;
 };
 return <TooltipProvider delayDuration={150}><div className="app-layout" data-sidebar-collapsed={collapsed} data-sidebar-ready={preferenceReady}>{sidebar()}
 <div className="app-main"><header className="topbar"><Dialog open={mobile} onOpenChange={setMobile}>
   <DialogTrigger asChild><Button variant="ghost" size="icon" className="mobile-menu" aria-label="Toggle menu"><Menu/></Button></DialogTrigger>
   <DialogContent variant="menu" onKeyDown={event=>{if(event.key==="Escape")closeMenu();}} className="mobile-workspace-menu top-0 left-0 flex h-dvh w-[min(280px,100vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none border-0 p-0 sm:max-w-none">
     <DialogTitle className="sr-only">Workspace menu</DialogTitle>
     <DialogDescription className="sr-only">Navigate your Accord workspace.</DialogDescription>
     {sidebar(true)}
   </DialogContent>
 </Dialog><span className="breadcrumb">Workspace <span>/</span> {settingsActive?<><Link href="/settings">Settings</Link>{settingsSection&&<><span>/</span><strong>{settingsSection.title}</strong></>}</>:<strong>{path.startsWith("/envelopes")?"Envelopes":path==="/"?"Overview":path==="/team"?"Team":path.slice(1)}</strong>}</span><div className="topbar-right"><Button asChild variant="ghost" size="icon"><Link href="/settings" aria-label="Workspace setup"><Settings size={18}/></Link></Button></div></header>
 <main className="content-area" aria-busy={loading||refreshing||routePending}>{error?<CardSetup error={error} onRetry={refresh}/>:loading?<ContentLoader/>:<>{refreshing&&<div className="workspace-updating"><ContentLoader compact label="Updating workspace"/></div>}{refreshError&&<div className="workspace-refresh-error"><ErrorNotice error={refreshError}/><Button variant="outline" onClick={()=>void refresh?.()}>Try again</Button></div>}<div hidden={routePending&&!settingsPending}>{children}</div>{routePending&&!settingsPending&&<ContentLoader/>}</>}</main><footer className="app-footer"><span>Accord</span><span>Private documents. Clear evidence.</span></footer></div></div></TooltipProvider>;
}
export function PageHeading({eyebrow,title,description,action}:{eyebrow?:string;title:string;description:string;action?:ReactNode}){return <div className="page-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{action}</div>;}
export function Empty({title,children}:{title:string;children:ReactNode}){return <div className="empty-state"><Files/><h3>{title}</h3><p>{children}</p></div>;}

function CardSetup({error,onRetry}:{error:ApiError;onRetry?:()=>Promise<void>}){return <section className="setup-state"><Database size={32}/><p className="eyebrow">WORKSPACE SETUP</p><h1>Your workspace needs a connection</h1><p>Private documents and signing records require the project’s PostgreSQL database. Nothing is saved until setup is complete.</p><ErrorNotice error={error}/><div className="flex flex-wrap gap-3"><Button asChild><Link href="/settings">View setup steps</Link></Button><Button variant="outline" onClick={()=>void onRetry?.()}>Check again</Button></div><p className="text-sm text-muted-foreground">Contact your workspace administrator if you need access or help with setup.</p></section>;}
