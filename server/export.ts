import { z } from 'zod';
import { workspace,audit,type Principal } from './workflow';
import { transaction } from './db';
import { matchesFilters } from '../lib/filters';
import { csvRow } from '../lib/csv';
export async function statusExport(p:Principal,query:Record<string,string>){const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();const f=z.object({from:day,to:day,recipient:z.string().max(200).optional(),search:z.string().max(200).optional(),status:z.string().max(30).optional(),folder:z.string().max(60).optional(),tag:z.string().max(30).optional(),visibility:z.enum(['active','archived','deleted']).optional()}).parse(Object.fromEntries(Object.entries(query).filter(([,v])=>v!==''&&v!=='all')));const w=await workspace(p),rows=w.envelopes.filter(e=>matchesFilters(e,f));await transaction(c=>audit(c,{company_id:p.companyId},p,'status_csv_exported',{filters:f,count:rows.length}));return [['Title','Status','Owner','Created UTC','Documents'],...rows.map(e=>[e.title,e.state,e.owner_name,e.created_at.toISOString(),e.document_count])].map(csvRow).join('\r\n');}
