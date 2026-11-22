import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDb } from "./db";
import * as schema from "./schema";
import { AppError } from "./errors";
import { trustedOrigins } from "./origins";
export function authOptions() {
  const baseURL=process.env.BETTER_AUTH_URL || (process.env.NODE_ENV!=="production" ? "http://localhost:3000" : undefined);
  if(!baseURL || !process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length<32) throw new AppError(503,"AUTH_SETUP_REQUIRED","Authentication setup required: configure BETTER_AUTH_URL and a private BETTER_AUTH_SECRET of at least 32 characters.");
  return { baseURL, trustedOrigins:trustedOrigins(baseURL), secret:process.env.BETTER_AUTH_SECRET,
    database:drizzleAdapter(getDb(),{provider:"pg",schema}),
    emailAndPassword:{ enabled:true, disableSignUp:true, minPasswordLength:12 },
    session:{expiresIn:60*60*8,updateAge:60*30,cookieCache:{enabled:false}},
    rateLimit:{enabled:true,storage:"database" as const,window:60,max:30},
    account:{accountLinking:{enabled:false}},
    advanced:{useSecureCookies:baseURL.startsWith("https://"),ipAddress:{ipAddressHeaders:process.env.TRUST_PROXY_IP==="1"?["x-forwarded-for"]:[]}},
  };
}
const createAuth = () => betterAuth(authOptions());
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {return auth ??= createAuth();}
