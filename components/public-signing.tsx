"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AuthFrame } from "./auth-frame";
import { api, ErrorNotice } from "./app-kit";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

function StartFrame({title,children}:{title:string;children:ReactNode}) {
  return <AuthFrame>
    <Card><CardHeader><h1 data-slot="card-title">{title}</h1></CardHeader>
      <CardContent className="form-stack">{children}</CardContent>
    </Card>
  </AuthFrame>;
}

const progress:Record<string,string>={
  pending:"Verification email queued. Check your inbox in a moment.",
  processing:"Verification email is being processed.",
  provider_accepted:"Accepted by the email provider. Check your inbox or spam folder.",
  failed:"Delivery failed. Correct your address or request another email.",
  retry:"Delivery hit a temporary problem. A retry is queued.",
  uncertain:"Delivery is uncertain. Check your inbox before requesting another email.",
  verification_only:"Verification queued in this test workspace. Email delivery is off.",
  qa_blocked:"Email delivery is off for this synthetic address.",
  not_configured:"Email delivery is currently unavailable. Try again later or contact the sender.",
  disabled:"Email delivery is currently unavailable. Try again later or contact the sender.",
  cancelled:"This verification was withdrawn. Request a fresh email from an active signing link.",
  used:"Email verified. Continue in the browser where you opened the verification link.",
};

export function PublicSigning({id}:{id:string}) {
  const [title,setTitle]=useState("");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [status,setStatus]=useState("");
  const [receipt,setReceipt]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<Error|null>(null);
  const url=`/api/public-signing/start/${id}`;
  useEffect(()=>{
    let active=true;
    api<{title:string}>(url).then(result=>{if(active)setTitle(result.title);}).catch(err=>{if(active)setError(err);});
    return()=>{active=false;};
  },[url]);
  async function request() {
    setBusy(true);setError(null);
    try{
      const next=await api<{status:string;receipt?:string}>(url,{method:"POST",body:JSON.stringify({name,email,retryReceipt:status==="failed"?receipt:undefined})});
      setStatus(next.status);if(next.receipt)setReceipt(next.receipt);
    }catch(err){setError(err as Error);}finally{setBusy(false);}
  }
  async function refresh() {
    setBusy(true);setError(null);
    try{setStatus((await api<{status:string}>(`/api/public-signing/status/${receipt}`)).status);}
    catch(err){setError(err as Error);}finally{setBusy(false);}
  }
  return <StartFrame title={title||"Start signing"}>
    {!title&&!error&&<p role="status">Opening signing link…</p>}
    {title&&<>
      <p className="text-muted-foreground">Enter your name and email. After you confirm your email, you’ll open your own copy for signing.</p>
      <form className="form-stack" onSubmit={event=>{event.preventDefault();void request();}}>
        <Label htmlFor="public-name">Full name</Label>
        <Input id="public-name" autoComplete="name" required maxLength={100} value={name} onChange={event=>setName(event.target.value)}/>
        <Label htmlFor="public-email">Email address</Label>
        <Input id="public-email" type="email" autoComplete="email" required maxLength={200} value={email} onChange={event=>setEmail(event.target.value)}/>
        <Button disabled={busy}>{status==="failed"?"Request another verification email":"Request verification email"}</Button>
      </form>
      {status&&<p role="status">{progress[status]}</p>}
      {receipt&&status!=="verification_only"&&<Button variant="outline" disabled={busy} onClick={()=>void refresh()}>Check delivery status</Button>}
    </>}
    <ErrorNotice error={error}/>
  </StartFrame>;
}

export function VerifySigning({token}:{token:string}) {
  const [error,setError]=useState<Error|null>(null);
  const [busy,setBusy]=useState(false);
  return <StartFrame title="Confirm your email">
    <p className="text-muted-foreground">Continue to create your private copy and open it for signing. This email link works once and expires after 15 minutes.</p>
    <Button disabled={busy} onClick={async()=>{
      setBusy(true);setError(null);
      try {
        const result=await api<{path:string}>(`/api/public-signing/verify/${token}`,{method:"POST"});
        location.replace(result.path);
      }catch(err){setError(err as Error);setBusy(false);}
    }}>{busy?"Opening document…":"Continue to signing"}</Button>
    <ErrorNotice error={error}/>
  </StartFrame>;
}
