import { copyFileSync, mkdirSync, cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require=createRequire(import.meta.url), root=dirname(require.resolve("pdfjs-dist/package.json"));
mkdirSync("public/pdfjs",{recursive:true});
copyFileSync(join(root,"build/pdf.worker.min.mjs"),"public/pdfjs/pdf.worker.min.mjs");
cpSync(join(root,"standard_fonts"),"public/pdfjs/standard_fonts",{recursive:true});
cpSync(join(root,"cmaps"),"public/pdfjs/cmaps",{recursive:true});
cpSync(join(root,"wasm"),"public/pdfjs/wasm",{recursive:true});
