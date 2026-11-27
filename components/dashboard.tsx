"use client";
import { useMemo,useRef,useState,type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus,Search,Download,Clock3,FileCheck2,FilePenLine,Send,ChevronRight,SlidersHorizontal,Users } from "lucide-react";
import { Shell,useWorkspace,PageHeading,Status,Choice,Empty,ErrorNotice } from "./app-kit";
import { InitialsAvatar } from "./initials-avatar";
import { avatarColor,identityHash } from "@/lib/avatar";
import { EnvelopeRecipients } from "./envelope-recipients";
export { EnvelopeRecipients } from "./envelope-recipients";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card,CardContent,CardHeader,CardTitle } from "./ui/card";
import { Table,TableHeader,TableBody,TableRow,TableHead,TableCell } from "./ui/table";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Collapse } from "./ui/collapse";
import { EnvelopeDrawer } from "./composer";
import { opensEnvelopeDrawer } from "@/lib/envelope-wizard";

export const statusFilterOptions=[{value:"all",label:"All statuses"},...['draft','sent','viewed','part-signed','completed','declined','voided','expired'].map(s=>({value:s,label:s[0].toUpperCase()+s.slice(1).replace('-',' ')}))];

// Decorative covers identify envelopes consistently; they never fetch document contents.
export function DocumentCover({id}:{id:string}) {
 const {background,foreground}=avatarColor(`document:${id}`),motif=identityHash(id)%3;
 return <svg className="document-cover" width="48" height="52" viewBox="0 0 48 52" fill="none" aria-hidden="true" focusable="false">
  <rect width="48" height="52" rx="10" fill={background}/>
  <circle cx="43" cy="6" r="17" fill={foreground} opacity=".06"/>
  <circle cx="3" cy="50" r="15" fill={foreground} opacity=".08"/>
  <path d="M14 9h15l8 8v26a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z" fill={foreground} opacity=".08"/>
  <path d="M13 7h15l8 8v26a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" fill="white" opacity=".96"/>
  <path d="M28 7v6a2 2 0 0 0 2 2h6" fill={background}/>
  <g fill={foreground} opacity=".55">{motif===0?<><circle cx="20" cy="21" r="4"/><circle cx="25" cy="21" r="4" opacity=".45"/></>:motif===1?<><path d="m21 16 5 5-5 5-5-5Z"/><circle cx="28" cy="24" r="2" opacity=".45"/></>:<><rect x="16" y="19" width="5" height="7" rx="1" opacity=".5"/><rect x="23" y="16" width="6" height="10" rx="1"/></>}</g>
  <g stroke={foreground} strokeWidth="1.4" strokeLinecap="round"><path d="M16 30h14M16 33h10" opacity=".22"/><path d="m16 38 3-2-1 3 4-2 2 1h5" opacity=".6"/></g>
 </svg>;
}

type DrawerTarget={kind:"create"}|{kind:"detail";id:string};

