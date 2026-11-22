import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { fail } from "./errors";
import { DOCX_NOTICE } from "../lib/model";
export { DOCX_NOTICE };

// Bounded DOCX -> PDF conversion. Keeps paragraphs, headings, bulleted and numbered lists, tables
// (bordered cells with the document's column widths, horizontal merges) and explicit page breaks,
// with Western European (WinAnsi / Latin-1) characters. Images, character formatting, fonts, colours,
// headers/footers, footnotes, columns and exact Word pagination are not reproduced (see DOCX_NOTICE).
type Para = { kind: "p"; text: string; heading: boolean; prefix: string; level: number };
type Cell = { text: string; span: number };
type Block = Para | { kind: "break" } | { kind: "table"; widths: number[]; rows: Cell[][] };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const TYPOGRAPHY: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " " };
const clean = (v: string) => v.replace(/&(amp|lt|gt|quot|apos);/g, m => ENTITIES[m]).replace(/[‘’“”–—… ]/g, m => TYPOGRAPHY[m]);
const attr = (n: any, name: string) => n?.[":@"]?.[`@_${name}`];
const children = (n: any, key: string): any[] => (Array.isArray(n?.[key]) ? n[key] : []);
const first = (ns: any[], key: string) => ns.find(x => x?.[key] !== undefined);
// Keep text exactly as written: no trimming (spaces between runs matter) and no number parsing.
const ordered = () => new XMLParser({ preserveOrder: true, ignoreAttributes: false, processEntities: false, trimValues: false, parseTagValue: false });

// ---- List numbering (numbering.xml + styles.xml) ----
type Level = { fmt: string; text: string; start: number };
const roman = (n: number) => { let r = ""; for (const [v, s] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (n >= v) { r += s; n -= v; } return r; };
const letters = (n: number) => { let r = ""; while (n > 0) { n--; r = String.fromCharCode(97 + (n % 26)) + r; n = Math.floor(n / 26); } return r; };
function formatNumber(fmt: string, n: number) {
  switch (fmt) {
    case "lowerLetter": return letters(n);
    case "upperLetter": return letters(n).toUpperCase();
    case "lowerRoman": return roman(n);
    case "upperRoman": return roman(n).toUpperCase();
    case "decimalZero": return String(n).padStart(2, "0");
    default: return String(n);
  }
}
function numbering(numXml?: string, stylesXml?: string) {
  const P = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false, isArray: n => ["w:abstractNum", "w:num", "w:lvl", "w:style", "w:lvlOverride"].includes(n) });
  const val = (n: any) => n?.["@_w:val"];
  const abstract = new Map<string, Map<number, Level>>(), nums = new Map<string, { abs: string; start: Map<number, number> }>();
  const N = numXml ? P.parse(numXml)?.["w:numbering"] ?? {} : {};
  for (const a of N["w:abstractNum"] ?? []) {
    const lv = new Map<number, Level>();
    for (const l of a["w:lvl"] ?? []) lv.set(Number(l["@_w:ilvl"]) || 0, { fmt: String(val(l["w:numFmt"]) ?? "decimal"), text: String(val(l["w:lvlText"]) ?? ""), start: Number(val(l["w:start"]) ?? 1) || 1 });
    abstract.set(String(a["@_w:abstractNumId"]), lv);
  }
  for (const n of N["w:num"] ?? []) {
    const start = new Map<number, number>();
    for (const o of n["w:lvlOverride"] ?? []) if (val(o["w:startOverride"]) !== undefined) start.set(Number(o["@_w:ilvl"]) || 0, Number(val(o["w:startOverride"])) || 1);
    nums.set(String(n["@_w:numId"]), { abs: String(val(n["w:abstractNumId"])), start });
  }
  const styles = new Map<string, { basedOn?: string; numId?: string; ilvl?: number }>();
  for (const s of (stylesXml ? P.parse(stylesXml)?.["w:styles"]?.["w:style"] : undefined) ?? []) {
    const np = s["w:pPr"]?.["w:numPr"];
    styles.set(String(s["@_w:styleId"]), { basedOn: val(s["w:basedOn"]), numId: val(np?.["w:numId"]), ilvl: val(np?.["w:ilvl"]) !== undefined ? Number(val(np["w:ilvl"])) : undefined });
  }
  const counters = new Map<string, number[]>();
  // Returns the list marker for a paragraph and advances that list's counters.
  return function marker(pPr: any[], style: string): { prefix: string; level: number } {
    const np = first(pPr, "w:numPr")?.["w:numPr"] ?? [];
    let numId = attr(first(np, "w:numId"), "w:val") as string | undefined, ilvl = attr(first(np, "w:ilvl"), "w:val") as string | undefined;
    for (let s = styles.get(style), guard = 0; !numId && s && guard < 10; s = s.basedOn ? styles.get(s.basedOn) : undefined, guard++) { numId = s.numId; if (ilvl === undefined && s.ilvl !== undefined) ilvl = String(s.ilvl); }
    if (!numId || numId === "0") return { prefix: "", level: 0 };
    const num = nums.get(String(numId)), levels = num ? abstract.get(num.abs) : undefined;
    const level = Math.min(8, Math.max(0, Number(ilvl) || 0));
    if (!levels) return { prefix: "", level };
    const startOf = (l: number) => num!.start.get(l) ?? levels.get(l)?.start ?? 1;
    const c = counters.get(String(numId)) ?? Array.from({ length: 9 }, (_, l) => startOf(l) - 1);
    c[level]++; for (let l = level + 1; l < 9; l++) c[l] = startOf(l) - 1;
    counters.set(String(numId), c);
    const lv = levels.get(level) ?? { fmt: "decimal", text: `%${level + 1}.`, start: 1 };
    if (lv.fmt === "bullet") return { prefix: "•", level };
    if (lv.fmt === "none") return { prefix: "", level };
    const prefix = lv.text.replace(/%([1-9])/g, (_, d) => { const l = Number(d) - 1; return formatNumber(levels.get(l)?.fmt ?? "decimal", Math.max(1, c[l])); });
    return { prefix: clean(prefix).trim(), level };
  };
}

