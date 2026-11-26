"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AccordBrand } from "./accord-brand";
import { api, ApiError, Choice, ErrorNotice } from "./app-kit";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { PdfPage } from "./pdf-page";
import { Downloads } from "./downloads";
import { CONSENT_TEXT, SigningFieldError, validateValues, type Field } from "@/lib/model";
import { DRAW_PREFIX } from "@/lib/drawing";
import { parseDrawing } from "@/lib/drawing";
import type { DocumentView, OutputView } from "@/lib/ui-types";
type Branding={name:string;color:string;logo:string|null};
type SigningView={branding:Branding;id:string;title:string;state:string;expiresAt:string;recipient:{id:string;name:string;email:string;consented:boolean};fields:Field[];documents:DocumentView[]};
function SigningHeader({branding}:{branding?:Branding}){return <header className="signing-header" style={branding?{borderTop:`4px solid ${branding.color ?? "var(--brand-accent)"}`}:undefined}><Link href="/" className="brand-link">{branding?.logo?<span className="brand"><img src={branding.logo} alt="" width="32" height="32"/><span>{branding.name}</span></span>:<AccordBrand name={branding?.name??"Accord"}/>}</Link><span className="text-sm text-muted-foreground">Review and sign on any device</span></header>;}
function DrawingPad({fieldId,disabled,value,onChange}:{fieldId:string;disabled:boolean;value:string|undefined;onChange:(value:string)=>void}) {
 const canvasRef=useRef<HTMLCanvasElement|null>(null),drawing=useRef(false),points=useRef<[number,number][][]>([]);
 function render(){const canvas=canvasRef.current;if(!canvas)return;const context=canvas.getContext("2d");if(!context)return;context.clearRect(0,0,canvas.width,canvas.height);context.strokeStyle=getComputedStyle(canvas).color||"#0f172a";context.lineWidth=3;context.lineCap="round";context.lineJoin="round";for(const stroke of points.current){if(stroke.length<2)continue;context.beginPath();stroke.forEach(([x,y],index)=>{const px=x*canvas.width,py=(1-y)*canvas.height;if(index)context.lineTo(px,py);else context.moveTo(px,py);});context.stroke();}}
 function position(event:PointerEvent){const canvas=canvasRef.current!;const rect=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(1-(event.clientY-rect.top)/rect.height)))] as [number,number];}
 function start(event:React.PointerEvent<HTMLCanvasElement>) {if(disabled)return;drawing.current=true;points.current=[...points.current,[position(event.nativeEvent)]];render();}
 function move(event:React.PointerEvent<HTMLCanvasElement>) {if(!drawing.current)return;const last=points.current.at(-1)!;const next=position(event.nativeEvent);if(Math.hypot(next[0]-last.at(-1)![0],next[1]-last.at(-1)![1])<.005)return;points.current=[...points.current.slice(0,-1),[...last,next]];render();if(points.current.at(-1)!.length>=2)onChange(DRAW_PREFIX+JSON.stringify(points.current));}
 function end(){drawing.current=false;if(points.current.at(-1)?.length===1){points.current=points.current.slice(0,-1);render();}}
 return <div className="drawing-pad"><canvas ref={canvasRef} width={640} height={180} aria-label="Draw your signature with touch, pen or mouse" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}/><div className="drawing-actions"><span>Draw with your finger, stylus or mouse. Lift between strokes.</span><Button type="button" variant="ghost" size="sm" disabled={disabled||!value} onClick={()=>{points.current=[];render();onChange("");}}>Clear drawing</Button></div></div>;}