export function Dashboard(){const overview=usePathname()==="/";const {workspace,loading,error,demo,refresh,refreshError}=useWorkspace();const [search,setSearch]=useState(""),[status,setStatus]=useState("all"),[folder,setFolder]=useState("all"),[tag,setTag]=useState("all"),[from,setFrom]=useState(""),[to,setTo]=useState(""),[recipient,setRecipient]=useState("all"),[visibility,setVisibility]=useState("active");const [advanced,setAdvanced]=useState(false);
const [drawer,setDrawer]=useState<(DrawerTarget&{session:number})|null>(null),drawerTrigger=useRef<HTMLAnchorElement|null>(null),drawerSession=useRef(0);
function openDrawer(event:MouseEvent<HTMLAnchorElement>,target:DrawerTarget){if(!opensEnvelopeDrawer(event))return;event.preventDefault();drawerTrigger.current=event.currentTarget;setDrawer({...target,session:++drawerSession.current});}
function closeDrawer(session:number){if(session!==drawerSession.current)return;setDrawer(null);void refresh();}
const rows=useMemo(()=>workspace.envelopes.filter(e=>(status==="all"||e.state===status)&&(folder==="all"||e.folder===folder)&&(tag==="all"||e.tags.includes(tag))&&(!from||e.created_at.slice(0,10)>=from)&&(!to||e.created_at.slice(0,10)<=to)&&(recipient==="all"||e.recipients?.some(r=>`${r.name} ${r.email}`.toLowerCase().includes(recipient.toLowerCase())))&&(`${e.title} ${e.owner_name} ${e.recipients?.map(r=>r.name+" "+r.email).join(" ")??""}`).toLowerCase().includes(search.toLowerCase())&&(visibility==="deleted"?!!e.deleted_at:visibility==="archived"?!!e.archived_at&&!e.deleted_at:!e.deleted_at&&!e.archived_at)),[workspace,search,status,folder,tag,from,to,recipient,visibility]);
const senders=new Map<string,string>();for(const e of workspace.envelopes)senders.set(e.owner_id??e.owner_name??"",e.owner_name??"Sender");
const usage=Array.from(senders,([id,name])=>{const own=workspace.envelopes.filter(e=>(e.owner_id??e.owner_name??"")===id);return {id,name,total:own.length,sent:own.filter(e=>e.state!=="draft").length,completed:own.filter(e=>e.state==="completed").length};}).sort((a,b)=>b.total-a.total);
const counters=[{label:"All envelopes",value:workspace.envelopes.length,icon:FilePenLine,help:"Including archived and deleted"},{label:"Awaiting signature",value:workspace.envelopes.filter(e=>["sent","viewed","part-signed"].includes(e.state)).length,icon:Clock3,help:"Sent and in progress"},{label:"Completed",value:workspace.envelopes.filter(e=>e.state==="completed").length,icon:FileCheck2,help:"Ready for your records"},{label:"Drafts",value:workspace.envelopes.filter(e=>e.state==="draft").length,icon:Send,help:"Not sent for signing"},{label:"Senders",value:senders.size,icon:Users,help:"People with envelopes"}];
return <Shell {...{workspace,loading,error,demo}}>
<PageHeading title={overview?"Overview":"Envelopes"} description={overview?"Track signing activity across your workspace.":"Manage your documents from draft to completed."} action={workspace.role!=="read-only"&&<Button asChild><Link href="/envelopes/new" onClick={event=>openDrawer(event,{kind:"create"})}><Plus/>Create envelope</Link></Button>}/>
<ErrorNotice error={refreshError}/>
{overview&&<div className="stats-grid">{counters.map(c=><Card key={c.label} className="stat-card"><CardContent><div className="stat-label">{c.label}<c.icon size={17}/></div><div className="stat-value">{c.value}</div><p>{demo?"Synthetic display · ":""}{c.help}</p></CardContent></Card>)}</div>}
<Card className="envelopes-card">
 <CardHeader className="section-header"><div><CardTitle>{overview?"Envelopes":"All envelopes"}</CardTitle><p>Search and filter your workspace documents.</p></div><div className="section-actions">{overview&&<Button variant="ghost" asChild><Link href="/envelopes">View all<ChevronRight/></Link></Button>}<Button variant="outline" disabled={demo||loading} asChild={!demo&&!loading}>{demo||loading?<span><Download/>Export CSV</span>:<a href={`/api/envelopes?${new URLSearchParams({search,status,folder,tag,from,to,recipient,visibility})}`}><Download/>Export CSV</a>}</Button></div></CardHeader>
 <CardContent className="envelopes-content">
  <div className="filter-bar"><div className="search-input"><Search size={16}/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search title, sender or recipient…" aria-label="Search envelopes"/></div><div className="status-filter"><Choice label="Status" value={status} onChange={setStatus} options={statusFilterOptions}/></div><div className="status-filter"><Choice label="Show" value={visibility} onChange={setVisibility} options={[{value:"active",label:"Active envelopes"},{value:"archived",label:"Archived envelopes"},...(workspace.role==="admin"?[{value:"deleted",label:"Deleted envelopes"}]:[])]}/></div><Button variant="outline" aria-label="Additional filters" aria-expanded={advanced} aria-controls="envelope-advanced-filters" onClick={()=>setAdvanced(!advanced)}><SlidersHorizontal/>Filters</Button></div>
  <Collapse open={advanced} id="envelope-advanced-filters"><div className="advanced-filters"><div className="filter-field"><span>Folder</span><Choice label="Folder" value={folder} onChange={setFolder} options={[{value:"all",label:"All folders"},...Array.from(new Set(workspace.envelopes.map(e=>e.folder).filter(Boolean))).map(s=>({value:s,label:s}))]}/></div><div className="filter-field"><span>Tag</span><Choice label="Tag" value={tag} onChange={setTag} options={[{value:"all",label:"All tags"},...Array.from(new Set(workspace.envelopes.flatMap(e=>e.tags))).map(s=>({value:s,label:s}))]}/></div><div className="filter-field"><Label htmlFor="envelopes-from">Created from</Label><Input id="envelopes-from" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div className="filter-field"><Label htmlFor="envelopes-to">Created to</Label><Input id="envelopes-to" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div><div className="filter-field"><Label htmlFor="envelopes-recipient">Recipient</Label><Input id="envelopes-recipient" type="search" placeholder="Name or email" value={recipient==="all"?"":recipient} onChange={e=>setRecipient(e.target.value||"all")}/></div></div></Collapse>
  {/* Explicit roles preserve table semantics when mobile rows use a grid layout. */}
  <Table role="table" aria-label="Envelopes"><TableHeader role="rowgroup"><TableRow role="row"><TableHead role="columnheader" scope="col">Document / envelope</TableHead><TableHead role="columnheader" scope="col">Recipients</TableHead><TableHead role="columnheader" scope="col">Status</TableHead><TableHead role="columnheader" scope="col">Created</TableHead><TableHead role="columnheader" scope="col"><span className="sr-only">Open</span></TableHead></TableRow></TableHeader><TableBody role="rowgroup">{rows.map(e=><TableRow key={e.id} role="row"><TableCell role="cell"><Link href={`/envelopes/${e.id}`} onClick={event=>openDrawer(event,{kind:"detail",id:e.id})} className="document-link"><DocumentCover id={e.id}/><span><strong>{e.title}</strong><small>{e.document_count??0} documents <span>·</span> {e.owner_name}</small></span></Link></TableCell><TableCell role="cell"><span className="envelope-mobile-label" aria-hidden="true">Recipients</span><EnvelopeRecipients recipients={e.recipients??[]}/></TableCell><TableCell role="cell"><Status state={e.state}/>{e.deleted_at?<Badge variant="outline" className="ml-1">Deleted</Badge>:e.archived_at?<Badge variant="outline" className="ml-1">Archived</Badge>:null}</TableCell><TableCell role="cell" className="whitespace-nowrap text-muted-foreground"><span className="envelope-mobile-label" aria-hidden="true">Created</span>{new Date(e.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</TableCell><TableCell role="cell"><Button variant="ghost" size="icon" asChild><Link href={`/envelopes/${e.id}`} onClick={event=>openDrawer(event,{kind:"detail",id:e.id})} aria-label={`Open ${e.title}`}><ChevronRight size={17}/></Link></Button></TableCell></TableRow>)}</TableBody></Table>
  {!rows.length&&<Empty title="No envelopes here yet">Create an envelope or adjust your filters to get started.</Empty>}
  <div className="table-footer"><span>{rows.length} envelope{rows.length!==1?'s':''}{demo?" · synthetic display":""}</span><span>All times shown in your local timezone</span></div>
 </CardContent>
</Card>
{overview&&<Card className="sender-summary"><CardHeader><CardTitle>Sender usage</CardTitle><p className="text-sm text-muted-foreground">Envelope totals by owner, including archived and deleted records.</p></CardHeader><CardContent>{usage.length?<ul className="sender-usage">{usage.map(u=><li key={u.id}><InitialsAvatar id={u.id} name={u.name}/><div><strong>{u.name}</strong><p>{u.total} total · {u.sent} non-draft · {u.completed} completed</p></div></li>)}</ul>:<p className="text-sm text-muted-foreground">No envelopes yet.</p>}</CardContent></Card>}
{drawer&&<EnvelopeDrawer key={drawer.session} target={drawer} workspace={workspace} onClose={()=>closeDrawer(drawer.session)} onSaved={refresh} returnFocus={()=>{if(drawer.session!==drawerSession.current)return;const trigger=drawerTrigger.current;const target=trigger?.isConnected?trigger:document.querySelector<HTMLInputElement>('[aria-label="Search envelopes"]');target?.focus({preventScroll:true});}}/>}
</Shell>;}
