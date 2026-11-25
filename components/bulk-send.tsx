"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ErrorNotice } from "./app-kit";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

type Template = { id: string; name: string; roles: unknown[] };
type Preview = { fingerprint: string | null; rows: { row: number; name?: string; email?: string; error?: string }[] };
type Batch = {
  id: string;
  created_at: string;
  template_name: string;
  entries: { row_number: number; envelope_id: string; name: string; email: string; state: string; delivery: string }[];
};

const keyName = "accord.bulk.confirmation";
export const deliveryLabel: Record<string,string> = {
  pending: "Queued", processing: "Sending", provider_accepted: "Accepted by provider",
  not_configured: "Provider not configured", disabled: "Dispatch disabled", qa_blocked: "Synthetic address",
  retry: "Retry scheduled", waiting: "Waiting for earlier signer", uncertain: "Delivery uncertain",
  failed: "Delivery failed", cancelled: "Delivery cancelled",
};
export function deliveryText(status: string) { return deliveryLabel[status] ?? status; }

function confirmationKey(fingerprint: string) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(keyName) ?? "null");
    if (stored?.fingerprint === fingerprint && typeof stored.key === "string") return stored.key;
    const key = crypto.randomUUID();
    sessionStorage.setItem(keyName,JSON.stringify({fingerprint,key}));
    return key;
  } catch { return crypto.randomUUID(); }
}

export function BulkSend({templates}: {templates: Template[]}) {
  const [templateId,setTemplate] = useState("");
  const [csv,setCsv] = useState("");
  const [preview,setPreview] = useState<Preview|null>(null);
  const [batches,setBatches] = useState<Batch[]>([]);
  const [working,setWorking] = useState(false);
  const [notice,setNotice] = useState("");
  const [error,setError] = useState<Error|null>(null);
  const [fileKey,setFileKey] = useState(0);
  const [requestKey,setRequestKey] = useState("");
  const allowed = templates.filter(template=>template.roles.length===1);

  async function refresh() { setBatches(await api<Batch[]>("/api/manage/bulk-send")); }
  useEffect(()=>{ void refresh().catch(setError); },[]);

  async function run(action:()=>Promise<void>) {
    setWorking(true); setNotice(""); setError(null);
    try { await action(); }
    catch (e) { setError(e as Error); }
    finally { setWorking(false); }
  }
  function edit(text: string) { setCsv(text); setPreview(null); setNotice(""); setRequestKey(""); }
  function reset() {
    try { sessionStorage.removeItem(keyName); } catch { /* Browser storage may be disabled. */ }
    edit(""); setFileKey(key=>key+1); setError(null);
  }
  async function requestPreview() {
    const result = await api<Preview>("/api/manage/bulk-preview",{method:"POST",body:JSON.stringify({templateId,csv})});
    setPreview(result);
    if (result.fingerprint) setRequestKey(confirmationKey(result.fingerprint));
  }
  async function confirm() {
    if (!preview?.fingerprint || !requestKey) return;
    const batch = await api<Batch>("/api/manage/bulk-send",{method:"POST",body:JSON.stringify({
      templateId,csv,fingerprint:preview.fingerprint,requestKey,
    })});
    setBatches(current=>[batch,...current.filter(row=>row.id!==batch.id)]);
    setNotice(`Batch saved. ${batch.entries.length} private envelopes are in delivery history.`);
    setPreview(null);
  }
  return <Card className="min-w-0">
    <CardHeader><CardTitle>Bulk send from a template</CardTitle></CardHeader>
    <CardContent className="form-stack min-w-0">
      <p className="text-sm text-muted-foreground">Preview up to 25 recipients. Each receives a separate signing envelope.</p>
      {allowed.length ? <form className="form-stack" onSubmit={event=>{event.preventDefault();void run(requestPreview);}}>
        <div className="form-stack">
          <Label htmlFor="bulk-template">Single-signer template</Label>
          <select id="bulk-template" required value={templateId} disabled={working} className="w-full rounded-md border bg-background p-2"
            onChange={e=>{setTemplate(e.target.value);setPreview(null);setRequestKey("");setNotice("");}}>
            <option value="">Choose a template</option>
            {allowed.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </div>
        <Label htmlFor="bulk-csv-file">Upload roster CSV</Label>
        <Input key={fileKey} id="bulk-csv-file" type="file" accept=".csv,text/csv" disabled={working} onChange={event=>{
          const file = event.target.files?.[0];
          if (file) void run(async()=>{
            if(file.size>64*1024) throw new Error("Use a CSV no larger than 64 KiB.");
            edit(await file.text());
          });
        }}/>
        <Label htmlFor="bulk-roster">Roster CSV</Label>
        <Textarea id="bulk-roster" required maxLength={64*1024} rows={4} value={csv} disabled={working}
          placeholder={"name,email\nAvery Morgan,avery@client.test"} onChange={e=>edit(e.target.value)}/>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={working}>Preview roster</Button>
          <Button type="button" variant="outline" disabled={working} onClick={reset}>Start another batch</Button>
        </div>
      </form> : <p>Save a template with one signer and a required signature field to get started.</p>}
      <ErrorNotice error={error}/>
      {preview&&<section className="form-stack" aria-label="Roster preview">
        <p role="status">{preview.rows.length} rows reviewed. {preview.fingerprint?"Ready to confirm.":"Correct the highlighted rows and preview again."}</p>
        <ul className="divide-y rounded-md border px-3">
          {preview.rows.map(row=><li key={row.row} className="break-words py-2 text-sm">
            <strong>Row {row.row}</strong>{" "}
            {row.error?<span className="text-destructive">{row.error}</span>:<>{row.name} · {row.email}</>}
          </li>)}
        </ul>
        <Button type="button" onClick={()=>void run(confirm)} disabled={working||!preview.fingerprint}>Confirm bulk send</Button>
      </section>}
      {notice&&<p role="status">{notice}</p>}
      <section className="form-stack" aria-label="Bulk send history">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Batch history</h3>
          <Button type="button" variant="outline" size="sm" disabled={working} onClick={()=>void run(refresh)}>Refresh batches</Button>
        </div>
        {batches.length===0&&<p className="text-sm text-muted-foreground">No batches yet.</p>}
        {batches.map(batch=><details key={batch.id} className="min-w-0 rounded-md border p-3" open={batch.id===batches[0].id}>
          <summary className="cursor-pointer break-words font-medium">{batch.template_name} · {batch.entries.length} envelopes · {new Date(batch.created_at).toLocaleDateString()}</summary>
          <ul className="mt-2 divide-y">
            {batch.entries.map(entry=><li key={entry.envelope_id} className="break-words py-2 text-sm">
              <Link className="text-primary underline" href={`/envelopes/${entry.envelope_id}`}>{entry.name}</Link>
              <span className="block">{entry.email} · {entry.state} · {deliveryText(entry.delivery)}</span>
            </li>)}
          </ul>
        </details>)}
      </section>
    </CardContent>
  </Card>;
}
