import { randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
export const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function verifier(code: string) { const salt = randomBytes(16).toString("hex"); return salt + ":" + scryptSync(code, salt, 32).toString("hex"); }
export function verifyCode(code: string, value: string) { const [salt, h] = value.split(":"); if (!/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(value) || code.length > 64) return false; return timingSafeEqual(scryptSync(code, salt, 32), Buffer.from(h, "hex")); }