function parse(xml: string, numXml?: string, stylesXml?: string): Block[] {
  const nodes = ordered().parse(xml);
  const marker = numbering(numXml, stylesXml);
  const blocks: Block[] = [];
  // Run text: only <w:t> carries text (XML whitespace between elements is ignored); "\f" marks a page break.
  function textOf(ns: any[], inT = false): string {
    let out = "";
    for (const n of ns) for (const [k, v] of Object.entries(n)) {
      if (k === ":@" || k === "w:pPr" || k === "w:rPr" || k === "w:instrText" || k === "w:delText") continue;
      if (k === "#text") { if (inT) out += String(v); }
      else if (k === "w:tab") out += "    ";
      else if (k === "w:noBreakHyphen") out += "-";
      else if (k === "w:br" || k === "w:cr") out += attr(n, "w:type") === "page" ? "\f" : "\n";
      else if (Array.isArray(v)) out += textOf(v, k === "w:t" || inT);
    }
    return out;
  }
  function para(p: any[]) {
    const pPr = first(p, "w:pPr")?.["w:pPr"] ?? [];
    const style = String(attr(first(pPr, "w:pStyle"), "w:val") ?? "");
    return { pPr, heading: /^(Heading|Title)/i.test(style), ...marker(pPr, style), text: clean(textOf(p)) };
  }
  function paragraph(p: any[], target: Block[]) {
    const { pPr, heading, prefix, level, text } = para(p);
    if (pPr.some((x: any) => x["w:pageBreakBefore"] !== undefined)) target.push({ kind: "break" });
    text.split("\f").forEach((t, i) => {
      if (i > 0) target.push({ kind: "break" });
      if (t.trim() || i === 0) target.push({ kind: "p", text: t, heading, prefix: i === 0 ? prefix : "", level });
    });
    if (pPr.some((x: any) => x["w:sectPr"] !== undefined)) target.push({ kind: "break" });
  }
  function cellText(tc: any[]): string {
    const lines: string[] = [];
    (function walk(ns: any[]) { for (const n of ns) for (const [k, v] of Object.entries(n)) if (Array.isArray(v)) { if (k === "w:p") { const q = para(v); lines.push(((q.prefix ? `${q.prefix} ` : "") + q.text).replace(/\f/g, "\n")); } else if (k !== "w:tcPr") walk(v); } })(tc);
    return lines.join("\n");
  }
  function table(tbl: any[]) {
    const grid = first(tbl, "w:tblGrid")?.["w:tblGrid"] ?? [];
    const widths = grid.filter((x: any) => x["w:gridCol"] !== undefined).map((x: any) => Number(attr(x, "w:w")) || 1);
    const rows: Cell[][] = [];
    for (const tr of tbl.filter(x => x["w:tr"])) rows.push(children(tr, "w:tr").filter((x: any) => x["w:tc"]).map((tc: any) => {
      const tcPr = first(tc["w:tc"], "w:tcPr")?.["w:tcPr"] ?? [];
      return { text: cellText(tc["w:tc"]), span: Math.max(1, Number(attr(first(tcPr, "w:gridSpan"), "w:val")) || 1) };
    }));
    const span = (r: Cell[]) => r.reduce((a, c) => a + c.span, 0);
    const cols = Math.max(1, ...rows.map(span));
    blocks.push({ kind: "table", widths: widths.length === cols ? widths : Array(cols).fill(1), rows: rows.map(r => [...r, ...Array.from({ length: cols - span(r) }, () => ({ text: "", span: 1 }))]) });
  }
  (function walk(ns: any[]) {
    for (const n of ns) for (const [k, v] of Object.entries(n)) {
      if (!Array.isArray(v)) continue;
      if (k === "w:p") paragraph(v, blocks);
      else if (k === "w:tbl") table(v);
      else if (k !== "w:sectPr") walk(v);
    }
  })(nodes);
  while (blocks.length && blocks[blocks.length - 1].kind === "break") blocks.pop();
  return blocks;
}

