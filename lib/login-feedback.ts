export const ORIGIN_MESSAGE="This page’s address doesn’t match the configured app address. Reload from the configured URL.";
const originCode=(code:string|null)=>code==="INVALID_ORIGIN"||code==="ORIGIN_REJECTED";
export function signInMessage(code:string|null){
 if(code==="INVALID_EMAIL_OR_PASSWORD")return "Email or password is incorrect. Check both and try again, or use Forgot password.";
 if(code==="TOO_MANY_REQUESTS")return "Too many attempts. Please wait and try again.";
 if(originCode(code))return ORIGIN_MESSAGE;
 if(code==="REQUEST_TIMEOUT")return "The request took too long. Check your connection and try again.";
 return "Sign-in is temporarily unavailable. Please try again later or contact your administrator.";
}
export function recoveryMessage(code:string|null){
 if(originCode(code))return ORIGIN_MESSAGE;
 if(code==="REQUEST_TIMEOUT")return "The reset request took too long. It may still be processed; wait before trying again.";
 if(code==="TOO_MANY_REQUESTS")return "Too many attempts. Please wait and try again.";
 return "We couldn't process your reset request. Please try again later or contact your administrator.";
}
// Invite acceptance and password reset: server messages are user-safe, so show them; otherwise give an actionable fallback.
export function accountMessage(error:unknown){
 const code=(error as {code?:unknown})?.code;
 if(typeof code==="string"&&originCode(code))return ORIGIN_MESSAGE;
 if(code==="REQUEST_TIMEOUT")return "The request took too long. Check your connection and try again.";
 if(code==="TOO_MANY_REQUESTS")return "Too many attempts. Please wait and try again.";
 if(typeof code==="string"&&error instanceof Error&&error.message)return error.message;
 return "We couldn't reach the server. Check your connection and try again.";
}
export class RequestTimeout extends Error { readonly code="REQUEST_TIMEOUT"; }
export async function withLoginTimeout<T>(request:(signal:AbortSignal)=>Promise<T>,milliseconds=8000):Promise<T>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([request(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new RequestTimeout());controller.abort();},milliseconds);})]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
