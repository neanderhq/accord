"use client";

import { useEffect, useState } from "react";
import { api, ErrorNotice } from "./app-kit";
import { deliveryText } from "./bulk-send";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Copy = { email:string; state:"awaiting_completion"|"active"|"revoked"|"expired"; expiresAt:string|null; delivery:string|null };
type Result = { version:number; copy:Copy|null };
const states = { awaiting_completion:"Waiting for all signers", active:"Link active", revoked:"Link revoked", expired:"Link expired" };

export function CompletionCopy({id,version,state,disabled,onSaved}:{
  id:string; version:number; state:string; disabled:boolean; onSaved:(result:Result)=>void;
}) {
  const [result,setResult]=useState<Result|null>(null);
  const [email,setEmail]=useState("");
  const [error,setError]=useState<Error|null>(null);
  const [working,setWorking]=useState(false);
  const [notice,setNotice]=useState("");
  const url=`/api/envelopes/${id}/completion-copy`;
  const copy=result?.copy;
  useEffect(()=>{
    let active=true;
    api<Result>(url).then(next=>{
      if(active){setResult(next);setEmail(next.copy?.email??"");}
    }).catch(err=>{if(active)setError(err);});
    return()=>{active=false;};
  },[url,state]);
  async function update(body:unknown,label:string) {
    setWorking(true);setError(null);setNotice("");
    try {
      const next=await api<Result>(url,{method:"POST",body:JSON.stringify(body)});
      setResult(next);setEmail(next.copy?.email??"");onSaved(next);setNotice(label);
    }catch(err){setError(err as Error);}finally{setWorking(false);}
  }
  return <Card><CardHeader><CardTitle>Completion copy recipient</CardTitle></CardHeader>
    <CardContent className="form-stack">
      <p className="text-sm text-muted-foreground">Send one person access to the signed PDFs after everyone signs. The link lasts 30 days.</p>
      {state==="draft"&&<form className="form-stack" onSubmit={event=>{event.preventDefault();void update({action:"save",email,version},"Copy recipient saved.");}}>
        <Label htmlFor="copy-email">Completion copy email</Label>
        <Input id="copy-email" type="email" required maxLength={200} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} disabled={disabled||working||!result}/>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled||working||!result||!email.trim()||email.trim()===copy?.email}>Save copy recipient</Button>
          {copy&&<Button type="button" variant="ghost" disabled={disabled||working} onClick={()=>void update({action:"save",email:null,version},"Copy recipient removed.")}>Remove copy recipient</Button>}
        </div>
      </form>}
      {copy&&<>
        <p className="break-all">{copy.email}</p>
        <p>{states[copy.state]}{copy.state==="active"&&copy.expiresAt&&` until ${new Date(copy.expiresAt).toLocaleString()}`}</p>
        {copy.delivery&&<p>Delivery · {deliveryText(copy.delivery)}</p>}
        {state==="completed"&&<div className="flex flex-wrap gap-2">
          {copy.state==="active"&&<Button variant="outline" disabled={disabled||working} onClick={()=>void update({action:"revoke"},"Copy link revoked.")}>Revoke copy link</Button>}
          {(copy.state==="revoked"||copy.state==="expired")&&<Button variant="outline" disabled={disabled||working} onClick={()=>void update({action:"renew"},"Replacement copy link authorized.")}>Renew copy link</Button>}
          <Button variant="ghost" disabled={disabled||working} onClick={async()=>{setError(null);setWorking(true);try{setResult(await api<Result>(url));}catch(err){setError(err as Error);}finally{setWorking(false);}}}>Refresh copy status</Button>
        </div>}
      </>}
      {!copy&&state!=="draft"&&<p>No completion copy recipient was configured.</p>}
      <ErrorNotice error={error}/>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </CardContent>
  </Card>;
}
