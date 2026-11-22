import { setupCompany } from "@/server/company-setup";
import { body, handled, json, metadata, sameOrigin } from "@/server/http";
import { AppError } from "@/server/errors";

export async function POST(request:Request) {return handled(async()=>{try{sameOrigin(request);return json(await setupCompany(await body(request),metadata(request)));}catch(error){console.warn("Company setup attempt rejected",{reason:error instanceof AppError?error.code:"VALIDATION_OR_FAILURE",...metadata(request)});throw error;}});}
