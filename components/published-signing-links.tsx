"use client";

import { useEffect, useState } from "react";
import { api, ErrorNotice } from "./app-kit";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Template={id:string;name:string;roles:unknown[]};
type Publication={id:string;template_id:string;template_name:string;title:string;active:boolean;publisher_active:boolean};

export function PublishedSigningLinks({templates}:{templates:Template[]}) {
  const [links,setLinks]=useState<Publication[]>([]);
  const [templateId,setTemplateId]=useState("");
  const [title,setTitle]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState<Error|null>(null);
  const url="/api/manage/signing-links";
  useEffect(()=>{api<Publication[]>(url).then(setLinks).catch(setError);},[]);
  const choices=templates.filter(template=>template.roles.length===1);
  async function change(body:unknown,message:string){
    setBusy(true);setError(null);setNotice("");
    try{setLinks(await api<Publication[]>(url,{method:"POST",body:JSON.stringify(body)}));setNotice(message);}
    catch(err){setError(err as Error);}finally{setBusy(false);}
  }
  return <Card><CardHeader><CardTitle>Self-service signing links</CardTitle></CardHeader>
    <CardContent className="form-stack">
      <p className="text-sm text-muted-foreground">Publish a one-signer template. Visitors verify their email before Accord creates their own envelope. Disabling a link stops new starts and pending verifications. Publish it again after changing the source envelope.</p>
      {!choices.length&&<p>Save a single-signer template to publish a link.</p>}
      {!!choices.length&&<form className="form-stack" onSubmit={event=>{
        event.preventDefault();void change({action:"publish",templateId,title},"Signing link published.");
      }}>
        <Label htmlFor="public-template">Signing link template</Label>
        <select id="public-template" className="min-h-10 w-full rounded-md border bg-background px-3" required value={templateId} onChange={event=>setTemplateId(event.target.value)}>
          <option value="">Choose a template</option>
          {choices.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <Label htmlFor="public-title">Public title</Label>
        <Input id="public-title" required maxLength={120} value={title} onChange={event=>setTitle(event.target.value)}/>
        <Button disabled={busy||!templateId||!title.trim()}>Publish signing link</Button>
      </form>}
      {links.map(link=><div key={link.id} className="form-stack rounded-md border p-3">
        <strong className="break-words">{link.title}</strong>
        <p className="text-sm text-muted-foreground">{link.template_name} · {link.active?(link.publisher_active?"Published":"Publisher inactive"):"Disabled"}</p>
        {link.active&&link.publisher_active&&<a className="break-all text-sm text-primary underline" href={`/start/${link.id}`} target="_blank" rel="noreferrer">{typeof location!=="undefined"?location.origin:""}/start/{link.id}</a>}
        {link.active&&<Button variant="outline" disabled={busy} onClick={()=>void change({action:"disable",linkId:link.id},"Signing link disabled.")}>Disable signing link</Button>}
      </div>)}
      <ErrorNotice error={error}/>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </CardContent>
  </Card>;
}
