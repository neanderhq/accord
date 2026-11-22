import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { AppError } from "./errors";
let pool: Pool | undefined;
export function getPool() {
  if (!process.env.DATABASE_URL) throw new AppError(503,"DATABASE_SETUP_REQUIRED","Database setup required: attach an isolated development DATABASE_URL. No data has been saved.");
  return pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
}
export const getDb = () => drizzle(getPool(), { schema });
export async function transaction<T>(fn: (c: PoolClient)=>Promise<T>) {
  const c=await getPool().connect(); try { await c.query("BEGIN"); const result=await fn(c); await c.query("COMMIT"); return result; } catch(e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
