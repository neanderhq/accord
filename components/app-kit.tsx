"use client";
import { useEffect,useState,type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { settingsSections,settingsHref } from "@/app/settings/sections";
import { LayoutDashboard,Files,Users,Settings,ArrowUpRight,Mail,Building2,Database,LogOut,Menu,TriangleAlert } from "lucide-react";
import { AccordBrand,WorkspaceLoader } from "@/components/accord-brand";
import { InitialsAvatar } from "@/components/initials-avatar";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert,AlertTitle,AlertDescription } from "@/components/ui/alert";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
const emptyWorkspace: WorkspaceView = {company:{id:"",name:"Team workspace"},role:"",userId:"",envelopes:[],verificationOnly:true,developmentLinks:false};
import type { WorkspaceView } from "@/lib/ui-types";
export class ApiError extends Error {constructor(message:string,public code:string,public status:number){super(message);}}
export async function api<T>(path:string,init:RequestInit={}):Promise<T> {const r=await fetch(path,{...init,headers:{...(init.body&&!(init.body instanceof File)?{"Content-Type":"application/json"}:{}),...init.headers}});const unreadable=Symbol(),value=await r.json().catch(()=>unreadable);if(!r.ok)throw new ApiError(value?.error??value?.message??`Request failed (HTTP ${r.status}). Reload and try again.`,value?.code??"REQUEST_FAILED",r.status);if(value===unreadable)throw new ApiError("The server returned an unreadable response. Reload and try again.","BAD_RESPONSE",r.status);return value;}
export function useWorkspace(){const [workspace,setWorkspace]=useState(emptyWorkspace),[loading,setLoading]=useState(true),[error,setError]=useState<ApiError|null>(null);useEffect(()=>{api<WorkspaceView>("/api/workspace").then(setWorkspace).catch(setError).finally(()=>setLoading(false));},[]);return {workspace,loading,error,demo:false};}
export function Choice({value,onChange,options,label}:{value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];label:string}){return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="w-full"><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;}
export function ErrorNotice({error}:{error:Error|string|null}){return error?<Alert variant="destructive"><TriangleAlert/><AlertTitle>Action needed</AlertTitle><AlertDescription>{typeof error==="string"?error:error.message}</AlertDescription></Alert>:null;}
export function Status({state}:{state:string}){return <Badge variant="outline" className={`status status-${state}`}><span className="status-dot"/>{({"part-signed":"Part signed",draft:"Draft",sent:"Awaiting signature",viewed:"Viewed",completed:"Completed",voided:"Voided",declined:"Declined",expired:"Expired"} as Record<string,string>)[state]??state}</Badge>;}
const nav=[{label:"Overview",href:"/",icon:LayoutDashboard},{label:"Envelopes",href:"/envelopes",icon:Files},{label:"Team",href:"/team",icon:Users}];
export function Shell({children,workspace=emptyWorkspace,demo=false,loading=false,error}:{children:ReactNode;workspace?:WorkspaceView;demo?:boolean;loading?:boolean;error?:ApiError|null}) {
 const path=usePathname(),[mobile,setMobile]=useState(false);
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
 if(error?.status===401)return <AuthFrame><CardSetup error={error}/></AuthFrame>;
 if(loading&&!error)return <WorkspaceLoader/>;
 const sidebar = (className = "app-sidebar") => <aside className={className}><Link href="/" className="brand-link" onClick={closeMenu}><AccordBrand/></Link>
 <div className="workspace-card"><span className="workspace-icon" aria-hidden="true"><Building2 size={18}/></span><span className="workspace-identity"><strong>{companyName}</strong></span></div>
 <p className="nav-caption">Workspace</p><nav aria-label="Main navigation">{nav.map(n=>{const active=path===n.href||(n.href==="/envelopes"&&path.startsWith("/envelopes/"));return <Link key={n.href} onClick={closeMenu} href={n.href} aria-current={active?"page":undefined} className={active?"active":""}><n.icon size={18}/>{n.label}{n.label==="Envelopes"&&<span className="nav-count">{workspace.envelopes.length}</span>}</Link>;})}</nav>
 <div className="sidebar-bottom"><p className="nav-caption">Manage</p><Link href="/settings" aria-current={settingsActive?"page":undefined} className={`settings-link${settingsActive?" active":""}`} onClick={closeMenu}><Settings size={18}/>Settings & integrations</Link>{workspace.verificationOnly&&<div className="email-setup-note"><Mail size={16} aria-hidden="true"/><div><strong>Email delivery is off</strong><p>Signing emails aren’t delivered in this test or email-disabled mode.</p>{workspace.role==="admin"?<Link href="/settings/email-jobs" onClick={closeMenu}>Setup Guide <ArrowUpRight size={12} aria-hidden="true"/></Link>:<p>Ask your administrator to configure delivery.</p>}</div></div>}<div className="user-block"><InitialsAvatar id={workspace.userId} fallback={demo?"SY":"ME"}/><div><strong>{demo?"Synthetic preview":"Your workspace"}</strong><small>{demo?"Display only":roleLabel}</small></div>{!demo&&<Button variant="ghost" size="icon" aria-label="Sign out" onClick={async()=>{await api("/api/auth/sign-out",{method:"POST",body:"{}"});location.href="/login";}}><LogOut/></Button>}</div></div></aside>;
 return <div className="app-layout">{sidebar()}
 <div className="app-main"><header className="topbar"><Dialog open={mobile} onOpenChange={setMobile}>
   <DialogTrigger asChild><Button variant="ghost" size="icon" className="mobile-menu" aria-label="Toggle menu"><Menu/></Button></DialogTrigger>
   <DialogContent className="mobile-workspace-menu top-0 left-0 flex h-dvh w-[min(280px,100vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none border-0 p-0 sm:max-w-none">
     <DialogTitle className="sr-only">Workspace menu</DialogTitle>
     <DialogDescription className="sr-only">Navigate your Accord workspace.</DialogDescription>
     {sidebar("app-sidebar mobile-open")}
   </DialogContent>
 </Dialog><span className="breadcrumb">Workspace <span>/</span> {settingsActive?<><Link href="/settings">Settings</Link>{settingsSection&&<><span>/</span><strong>{settingsSection.title}</strong></>}</>:<strong>{path.startsWith("/envelopes")?"Envelopes":path==="/"?"Overview":path==="/team"?"Team":path.slice(1)}</strong>}</span><div className="topbar-right"><Button asChild variant="ghost" size="icon"><Link href="/settings" aria-label="Workspace setup"><Settings size={18}/></Link></Button></div></header>
 <main className="content-area">{error?<CardSetup error={error}/>:children}</main><footer className="app-footer"><span>Accord</span><span>Private documents. Clear evidence.</span></footer></div></div>;
}
export function PageHeading({eyebrow,title,description,action}:{eyebrow?:string;title:string;description:string;action?:ReactNode}){return <div className="page-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{action}</div>;}
export function Empty({title,children}:{title:string;children:ReactNode}){return <div className="empty-state"><Files/><h3>{title}</h3><p>{children}</p></div>;}

function CardSetup({error}:{error:ApiError}){return <section className="setup-state"><Database size={32}/><p className="eyebrow">{error.status===401?"SIGNED OUT":"WORKSPACE SETUP"}</p><h1>{error.status===401?"Sign in to your company":"Your workspace needs a connection"}</h1><p>{error.status===401?"Sign in to access your company’s documents and signing records.":"Private documents and signing records require the project’s PostgreSQL database. Nothing is saved until setup is complete."}</p><ErrorNotice error={error}/><div className="flex flex-wrap gap-3"><Button asChild><Link href={error.status===401?"/login":"/settings"}>{error.status===401?"Sign in":"View setup steps"}</Link></Button><Button variant="outline" onClick={()=>location.reload()}>Check again</Button></div><p className="text-sm text-muted-foreground">Contact your workspace administrator if you need access or help with setup.</p></section>;}
