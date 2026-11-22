// In-process scheduler: runs the durable job queue (email delivery, reminders,
// expiry, retention, webhooks) every minute in production. runJobs() holds a
// Postgres advisory lock, so this is safe alongside the optional external
// POST /api/jobs/tick trigger and multiple app instances.
export async function register() {
 if(process.env.NEXT_RUNTIME!=='nodejs'||process.env.NEXT_PHASE==='phase-production-build')return;
 if(process.env.NODE_ENV!=='production'||!process.env.DATABASE_URL||process.env.IN_PROCESS_SCHEDULER==='0')return;
 const state=globalThis as typeof globalThis & {esignScheduler?:ReturnType<typeof setInterval>};
 if(state.esignScheduler)return;
 const {runJobs}=await import('./server/automation');
 let running=false;
 const tick=async()=>{if(running)return;running=true;try{await runJobs();}catch{console.error('esign_scheduler_tick_failed');}finally{running=false;}};
 state.esignScheduler=setInterval(tick,60_000);
 setTimeout(tick,15_000);
}
