import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts, rgb, degrees } from "pdf-lib";
import { isDrawing,parseDrawing } from "../lib/drawing";
import { hash } from "./crypto";
import { AppError } from "./errors";
import type { Field, Geometry } from "../lib/model";
export const MAX_BYTES = 8 * 1024 * 1024;
export async function inspectPdf(bytes: Uint8Array) {
  if (bytes.length > MAX_BYTES || bytes.length < 16 || Buffer.from(bytes.subarray(0,5)).toString() !== "%PDF-") throw new AppError(400,"PDF_INVALID","Upload a valid PDF or DOCX up to 8 MB.");
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 50) throw new Error("Encrypted PDF or page limit exceeded");
    // Reject interactive/action-bearing files. No remote document services or embedded execution.
    const seen = new Set<unknown>();
    function scan(obj: unknown) {
      if(seen.has(obj)) return; seen.add(obj);
      if(obj instanceof PDFDict) {
        for(const key of ["JS","JavaScript","OpenAction","AA","EmbeddedFiles","XFA","Launch","RichMedia","A","AcroForm"]) if(obj.has(PDFName.of(key))) throw new Error("Interactive or embedded content is unsupported");
        for(const [,value] of obj.entries()) scan(value);
      } else if(obj instanceof PDFArray) for(const value of obj.asArray()) scan(value);
    }
    for(const [,obj] of pdf.context.enumerateIndirectObjects()) scan(obj);
    for (const p of pdf.getPages()) { const annotations=p.node.lookupMaybe(PDFName.of("Annots"),PDFArray); if (annotations?.size()) throw new Error("Annotated PDFs must be flattened before upload"); if (p.node.has(PDFName.of("UserUnit"))) throw new Error("Custom PDF units unsupported"); }
    for(const p of pdf.getPages()) {
      const c=p.getCropBox(),m=p.getMediaBox();
      if(c.x<m.x || c.y<m.y || c.x+c.width>m.x+m.width || c.y+c.height>m.y+m.height) throw new Error("Crop box must fit media box");
    }
    const geometry: Geometry[] = pdf.getPages().map(p => ({ ...p.getCropBox(), rotation: ((p.getRotation().angle % 360) + 360) % 360 }));
    if (geometry.some(p => ![0,90,180,270].includes(p.rotation) || ![p.x,p.y,p.width,p.height].every(Number.isFinite) || p.width < 72 || p.height < 72 || p.width > 2000 || p.height > 2000)) throw new Error("Unsupported page geometry");
    return { geometry, sha256: hash(bytes), size: bytes.length };
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError(400,"PDF_INVALID","PDF cannot be parsed, is encrypted, interactive, oversized, or exceeds 50 pages."); }
}
export async function flatten(bytes: Uint8Array, fields: Field[], values: Record<string,string|boolean>) {
  const pdf=await PDFDocument.load(bytes, {updateMetadata:false});
  const font=await pdf.embedFont(StandardFonts.Helvetica), script=await pdf.embedFont(StandardFonts.TimesRomanItalic);
  for (const f of fields) {
    const v=values[f.id]; if(v === undefined || v === false || v === "") continue;
    const page=pdf.getPage(f.page), chosen=f.type === "signature" || f.type === "initials" ? script : font;
    const rotationValue=((page.getRotation().angle%360)+360)%360;
    if(typeof v==="string" && isDrawing(v)) {
      const placement=textPlacement(f,rotationValue);
      for(const stroke of parseDrawing(v))for(let i=1;i<stroke.length;i++)page.drawLine({start:placement.point(stroke[i-1][0]*placement.width,(1-stroke[i-1][1])*placement.height),end:placement.point(stroke[i][0]*placement.width,(1-stroke[i][1])*placement.height),thickness:1.5,color:rgb(.08,.14,.23)});
      continue;
    }
    const text=v === true ? "X" : String(v);
    const rotation=((page.getRotation().angle%360)+360)%360;
    const placement=textPlacement(f,rotation);
    const width=chosen.widthOfTextAtSize(text, 1);
    const size=Math.min(f.type === "signature" ? 22 : 12, placement.height-4, (placement.width-6)/Math.max(width,1));
    const baseline=Math.max(2,(placement.height-size)/2);
    const origin=placement.point(3,baseline);
    page.drawText(text,{...origin,size,font:chosen,rotate:degrees(rotation),color:rgb(.08,.14,.23) });
  }
  if(pdf.catalog.has(PDFName.of("AcroForm"))) pdf.getForm().flatten();
  // pdf-lib can create empty annotation arrays while drawing text. Clean only
  // those empty arrays in this new output; retain any actual annotations.
  for(const page of pdf.getPages()) {
    const annotations=page.node.lookupMaybe(PDFName.of("Annots"),PDFArray);
    if(annotations?.size()===0) page.node.delete(PDFName.of("Annots"));
  }
  return Buffer.from(await pdf.save());
}
export async function syntheticPdf(title: string, landscape=false) {
  const pdf=await PDFDocument.create(); const page=pdf.addPage(landscape ? [792,612] : [595.28,841.89]); const f=await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("SYNTHETIC / DEVELOPMENT ONLY",{x:48,y:page.getHeight()-52,size:10,font:f,color:rgb(.2,.35,.65)});
  page.drawText(title,{x:48,y:page.getHeight()-102,size:22,font:f});
  ["This sample document contains no customer information.","Prepared for Avery Morgan and Jordan Lee.","Review the terms and complete your assigned fields.","No legal or certification claim is made by this demonstration."].forEach((s,i)=>page.drawText(s,{x:48,y:page.getHeight()-150-i*28,size:11,font:f}));
  return Buffer.from(await pdf.save());
}

// Field rectangles use unrotated PDF points; text follows the displayed page orientation.
export function textPlacement(f: Pick<Field,"x"|"y"|"width"|"height">, rotation:number) {
  const {x,y,width:w,height:h}=f;
  return {width:rotation%180?h:w,height:rotation%180?w:h,point:(u:number,v:number)=>{
    if(rotation===90) return {x:x+w-v,y:y+u};
    if(rotation===180) return {x:x+w-u,y:y+h-v};
    if(rotation===270) return {x:x+v,y:y+h-u};
    return {x:x+u,y:y+v};
  }};
}
