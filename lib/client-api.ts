export class ApiError extends Error {constructor(message:string,public code:string,public status:number){super(message);}}

export const workspaceAccessEvent="accord:workspace-access";
export function reportWorkspaceAccess(path:string,error:ApiError){
 if(typeof window!=="undefined"&&[401,403].includes(error.status)&&/^\/api\/(workspace|envelopes|team|manage)(\/|\?|$)/.test(path))window.dispatchEvent(new CustomEvent(workspaceAccessEvent,{detail:error}));
}
export async function api<T>(path:string,init:RequestInit={}):Promise<T> {
 const r=await fetch(path,{...init,headers:{...(init.body&&!(init.body instanceof File)?{"Content-Type":"application/json"}:{}),...init.headers}}),unreadable=Symbol(),value=await r.json().catch(()=>unreadable);
 if(!r.ok){const error=new ApiError(value?.error??value?.message??`Request failed (HTTP ${r.status}). Reload and try again.`,value?.code??"REQUEST_FAILED",r.status);reportWorkspaceAccess(path,error);throw error;}
 if(value===unreadable)throw new ApiError("The server returned an unreadable response. Reload and try again.","BAD_RESPONSE",r.status);
 return value;
}
