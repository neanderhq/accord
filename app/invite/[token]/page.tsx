"use client";
import { use, useState } from "react";
import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { api, ErrorNotice } from "@/components/app-kit";
import { accountMessage, withLoginTimeout } from "@/lib/login-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
export default function Page({params}:{params:Promise<{token:string}>}) {
 const {token}=use(params);
 const [name,setName]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 return <AuthFrame><Card><CardHeader><p className="eyebrow">INVITATION</p><h1 data-slot="card-title">Set up your account</h1><CardDescription>Create your password to activate your workspace access.</CardDescription></CardHeader><CardContent>{done?<div className="form-stack"><p role="status">Your account is ready.</p><Button asChild size="lg"><Link href="/login">Sign in now</Link></Button></div>:<form className="form-stack" onSubmit={async event=>{event.preventDefault();setBusy(true);setError(null);try{await withLoginTimeout(signal=>api(`/api/account/invite`,{method:"POST",signal,body:JSON.stringify({token,name:name||undefined,password})}));setDone(true);}catch(e){setError(accountMessage(e));}finally{setBusy(false);}}}><div className="auth-field"><Label htmlFor="name">Your name (optional)</Label><Input id="name" maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></div><div className="auth-field"><Label htmlFor="password">Password</Label><Input id="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="password-hint" required value={password} onChange={e=>setPassword(e.target.value)}/><p id="password-hint" className="text-xs text-muted-foreground">Use 12–128 characters.</p></div><ErrorNotice error={error}/><Button size="lg" disabled={busy}>{busy?"Activating…":"Activate account"}</Button></form>}</CardContent></Card></AuthFrame>;
}
