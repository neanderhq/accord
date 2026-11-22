"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { PenLine } from "lucide-react";
import { api, ApiError, ErrorNotice } from "@/components/app-kit";
import { recoveryMessage, RequestTimeout, signInMessage, withLoginTimeout } from "@/lib/login-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardDescription, CardContent } from "@/components/ui/card";

export default function Page(){
 const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const [recovery,setRecovery]=useState<{accepted:boolean;path?:string}|null>(null),[recoveryError,setRecoveryError]=useState<string|null>(null),[recoveryBusy,setRecoveryBusy]=useState(false);
 const emailRef=useRef<HTMLInputElement>(null);
 const [showSetup,setShowSetup]=useState(false),[company,setCompany]=useState(""),[setupName,setSetupName]=useState(""),[setupEmail,setSetupEmail]=useState(""),[setupPassword,setSetupPassword]=useState(""),[setupKey,setSetupKey]=useState(""),[setupError,setSetupError]=useState<string|null>(null),[setupBusy,setSetupBusy]=useState(false),[setupDone,setSetupDone]=useState(false);
 async function recover(){
  setRecovery(null);setRecoveryError(null);
  if(!email.trim()){setRecoveryError("Enter your email address to request a password reset.");emailRef.current?.focus();return;}
  if(!emailRef.current?.validity.valid){setRecoveryError("Enter a valid email address to request a password reset.");emailRef.current?.focus();return;}
  setRecoveryBusy(true);
  try{setRecovery(await withLoginTimeout(signal=>api("/api/account/recover",{method:"POST",signal,body:JSON.stringify({email:email.trim()})})));}
  catch(caught){setRecoveryError(recoveryMessage(caught instanceof ApiError||caught instanceof RequestTimeout?caught.code:null));}
  finally{setRecoveryBusy(false);}
 }
 return <main className="login-page"><Link className="brand" href="/"><span className="brand-icon"><PenLine/></span>Accord</Link><Card><CardHeader><p className="eyebrow">YOUR COMPANY WORKSPACE</p><h1 data-slot="card-title" className="font-sans text-sm leading-none font-semibold tracking-normal">Welcome back</h1><CardDescription>Sign in to your company workspace.</CardDescription></CardHeader><CardContent><form className="form-stack" onSubmit={async event=>{event.preventDefault();setBusy(true);setError(null);try{await withLoginTimeout(signal=>api("/api/auth/sign-in/email",{method:"POST",signal,body:JSON.stringify({email,password,rememberMe:false})}));location.href="/";}catch(caught){setError(signInMessage(caught instanceof ApiError||caught instanceof RequestTimeout?caught.code:null));}finally{setBusy(false);}}}>
 <Label htmlFor="email">Email address</Label><Input ref={emailRef} id="email" type="email" autoComplete="username" required value={email} onChange={event=>{setEmail(event.target.value);setRecovery(null);setRecoveryError(null);}}/>
 <Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/>
 <ErrorNotice error={error}/><Button size="lg" disabled={busy}>{busy?"Signing in…":"Sign in"}</Button>
 <div aria-live="polite"><ErrorNotice error={recoveryError}/>{recovery&&<p role="status" className="text-sm">If the address belongs to a workspace account, reset instructions will be queued. Delivery depends on email configuration.{recovery.path&&<> Development reset link: <Link className="text-primary break-all" href={recovery.path}>{recovery.path}</Link></>}</p>}</div>
 <button type="button" className="text-sm text-primary" disabled={recoveryBusy} onClick={recover}>{recoveryBusy?"Sending…":"Forgot password?"}</button><Link className="text-sm text-primary" href="/settings">Connection and account setup →</Link>
 </form><div className="mt-6"><Button type="button" variant="outline" onClick={()=>setShowSetup(!showSetup)}>{showSetup?"Close company setup":"Set up a new company"}</Button>{showSetup&&(setupDone?<p role="status" className="mt-4 text-sm">Your company is ready. Sign in above with your new account. Invite other staff from your workspace.</p>:<form className="form-stack mt-4" onSubmit={async event=>{event.preventDefault();setSetupError(null);if(setupKey.length<32||setupKey.length>1024){setSetupError("The setup key must be 32–1024 characters and match the key configured by your deployment administrator.");return;}setSetupBusy(true);try{await api("/api/company-setup",{method:"POST",body:JSON.stringify({company,name:setupName,email:setupEmail,password:setupPassword,key:setupKey})});setSetupDone(true);setSetupKey("");setSetupPassword("");setEmail(setupEmail);}catch(caught){setSetupError(caught instanceof ApiError?caught.message:"Setup could not be completed. Check your connection and try again.");}finally{setSetupBusy(false);}}}>
 <p className="text-sm text-muted-foreground">For the first company only. Other staff join by invitation.</p><Label htmlFor="company">Company name</Label><Input id="company" required maxLength={100} value={company} onChange={event=>setCompany(event.target.value)}/><Label htmlFor="setup-name">Your name</Label><Input id="setup-name" required maxLength={100} value={setupName} onChange={event=>setSetupName(event.target.value)}/><Label htmlFor="setup-email">Your email</Label><Input id="setup-email" type="email" required maxLength={254} value={setupEmail} onChange={event=>setSetupEmail(event.target.value)}/><Label htmlFor="setup-password">Password (12–128 characters)</Label><Input id="setup-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={setupPassword} onChange={event=>setSetupPassword(event.target.value)}/><Label htmlFor="setup-key">Setup key (32–1024 characters)</Label><Input id="setup-key" type="password" autoComplete="off" required maxLength={1024} value={setupKey} onChange={event=>setSetupKey(event.target.value)}/><ErrorNotice error={setupError}/><Button disabled={setupBusy}>{setupBusy?"Creating company…":"Create company and admin"}</Button></form>)}</div></CardContent></Card></main>;
}
