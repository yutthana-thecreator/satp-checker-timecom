import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdf } from "../src/engine/extract.js";

const f = process.argv[2];
const data = new Uint8Array(fs.readFileSync(f));
const r = await extractPdf(pdfjs, data);
for (const p of r.pages) {
  console.log(`=== PAGE ${p.no} === img=${p.imageCount} | ${p.text}`);
}
