import { z } from "zod";
export const DRAW_PREFIX="drawn:v1:";
const point=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
const strokes=z.array(z.array(point).min(2).max(300)).min(1).max(20).refine(s=>s.reduce((n,p)=>n+p.length,0)<=600,"Signature has too many points");
export function parseDrawing(value:string) {if(!value.startsWith(DRAW_PREFIX))throw new Error("Invalid drawn signature");return strokes.parse(JSON.parse(value.slice(DRAW_PREFIX.length)));}
export function isDrawing(value:unknown):boolean {return typeof value==="string"&&value.startsWith(DRAW_PREFIX);}
