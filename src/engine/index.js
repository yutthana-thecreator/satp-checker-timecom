// จุดเข้าเดียวของ engine: รับรายการไฟล์ (ชื่อ + bytes) → ผลตรวจรายไซต์
import { extractPdf } from "./extract.js";
import { docKind, parseSatp, parseAttachment, parseFileName } from "./parse.js";
import { checkSite, crossSiteChecks, summarize } from "./rules.js";
import { DEFAULT_CRITERIA } from "./profiles.js";

export { DEFAULT_CRITERIA };

// files: [{ name, path, bytes:Uint8Array }] — path ใช้หาโฟลเดอร์ไซต์
export async function analyzeFiles(pdfjs, files, { criteria = DEFAULT_CRITERIA, onProgress = () => {}, wantImages = true, today = new Date() } = {}) {
  const docs = [];
  let n = 0;
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name)) continue;
    onProgress({ stage: "extract", file: f.name, done: n, total: files.length });
    let ex;
    try { ex = await extractPdf(pdfjs, f.bytes, { wantImages }); }
    catch (e) { docs.push({ name: f.name, path: f.path, error: String(e) }); n++; continue; }
    const kind = docKind(f.name, ex.pages);
    const parsed = kind === "SATP" ? parseSatp(ex.pages) : parseAttachment(ex.pages);
    parsed.file = parseFileName(f.name);
    docs.push({ name: f.name, path: f.path, kind, parsed, pages: ex.pages });
    n++;
  }
  // จัดกลุ่มเป็นไซต์: ตามโฟลเดอร์ก่อน ถ้าไม่มีโฟลเดอร์ใช้รหัสจาก Station Name/ชื่อไฟล์
  const groups = new Map();
  for (const d of docs) {
    if (d.error) continue;
    const folder = (d.path || "").split(/[\\/]/).slice(0, -1).pop() || "";
    const key = folder || d.parsed.header?.neCode || d.parsed.file.code || d.name;
    if (!groups.has(key)) groups.set(key, { key, folder, docs: [] });
    groups.get(key).docs.push(d);
  }
  const results = [];
  for (const g of groups.values()) {
    const satpDoc = g.docs.find((d) => d.kind === "SATP");
    const attDoc = g.docs.find((d) => d.kind === "ATT");
    const folderCode = (g.folder.match(/(?:^\d+\.\s*)?([A-Z0-9]{5,9})/) || [])[1] || "";
    const site = {
      key: g.key, folder: g.folder, folderCode,
      code: satpDoc?.parsed.header?.neCode || satpDoc?.parsed.file.code || attDoc?.parsed.header?.neCode || folderCode,
      satp: satpDoc?.parsed || null, att: attDoc?.parsed || null,
      satpFile: satpDoc?.name || "", attFile: attDoc?.name || "",
      pagesSatp: satpDoc?.pages || null, pagesAtt: attDoc?.pages || null,
    };
    const { issues, facts } = checkSite(site, criteria, today);
    results.push({ site, issues, facts });
  }
  crossSiteChecks(results);
  for (const r of results) {
    r.issues.sort((a, b) => (a.level || 9) - (b.level || 9) || sevRank(a) - sevRank(b));
    r.summary = summarize(r.issues);
  }
  results.sort((a, b) => a.site.key.localeCompare(b.site.key));
  const errors = docs.filter((d) => d.error);
  return { results, errors };
}

const sevRank = (i) => ({ fail: 0, warn: 1, info: 2 })[i.severity] ?? 3;
