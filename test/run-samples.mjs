// รัน engine กับเอกสารตัวอย่างในเครื่อง (AGRID + DC2DC) แล้วสรุปผล — ใช้ตรวจว่า JS ให้ผลตรงกับ Python
import fs from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { analyzeFiles } from "../src/engine/index.js";

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["../AGRID", "../DC2DC"];
const files = [];
for (const root of roots) {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs)) continue;
  for (const dir of fs.readdirSync(abs, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(abs, dir.name))) {
      if (!/\.pdf$/i.test(f)) continue;
      files.push({ name: f, path: `${path.basename(abs)}/${dir.name}/${f}`, bytes: new Uint8Array(fs.readFileSync(path.join(abs, dir.name, f))) });
    }
  }
}
console.error(`files: ${files.length}`);
const t0 = Date.now();
const { results, errors } = await analyzeFiles(pdfjs, files, {
  wantImages: false,
  today: new Date("2026-09-29"),
  onProgress: (p) => process.stderr.write(`\r${p.done}/${p.total} ${p.file.slice(0, 60)}          `),
});
console.error(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);
fs.mkdirSync("test/out", { recursive: true });
const slim = results.map((r) => ({ key: r.site.key, code: r.facts.code, profile: r.facts.profile, nearest: r.facts.nearestProfile, mismatches: r.facts.profileMismatches, degrees: r.facts.degrees, power: r.facts.power, shelves: r.facts.shelves, summary: r.summary, issues: r.issues }));
fs.writeFileSync("test/out/results.json", JSON.stringify(slim, null, 1));
let total = 0;
for (const r of slim) {
  const real = r.issues.filter((i) => i.severity !== "info");
  total += real.length;
  console.log(`== ${r.key} [${r.profile || "no-profile→" + r.nearest}] deg=${r.degrees} pw=${r.power} ${r.summary.status} fail=${r.summary.fail} warn=${r.summary.warn}`);
  for (const i of r.issues) if (i.severity !== "info") console.log(`   L${i.level} ${i.severity.toUpperCase()} ${i.rule} ${i.section} p${i.page ?? "-"}: ${i.msg}`);
}
console.log(`\nsites=${slim.length} issues(fail+warn)=${total} errors=${errors.length}`);
for (const e of errors) console.log("ERROR", e.name, e.error);
