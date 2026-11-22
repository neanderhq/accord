// Origins trusted for browser mutations. Production trusts only the exact configured origin.
// Outside production, a loopback BETTER_AUTH_URL also trusts its loopback aliases (same scheme and port),
// so a preview opened at 127.0.0.1 works when the configured address says localhost, and vice versa.
const loopback=["localhost","127.0.0.1","[::1]"];
export function trustedOrigins(baseURL:string,nodeEnv:string|undefined=process.env.NODE_ENV):string[] {
  const base=new URL(baseURL);
  if(nodeEnv==="production"||!loopback.includes(base.hostname)) return [base.origin];
  return [base.origin,...loopback.map(host=>`${base.protocol}//${host}${base.port?":"+base.port:""}`).filter(o=>o!==base.origin)];
}
export function originTrusted(origin:string|null,baseURL:string,nodeEnv:string|undefined=process.env.NODE_ENV) {
  return !!origin&&trustedOrigins(baseURL,nodeEnv).includes(origin);
}