export async function convertDocx(bytes: Buffer) {
  if (bytes.length > 8 * 1024 * 1024 || bytes.subarray(0, 4).toString("hex") !== "504b0304") fail(400, "DOCX_INVALID", "Upload a valid DOCX up to 8 MB.");
  try {
    let total = 0;
    const wanted = ["word/document.xml", "[Content_Types].xml", "word/numbering.xml", "word/styles.xml"];
    const files = unzipSync(bytes, { filter: f => { total += f.originalSize; if (f.originalSize > 16 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error("Expanded DOCX exceeds limit"); return wanted.includes(f.name); } });
    if (!files["word/document.xml"] || !files["[Content_Types].xml"]) throw new Error("Missing DOCX parts");
    const text = (name: string) => (files[name] ? Buffer.from(files[name]).toString() : undefined);
    const xml = text("word/document.xml")!;
    if (/<!DOCTYPE|<!ENTITY|w:altChunk|w:object|w:del[\s>]/i.test(xml)) throw new Error("Active content or unresolved tracked deletion unsupported");
    for (const part of ["word/numbering.xml", "word/styles.xml"]) if (/<!DOCTYPE|<!ENTITY/i.test(text(part) ?? "")) throw new Error("Unsafe XML");
    const blocks = parse(xml, text("word/numbering.xml"), text("word/styles.xml"));
    const allText = blocks.map(b => b.kind === "p" ? `${b.prefix} ${b.text}` : b.kind === "table" ? b.rows.flat().map(c => c.text).join(" ") : "").join("\n");
    if (!allText.trim() || allText.length > 200000) throw new Error("Empty or oversized text");

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    // Western European (WinAnsi) characters only; other scripts are refused rather than dropped.
    font.encodeText(allText.replace(/[\t\n\r\f]/g, " "));
    const W = 595.28, H = 841.89, M = 48, TOP = H - 52, BOTTOM = 50, CW = W - 2 * M;
    let page: PDFPage = pdf.addPage([W, H]), y = TOP, fresh = true;
    const newPage = () => { if (pdf.getPageCount() >= 50) throw new Error("Page limit"); page = pdf.addPage([W, H]); y = TOP; fresh = true; };
    const wrap = (text: string, f: PDFFont, size: number, width: number) => {
      const out: string[] = [];
      for (const part of text.split("\n")) {
        let cur = "";
        for (const word of part.split(/\s+/).filter(Boolean)) {
          if (f.widthOfTextAtSize(word, size) > width) throw new Error("Word too long for conversion");
          const next = cur ? `${cur} ${word}` : word;
          if (f.widthOfTextAtSize(next, size) > width) { out.push(cur); cur = word; } else cur = next;
        }
        out.push(cur);
      }
      return out;
    };
    for (const b of blocks) {
      if (b.kind === "break") { if (!fresh) newPage(); continue; }
      if (b.kind === "p") {
        const size = b.heading ? 14 : 11, lh = b.heading ? 19 : 16, f = b.heading ? bold : font;
        const indent = b.prefix ? 18 * b.level : 0, gap = b.prefix ? Math.max(14, f.widthOfTextAtSize(b.prefix, size) + 6) : 0;
        wrap(b.text, f, size, CW - indent - gap).forEach((l, i) => {
          if (y - lh < BOTTOM) newPage();
          if (i === 0 && b.prefix) page.drawText(b.prefix, { x: M + indent, y: y - size, size, font: f });
          if (l) page.drawText(l, { x: M + indent + gap, y: y - size, size, font: f });
          y -= lh; fresh = false;
        });
        y -= 6;
        continue;
      }
      const sum = b.widths.reduce((a, v) => a + v, 0), colW = b.widths.map(v => (v / sum) * CW), pad = 4, size = 10, lh = 13;
      for (const row of b.rows) {
        let col = 0;
        const cells = row.map(c => { const w = colW.slice(col, col + c.span).reduce((a, v) => a + v, 0); col += c.span; return { w, lines: wrap(c.text, font, size, Math.max(12, w - 2 * pad)) }; });
        const h = Math.max(1, ...cells.map(c => c.lines.length)) * lh + 2 * pad;
        if (h > TOP - BOTTOM) throw new Error("Table row taller than a page");
        if (y - h < BOTTOM) newPage();
        let x = M;
        for (const c of cells) {
          page.drawRectangle({ x, y: y - h, width: c.w, height: h, borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.6 });
          c.lines.forEach((l, j) => l && page.drawText(l, { x: x + pad, y: y - pad - size - j * lh + 1, size, font }));
          x += c.w;
        }
        y -= h; fresh = false;
      }
      y -= 10;
    }
    return { bytes: Buffer.from(await pdf.save()), converter: "bounded-docx-layout-v3", notice: DOCX_NOTICE };
  } catch {
    fail(400, "DOCX_INVALID", "DOCX cannot be safely converted. It must use Western European characters and have no unresolved tracked changes; otherwise export a PDF from Word. Expanded file limit 32 MB; maximum 50 pages.");
  }
}
