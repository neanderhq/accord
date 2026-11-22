"use client";
import { useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { ErrorNotice } from "./app-kit";
import type { OutputView } from "@/lib/ui-types";
export function Downloads({outputs,url}:{outputs:OutputView[];url:(o:OutputView)=>string}) {
  const [error,setError]=useState<Error|null>(null),[busy,setBusy]=useState(""),[verified,setVerified]=useState("");
  return <div className="form-stack">{outputs.map(o=><div className="download-row" key={o.id}><strong>{o.name}</strong><code>SHA-256: {o.sha256}</code><small>{o.size.toLocaleString()} bytes</small><Button variant="outline" disabled={!!busy} onClick={async()=>{setBusy(o.id);setError(null);try{const r=await fetch(url(o));if(!r.ok){const v=await r.json();throw new Error(v.error??"Download unavailable");}const bytes=await r.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(v=>v.toString(16).padStart(2,"0")).join("");if(sha!==o.sha256||bytes.byteLength!==o.size)throw new Error("File integrity mismatch. Download stopped.");const objectUrl=URL.createObjectURL(new Blob([bytes],{type:o.kind==="receipt"?"application/json":"application/pdf"}));const a=document.createElement("a");a.href=objectUrl;a.download=o.name;a.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);setVerified(o.id);}catch(e){setError(e as Error);}finally{setBusy("");}}}><Download/>{busy===o.id?"Checking file…":"Verify bytes & download"}</Button>{verified===o.id&&<p className="text-success flex gap-2 items-center"><ShieldCheck size={16}/>Downloaded bytes match this SHA-256 digest.</p>}</div>)}<ErrorNotice error={error}/></div>;
}
