import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "./db";
import { fail } from "./errors";
import { queueCompletionCopy } from "./automation";
import { deliveryStatus, externalEmail } from "./template-send";
import { audit, envelope, type Principal } from "./workflow";

async function copyStatus(c: PoolClient, envelopeId: string) {
  const row = (await c.query<{
    email:string; generation:number; expires_at:Date|null; revoked_at:Date|null;
    expired:boolean|null; delivery:string|null;
  }>(
    `SELECT a.email,a.generation,a.expires_at,a.revoked_at,a.expires_at<=clock_timestamp() AS expired,j.status AS delivery
       FROM completion_copies a LEFT JOIN delivery_jobs j
         ON j.event_key='external-copy:'||a.envelope_id||':'||a.generation
       WHERE a.envelope_id=$1`, [envelopeId],
  )).rows[0];
  if (!row) return null;
  return {
    email:row.email, expiresAt:row.expires_at,
    state:row.revoked_at?"revoked":row.expired?"expired":row.generation?"active":"awaiting_completion",
    delivery:row.generation?deliveryStatus(row.delivery):null,
  };
}

export async function getCompletionCopy(p: Principal,id: string) {
  return transaction(async c=>{
    const e=await envelope(c,p,id,true);
    return {version:e.version,copy:await copyStatus(c,e.id)};
  });
}

const changeInput = z.discriminatedUnion("action",[
  z.object({action:z.literal("save"),email:externalEmail.nullable(),version:z.number().int().positive()}),
  z.object({action:z.enum(["revoke","renew"])}),
]);

export async function changeCompletionCopy(p: Principal,id: string,input: unknown) {
  const v=changeInput.parse(input);
  return transaction(async c=>{
    const e=await envelope(c,p,id,true);
    const deleted=(await c.query("SELECT 1 FROM envelope_lifecycle WHERE envelope_id=$1 AND deleted_at IS NOT NULL",[e.id])).rowCount;
    if(deleted)fail(409,"COPY_UNAVAILABLE","The envelope is deleted.");
    if(v.action==="save"){
      if(e.state!=="draft")fail(409,"FROZEN","The copy address is frozen when the envelope is sent.");
      if(e.version!==v.version)fail(409,"VERSION_CONFLICT","Reload the envelope before changing the copy address.");
      if(v.email)await c.query(
        "INSERT INTO completion_copies(envelope_id,email) VALUES($1,$2) ON CONFLICT (envelope_id) DO UPDATE SET email=excluded.email",
        [e.id,v.email],
      );
      else await c.query("DELETE FROM completion_copies WHERE envelope_id=$1",[e.id]);
      await c.query("UPDATE envelopes SET version=version+1 WHERE id=$1",[e.id]);
      e.version++;
      await audit(c,e,p,v.email?"completion_copy_configured":"completion_copy_removed");
    }else{
      const copy=await copyStatus(c,e.id);
      if(e.state!=="completed"||!copy)fail(409,"COPY_UNAVAILABLE","A completed envelope with a configured copy is required.");
      if(v.action==="revoke"){
        const revoked=await c.query("UPDATE completion_copies SET revoked_at=clock_timestamp() WHERE envelope_id=$1 AND revoked_at IS NULL",[e.id]);
        if(revoked.rowCount)await audit(c,e,p,"completion_copy_revoked");
      }else{
        if(copy.state!=="expired"&&copy.state!=="revoked")fail(409,"COPY_STILL_ACTIVE","Revoke the active link before issuing a replacement.");
        await queueCompletionCopy(c,e,false);
        await audit(c,e,p,"completion_copy_renewed");
      }
    }
    return {version:e.version,copy:await copyStatus(c,e.id)};
  });
}
