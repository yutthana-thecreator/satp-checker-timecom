import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdf } from "../src/engine/extract.js";
const r = await extractPdf(pdfjs, new Uint8Array(fs.readFileSync(process.argv[2])), { wantImages: true });
for (const p of r.pages) console.log(p.no, p.images.map(i => `${i.id}:${i.width}x${i.height}`).join(" "));
