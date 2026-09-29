import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdf } from "../src/engine/extract.js";
import { parseSatp, parseAttachment, docKind, parseFileName } from "../src/engine/parse.js";

const f = process.argv[2];
const data = new Uint8Array(fs.readFileSync(f));
const r = await extractPdf(pdfjs, data);
const kind = docKind(f, r.pages);
const parsed = kind === "SATP" ? parseSatp(r.pages) : parseAttachment(r.pages);
parsed.file = parseFileName(f.split(/[\\/]/).pop());
parsed.imageCounts = r.pages.map((p) => p.imageCount);
if (parsed.blockDiagram) parsed.blockDiagram = { page: parsed.blockDiagram.no, imageCount: parsed.blockDiagram.imageCount };
console.log(JSON.stringify(parsed, null, 1));
