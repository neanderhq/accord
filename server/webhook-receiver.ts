import { verifyWebhook } from './automation';
import { transaction } from './db';
import { hash } from './crypto';
import { fail } from './errors';
import { z } from 'zod';
// Test receiver logic has durable deduplication. No public unauthenticated echo server.
export async function receiveWebhook(secret:string,headers:Record<string,string>,raw:string,now=Date.now()){
 if(Buffer.byteLength(raw)>65536)fail(413,'WEBHOOK_SIZE','Webhook exceeds 64 KB.');
 if(!verifyWebhook(secret,headers['x-esign-timestamp'],raw,headers['x-esign-signature'],now))fail(401,'WEBHOOK_SIGNATURE','Invalid signature or replay window.');
 const value=z.object({id:z.uuid(),type:z.string().max(60),envelopeId:z.uuid()}).parse(JSON.parse(raw));if(headers['x-esign-id']!==value.id)fail(400,'EVENT_ID','Event identifier mismatch.');
 return transaction(async c=>{const q=await c.query('INSERT INTO webhook_receipts(event_id,body_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',[value.id,hash(raw)]);if(!q.rowCount){const old=(await c.query('SELECT body_hash FROM webhook_receipts WHERE event_id=$1',[value.id])).rows[0];if(old.body_hash!==hash(raw))fail(409,'EVENT_CONFLICT','Event identifier was reused with different content.');return {accepted:true,duplicate:true};}return {accepted:true,duplicate:false};});
}