export function Signing({token}:{token:string}) {
 const [view,setView]=useState<SigningView|null>(null),[error,setError]=useState<Error|null>(null),[code,setCode]=useState(""),[activeCode,setActiveCode]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[accepted,setAccepted]=useState(false),[values,setValues]=useState<Record<string,string|boolean>>({}),[docId,setDocId]=useState(""),[page,setPage]=useState(0),[selected,setSelected]=useState(""),[done,setDone]=useState(""),[confirm,setConfirm]=useState(false),[declining,setDeclining]=useState(false),[reason,setReason]=useState("");
 const [fieldError, setFieldError] = useState<SigningFieldError | null>(null);
 const key=useRef<string|null>(null),base=`/api/sign/${token}`;
 async function load(value: string, signal?: AbortSignal) {
   setBusy(true);
   setError(null);
   try {
     const next = await api<SigningView>(base, { signal, headers: value ? { "x-access-code": value } : {} });
     if (signal?.aborted) return;
     setView(next);
     setActiveCode(value);
   } catch (error) {
     if (!signal?.aborted) setError(error as Error);
   } finally {
     if (!signal?.aborted) {
       setBusy(false);
       setLoading(false);
     }
   }
 }
 useEffect(() => {
   const controller = new AbortController();
   setAccepted(false);
   void load("", controller.signal);
   return () => controller.abort();
 }, [token]); // Tokens are route-local, never stored in localStorage.
 async function post(action:string,body:unknown){return api<{state:string;consented?:boolean}>(`${base}/${action}`,{method:"POST",headers:activeCode?{"x-access-code":activeCode}:{},body:JSON.stringify(body)});}
 async function run(fn:()=>Promise<void>){setBusy(true);setError(null);try{await fn();}catch(e){setError(e as Error);}finally{setBusy(false);}}
 const doc=view?.documents.find(d=>d.id===docId)??view?.documents[0],consented=!!view?.recipient.consented;
 function selectField(field: Field) {
   setSelected(field.id);
   setDocId(field.documentId);
   setPage(field.page);
 }
 function updateValue(fieldId: string, value: string | boolean) {
   setValues(previous => ({ ...previous, [fieldId]: value }));
   setFieldError(previous => previous?.fieldId === fieldId ? null : previous);
 }
 function review() {
   if (!view) return;
   try {
     validateValues(view.fields, values);
     setFieldError(null);
     setError(null);
     setConfirm(true);
   } catch (error) {
     if (error instanceof SigningFieldError) {
       setFieldError(error);
       setError(null);
       document.getElementById(`value-${error.fieldId}`)?.focus();
     } else {
       setError(error as Error);
     }
   }
 }
 return <div className="signing-layout"><SigningHeader branding={view?.branding}/><main className="signing-content">{loading?<p role="status">Checking your private signing link…</p>:done?<Card className="max-w-xl mx-auto"><CardHeader><ShieldCheck className="text-primary" size={32}/><CardTitle>{done==="declined"?"Envelope declined":"Your signature is recorded"}</CardTitle></CardHeader><CardContent><p>{done==="completed"?"All recipients have signed. The signed PDFs and completion receipt have been saved. Ask your sender for the separate read-only download link.":done==="declined"?"Signing is closed for this envelope. Your reason has been recorded.":"Your assigned fields have been saved. The remaining recipient can now continue. Completed files become available after everyone has signed."}</p><p className="mt-4 text-muted-foreground">You may close this page.</p></CardContent></Card>:<><ErrorNotice error={error}/>{!view&&error instanceof ApiError&&(error.code==="SIGNING_CLOSED"||error.status===404||error.status===410)?<Card className="max-w-lg mx-auto mt-6"><CardHeader><CardTitle>This signing link is no longer active</CardTitle></CardHeader><CardContent><p>The envelope was completed, declined, voided or has expired, or a newer link replaced this one. Contact the sender if you still need to sign.</p></CardContent></Card>:!view?<Card className="max-w-lg mx-auto mt-6"><CardHeader><CardTitle>{error instanceof ApiError&&error.code.startsWith("CODE_")?"Recipient access code":"Open your signing request"}</CardTitle></CardHeader><CardContent><form className="form-stack" onSubmit={v=>{v.preventDefault();void load(code);}}><p>Use the code provided separately by your sender, if required. Signing is available only while your link is active and your turn has arrived.</p><Label htmlFor="access-code">Access code</Label><Input id="access-code" type="password" maxLength={64} autoComplete="off" value={code} onChange={v=>setCode(v.target.value)}/><Button disabled={busy}>{busy?"Checking…":"Check access / retry"}</Button></form></CardContent></Card>:<>
 <div className="page-heading"><div><p className="eyebrow">REVIEW & SIGN</p><h1>{view.title}</h1><p>For {view.recipient.name} · {view.recipient.email}</p><p className="text-sm">{view.documents.length} documents · Expires {new Date(view.expiresAt).toLocaleString()}</p></div></div>
 <div className="signing-grid"><section><div className="preview-toolbar"><Choice label="Review document" value={doc?.id??""} onChange={v=>{setDocId(v);setPage(0);}} options={view.documents.map(d=>({value:d.id,label:d.name}))}/>{doc&&<Choice label="Review page" value={String(page)} onChange={v=>setPage(Number(v))} options={doc.geometry.map((_,i)=>({value:String(i),label:`Page ${i+1}`}))}/>}</div>{doc&&<PdfPage url={`${base}/document?file=${doc.id}`} code={activeCode} page={page} fields={view.fields.filter(f=>f.documentId===doc.id)} selected={selected} onSelect={id=>{setSelected(id);document.getElementById(`value-${id}`)?.focus();}}/>}</section>
 <aside className="form-stack"><Card><CardHeader><CardTitle>Electronic consent</CardTitle></CardHeader><CardContent className="form-stack"><p>{CONSENT_TEXT}</p>{consented?<p className="text-success">Consent recorded. You can complete your fields.</p>:<><div className="flex items-start gap-3"><Checkbox id="electronic-consent" checked={accepted} disabled={busy} onCheckedChange={v=>setAccepted(v===true)}/><Label htmlFor="electronic-consent">I agree to the electronic consent above.</Label></div><Button disabled={!accepted||busy} onClick={()=>run(async()=>{await post("consent",{accepted:true});setView({...view,recipient:{...view.recipient,consented:true}});})}>Confirm consent</Button></>}</CardContent></Card>
 <Card>
   <CardHeader><CardTitle>Your assigned fields</CardTitle></CardHeader>
   <CardContent className="form-stack">
     <p className="text-sm text-muted-foreground">Type or draw signatures and initials · Western European characters in typed values · * required. Only your assigned fields are editable.</p>
     <fieldset disabled={!consented||busy} className="form-stack">
       {view.fields.map(field => {
         const id = `value-${field.id}`;
         const error = fieldError?.fieldId === field.id ? fieldError.message : null;
         const value = values[field.id];
         const drawing = typeof value === "string" && value.startsWith(DRAW_PREFIX) ? value : undefined;
         const attributes = { id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined, onFocus: () => selectField(field) };
         return <div key={field.id} className={selected === field.id ? "sign-field active" : "sign-field"}>
           <Label htmlFor={id}>{field.type}{field.required ? " *" : ""} · {view.documents.find(document => document.id === field.documentId)?.name} · page {field.page + 1}</Label>
           {field.type === "checkbox" ?
             <Label className="flex items-center gap-2"><Checkbox {...attributes} checked={value === true} onCheckedChange={checked => updateValue(field.id, checked === true)}/>Check to confirm</Label> :
             <Input {...attributes} type={field.type === "date" ? "date" : "text"} className={field.type === "signature" ? "typed-signature" : ""} maxLength={500} value={typeof value === "string" && !drawing ? value : ""} placeholder={field.type === "signature" ? "Type your full name, or draw below" : field.type === "initials" ? "Type your initials, or draw below" : ""} onChange={event => updateValue(field.id, event.target.value)}/>}
           {error && <p id={`${id}-error`} className="text-sm text-destructive" role="alert">{error}</p>}
           {(field.type === "signature" || field.type === "initials") &&
             <DrawingPad fieldId={field.id} disabled={!consented || busy} value={drawing} onChange={value => updateValue(field.id, value)}/>}
         </div>;
       })}
     </fieldset>
     <Button size="lg" disabled={!consented || busy} onClick={review}>Review & submit signature</Button>
     <Button variant="ghost" disabled={busy} onClick={()=>setDeclining(true)}>Decline to sign</Button>
   </CardContent>
 </Card></aside></div>
 <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Submit your signature?</DialogTitle><DialogDescription>Your {view.fields.length} assigned fields will be saved together. You cannot edit your signature after submission.</DialogDescription></DialogHeader><ErrorNotice error={error}/><DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Review again</Button><Button disabled={busy} onClick={()=>run(async()=>{key.current??=crypto.randomUUID();const r=await post("submit",{idempotencyKey:key.current,values});setDone(r.state);setConfirm(false);})}>{busy?"Recording signature…":"Confirm & sign"}</Button></DialogFooter></DialogContent></Dialog>
 <Dialog open={declining} onOpenChange={setDeclining}><DialogContent><DialogHeader><DialogTitle>Decline this envelope?</DialogTitle><DialogDescription>This closes signing for everyone in the envelope. Your reason is retained in the activity record.</DialogDescription></DialogHeader><Label htmlFor="decline-reason">Reason</Label><Textarea id="decline-reason" maxLength={500} value={reason} onChange={v=>setReason(v.target.value)}/><ErrorNotice error={error}/><DialogFooter><Button variant="outline" onClick={()=>setDeclining(false)}>Keep reviewing</Button><Button variant="destructive" disabled={busy||reason.trim().length<3} onClick={()=>run(async()=>{await post("decline",{reason});setDone("declined");setDeclining(false);})}>Confirm decline</Button></DialogFooter></DialogContent></Dialog>
 </>}</>}</main></div>;
}
export function Completion({token}:{token:string}) {
 const [value,setValue]=useState<{title:string;outputs:OutputView[];pdfsOnly?:boolean}|null>(null),[error,setError]=useState<Error|null>(null);
 useEffect(()=>{api<{title:string;outputs:OutputView[];pdfsOnly?:boolean}>(`/api/complete/${token}`).then(setValue).catch(setError);},[token]);
 return <div className="signing-layout"><SigningHeader/><main className="signing-content max-w-3xl"><p className="eyebrow">COMPLETION RECORD</p><h1>{value?.title??"Completed documents"}</h1><p className="my-4">{value?.pdfsOnly?"Read-only access to the signed PDFs.":"Read-only access to the flattened PDFs and evidence receipt."} Every download is checked against its SHA-256 digest.</p><ErrorNotice error={error}/>{value?<Downloads outputs={value.outputs} url={o=>`/api/complete/${token}?file=${o.id}`}/>:!error&&<p role="status">Checking your download link…</p>}</main></div>;
}
