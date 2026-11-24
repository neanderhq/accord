import { z } from "zod";
import { isDrawing,parseDrawing } from "./drawing";
export const DOCX_NOTICE="DOCX is converted to A4 PDF pages. Kept: paragraphs, headings, bulleted and numbered lists, tables (borders, column widths, cells merged across columns), explicit page breaks and Western European characters. Not reproduced: images, headers, footers, footnotes, bold/italic/underline, fonts, sizes, colours, alignment, cells merged down rows (shown as separate cells), text boxes, shapes, charts, comments, multiple columns, clickable links (link text is kept) and exact Word pagination. Documents with other scripts (for example Greek, Cyrillic, Arabic or Asian) or unresolved tracked deletions are refused. Review every converted page before placing fields or sending; for an exact layout, upload a PDF exported from Word.";
export const terminal = ["completed", "declined", "expired", "voided"];
export const fieldTypes = ["signature", "initials", "name", "date", "text", "checkbox"] as const;
export type Geometry = { x: number; y: number; width: number; height: number; rotation: number };
export const recipientInput = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100), email: z.email().max(200).refine(v => process.env.NODE_ENV==="production" || v.toLowerCase().endsWith(".test"), "Verification mode accepts synthetic .test addresses only"), order: z.number().int().min(1).max(10), accessCode: z.string().regex(/^.{6,64}$/).optional() });
export const fieldInput = z.object({ id: z.uuid(), documentId: z.uuid(), recipientId: z.uuid(), type: z.enum(fieldTypes), page: z.number().int().min(0).max(49), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().min(12).max(2000), height: z.number().finite().min(12).max(2000), required: z.boolean() });
export type Field = z.infer<typeof fieldInput>;
export const draftInput = z.object({ version: z.number().int().positive(), title: z.string().trim().min(1).max(160), routing: z.enum(["parallel", "sequential"]), folder: z.string().trim().max(60).default(""), tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]), recipients: z.array(recipientInput).max(10), fields: z.array(fieldInput).max(200) });
export function fieldInside(f: Field, p: Geometry) { return f.x >= p.x && f.y >= p.y && f.x + f.width <= p.x + p.width + 0.01 && f.y + f.height <= p.y + p.height + 0.01; }
export const valuesInput = z.record(z.string(), z.union([z.string().max(20000).refine(v=>{if(typeof v==="string" && isDrawing(v)){try{parseDrawing(v);return true;}catch{return false;}}return v.length<=500&&/^[\x20-\x7e\u00a0-\u00ff\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u20ac]*$/.test(v);},"Use Western European characters (letters with accents are fine) or a valid bounded drawn signature"), z.boolean()]));
export class SigningFieldError extends Error {
  constructor(public readonly fieldId: string, message: string) {
    super(message);
    this.name = "SigningFieldError";
  }
}

export function validateValues(fields: Field[], values: Record<string, string | boolean>) {
  if (Object.keys(values).some(id => !fields.some(field => field.id === id))) {
    throw new Error("A field is not assigned to this recipient");
  }
  for (const field of fields) {
    const value = values[field.id];
    if (typeof value === "string" && isDrawing(value)) {
      if (field.type !== "signature" && field.type !== "initials") {
        throw new SigningFieldError(field.id, "Drawings are only valid for signatures and initials");
      }
      try {
        parseDrawing(value);
      } catch (error) {
        throw new SigningFieldError(field.id, error instanceof Error ? error.message : "Enter a valid drawing");
      }
      continue;
    }
    if (value === undefined && !field.required) continue;
    if (field.type === "checkbox") {
      if (typeof value !== "boolean" || (field.required && !value)) {
        throw new SigningFieldError(field.id, "Required checkbox must be checked");
      }
      continue;
    }
    if (typeof value !== "string" || (field.required && !value.trim()) ||
        (field.type === "date" && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))) {
      throw new SigningFieldError(field.id, "Complete all required fields with valid values");
    }
  }
}

export const CONSENT_TEXT = "I agree to review these documents electronically and use my typed or drawn signature or initials for my assigned fields. I can review all pages before submitting. After all recipients sign, the sender can provide signed copies and a completion receipt. I may decline before signing.";
