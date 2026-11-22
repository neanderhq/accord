// Schema generation only: no database connections, credentials, or runtime fallback.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "pg" }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  session: { expiresIn: 60*60*8, updateAge: 60*30 },
  rateLimit: { enabled: true, storage: "database" },
});
