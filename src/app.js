// หน้าเว็บหลัก — ทุกอย่างทำในเบราว์เซอร์ ไม่มี request ส่งไฟล์ออกไป
import { analyzeFiles, DEFAULT_CRITERIA } from "./engine/index.js";
import { MASTERFILE_DATE, SITES } from "./data/sites.js";
import { buildWorkbook, reviewStats } from "./ui/report.js";
import { pageImageCanvases, aHash, hamming, blurScore, thumb, pixelDigest, renderPage } from "./ui/images.js";
import { ocrSite, ocrLabels } from "./ui/ocr.js";
import { labelExpectations, checkLabelText, labelTopicOf } from "./engine/labels.js";
import { ocrChecks, parseInventory } from "./engine/ocrRules.js";
import { summarize } from "./engine/rules.js";
import { setLearnedProfiles } from "./engine/profiles.js";
import { kb, applyDecisions, recordDecision, forgetDecision, deleteDecisionRecord, learnProfile, forgetProfile, addRefImage, refImagesFor, refImagesForProfile, refVectorsForProfile, refThumb, backfillEmbeddings, setRefDigests, ensureThumbs, removeRefImage, listRefKeys, isReferenceSource, recordImageDecision, findImageDecision, recordSectionCount, expectedCount, recordInventory, topicOf, kbStats, syncFromCloud, uploadLocalToCloud } from "./ui/learn.js";
import { cloud, initCloud } from "./ui/cloud.js";
import { embedder, loadEmbedder, embedImage, encodeEmb, decodeEmb, cosine, rank } from "./ui/embed.js";
import { i18n, initLang, setLang, L, M, msgOf, statusText, sectionText, whoText, sevText, levelText, REJECT_REASONS_TH, reasonText } from "./i18n.js";

const VERSION = "0.2.0";
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const REJECT_REASONS = REJECT_REASONS_TH; // ค่าภายในเป็นไทย แสดงตามภาษาด้วย reasonText
// ข้อความคงที่ในหน้า (index.html data-i18n)
const STATIC = {
  sub: ["ตรวจเอกสาร SATP + Attachment Report ในเบราว์เซอร์ — ไฟล์ PDF ไม่ถูกส่งออกจากเครื่องนี้ (ขึ้นคลาวด์ของทีมเฉพาะสิ่งที่ระบบเรียนรู้)", "Checks SATP + Attachment Report in the browser — PDF files never leave this PC (only what the system learns goes to the team cloud)"],
  "h-load": ["1. โหลดไฟล์", "1. Load files"], "drop-main": ["ลากไฟล์ PDF / zip / โฟลเดอร์มาวางที่นี่", "Drop PDF / zip / folder here"], "drop-or": ["หรือ", "or"],
  "pick-files": ["เลือกไฟล์", "Choose files"], "pick-folder": ["เลือกโฟลเดอร์", "Choose folder"],
  "drop-hint": ["ต่อไซต์ต้องมี SATP 1 ไฟล์ + Attachment Report 1 ไฟล์ (ชื่อไฟล์ตาม template TIME) — วางหลายไซต์พร้อมกันได้", "Each site needs 1 SATP + 1 Attachment Report (TIME template file names) — several sites at once is fine"],
  run: ["ตรวจเอกสาร", "Check documents"], clear: ["ล้าง", "Clear"],
  "scope-hint": ["ตรวจเฉพาะเอกสารที่ subcon ส่งมาก่อน submit — ไฟล์ที่ลูกค้าเซ็น/มี Acceptance Date แล้วจะถือว่าผ่านทั้งหมด", "Checks subcon documents before submission — files already signed / with an Acceptance Date count as fully passed"],
  criteria: ["เกณฑ์ตรวจ", "Thresholds"], "h-results": ["2. ผลตรวจ", "2. Results"], export: ["ดาวน์โหลด Excel", "Download Excel"],
  harvest: ["ใช้ทุกไซต์ในชุดนี้เป็นรูปอ้างอิง", "Use all sites in this batch as reference"], "harvest-title": ["ROM ยืนยันว่ารูปของทุกไซต์ในชุดนี้ถูกต้อง → ใช้เป็นรูปอ้างอิงเทียบกับไซต์ต่อไป", "ROM confirms every photo in this batch is correct → used as reference for future sites"],
  reviewer: ["ผู้ตรวจ", "Reviewer"], "reviewer-ph": ["ชื่อ", "name"],
  "h-kb": ["ฐานความรู้ — การตัดสินใจของ ROM", "Knowledge base — ROM decisions"], "h-history": ["ประวัติการตรวจ (เก็บในเบราว์เซอร์นี้)", "Check history (stored in this browser)"],
  "clear-history": ["ล้างประวัติทั้งหมด", "Clear all history"], "clear-reviews": ["ล้างผลตรวจรูป (Accept/Reject) ทั้งหมด", "Clear all photo verdicts (Accept/Reject)"], "clear-all": ["ล้างข้อมูลทั้งหมดในเบราว์เซอร์นี้", "Clear all data in this browser"],
  "clear-hint": ["ล้างเฉพาะเครื่องนี้ — ไม่กระทบเครื่องอื่นหรือไฟล์ที่ส่งออกไว้", "This PC only — other PCs and exported files are not affected"],
  "footer-1": ["โปรไฟล์อ้างอิงและเกณฑ์เริ่มต้นสร้างจากเอกสารตัวอย่าง 46 ไซต์ (AGRID/DC2DC) · รายชื่อไซต์จาก Masterfile", "Reference profiles and default thresholds come from 46 sample sites (AGRID/DC2DC) · site list from Masterfile"],
  "footer-2": ["ประวัติและผลตรวจรูปเก็บใน localStorage ของเครื่องนี้เท่านั้น", "History and photo verdicts are kept only in this browser's localStorage"],
};
function applyStaticI18n() {
  for (const e of document.querySelectorAll("[data-i18n]")) { const p = STATIC[e.dataset.i18n]; if (p) e.textContent = L(p[0], p[1]); }
  for (const e of document.querySelectorAll("[data-i18n-title]")) { const p = STATIC[e.dataset.i18nTitle]; if (p) e.title = L(p[0], p[1]); }
  for (const e of document.querySelectorAll("[data-i18n-placeholder]")) { const p = STATIC[e.dataset.i18nPlaceholder]; if (p) e.placeholder = L(p[0], p[1]); }
  document.documentElement.lang = i18n.lang;
  for (const b of document.querySelectorAll("#lang-switch button")) b.classList.toggle("active", b.dataset.lang === i18n.lang);
}
// เปลี่ยนภาษา → วาดทุกส่วนใหม่จากข้อมูลเดิม (ประเด็น/หมายเหตุเก็บไว้ทั้งสองภาษาแล้ว)
function switchLang(l) {
  setLang(l); applyStaticI18n();
  renderCloudBar(); renderCriteria(); renderKb(); renderHistory(); renderFileList();
  if (run) { const open = $("#details").dataset.site; renderResults(); const r = run.results.find((x) => x.site.key === open); if (r) showDetail(r); }
}

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? (e.className = v) : k.startsWith("on") ? e.addEventListener(k.slice(2), v) : k === "html" ? (e.innerHTML = v) : e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

let pdfjs = null;
let files = []; // {name, path, bytes}
let run = null; // {results, errors, when}
let criteria = loadCriteria();
const reviews = {}; // siteKey -> {items:[...]}

init();

async function init() {
  initLang(); applyStaticI18n();
  for (const b of document.querySelectorAll("#lang-switch button")) b.addEventListener("click", () => switchLang(b.dataset.lang));
  $("#ver").textContent = "v" + VERSION;
  $("#mf-date").textContent = MASTERFILE_DATE;
  $("#reviewer").value = localStorage.getItem("satp:reviewer") || "";
  $("#reviewer").addEventListener("change", (e) => localStorage.setItem("satp:reviewer", e.target.value.trim()));
  setLearnedProfiles(kb.profiles);
  renderKb();
  cloud.reviewer = () => $("#reviewer").value.trim();
  initCloud().then(() => { renderCloudBar(); if (cloud.ready) pullCloud(); });
  pdfjs = await import(PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  setupDrop();
  renderCriteria();
  renderHistory();
  $("#run").addEventListener("click", runCheck);

  $("#clear").addEventListener("click", () => { files = []; renderFileList(); });
  $("#toggle-criteria").addEventListener("click", () => { $("#criteria").hidden = !$("#criteria").hidden; });
  $("#export").addEventListener("click", exportExcel);
  $("#harvest").addEventListener("click", harvestAllAsSamples);
  $("#clear-history").addEventListener("click", () => { if (confirm(L("ล้างประวัติการตรวจทั้งหมดในเบราว์เซอร์นี้?", "Clear all check history in this browser?"))) { localStorage.removeItem("satp:history"); renderHistory(); } });
  $("#clear-reviews").addEventListener("click", () => { if (!confirm(L("ล้างผล Accept/Reject ของทุกไซต์ในเบราว์เซอร์นี้? (รูปอ้างอิงในฐานความรู้ยังอยู่)", "Clear Accept/Reject verdicts for all sites in this browser? (reference photos in the knowledge base stay)"))) return; for (const k of Object.keys(localStorage)) if (k.startsWith("satp:review:")) localStorage.removeItem(k); for (const k of Object.keys(reviews)) delete reviews[k]; if (run) { for (const r of run.results) reviews[r.site.key] = { items: [] }; renderResults(); } });
  $("#clear-all").addEventListener("click", async () => {
    if (!confirm(L("ล้างข้อมูลทั้งหมดในเบราว์เซอร์นี้: ประวัติ, ผลตรวจรูป, สำเนาฐานความรู้ในเครื่อง, เกณฑ์ที่แก้ไว้, ชื่อผู้ตรวจ? (ฐานความรู้บนคลาวด์ของทีมไม่ถูกลบ และจะซิงก์กลับมาเมื่อเปิดหน้าใหม่)", "Clear everything in this browser: history, photo verdicts, local copy of the knowledge base, edited thresholds, reviewer name? (the team cloud is not deleted and syncs back on next load)"))) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith("satp:")) localStorage.removeItem(k);
    await new Promise((res) => { const req = indexedDB.deleteDatabase("satp-kb"); req.onsuccess = req.onerror = req.onblocked = () => res(); });
    location.reload();
  });
}

// ---------- ฐานความรู้ร่วมของทีม (Supabase) ----------
function renderCloudBar() {
  const box = $("#cloud"); if (!box) return;
  if (!cloud.enabled) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(el("span", {}, L("☁ ฐานความรู้ทีม: ", "☁ Team knowledge base: "), el("strong", {}, cloud.ready ? L("เชื่อมต่อแล้ว", "connected") : L("เชื่อมต่อไม่ได้ — ใช้ข้อมูลในเครื่องนี้", "offline — using local data"))), " ",
    cloud.ready ? el("button", { class: "btn small", onclick: () => pullCloud() }, L("ซิงก์", "Sync")) : null, " ",
    el("span", { class: "hint", id: "cloud-status" }));
}
async function pullCloud() {
  const st = $("#cloud-status"); const say = (t) => { if (st) st.textContent = t; };
  try {
    say(L("กำลังซิงก์…", "Syncing…"));
    const n = await syncFromCloud(say);
    setLearnedProfiles(kb.profiles); renderKb();
    if (n) say(L(`ซิงก์แล้ว ${new Date().toLocaleTimeString("th-TH")} · ประเด็น ${n.decisions} · รูปอ้างอิงใหม่ ${n.refImages}${n.removed ? ` · ถอดออก ${n.removed}` : ""}`, `Synced ${new Date().toLocaleTimeString("en-GB")} · decisions ${n.decisions} · new references ${n.refImages}${n.removed ? ` · removed ${n.removed}` : ""}`));
  } catch (e) { say(L("ซิงก์ไม่ได้: ", "Sync failed: ") + (e.message || e)); console.warn(e); }
}

// ---------- 1. โหลดไฟล์ ----------
function setupDrop() {
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", async (e) => {
    const items = [...(e.dataTransfer.items || [])];
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) { for (const en of entries) await walkEntry(en, ""); }
    else for (const f of e.dataTransfer.files) await addFile(f, f.name);
    renderFileList();
  });
  $("#file-pick").addEventListener("change", async (e) => { for (const f of e.target.files) await addFile(f, f.name); e.target.value = ""; renderFileList(); });
  $("#dir-pick").addEventListener("change", async (e) => { for (const f of e.target.files) await addFile(f, f.webkitRelativePath || f.name); e.target.value = ""; renderFileList(); });
}

function walkEntry(entry, prefix) {
  return new Promise((resolve) => {
    if (entry.isFile) entry.file(async (f) => { await addFile(f, prefix + f.name); resolve(); });
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const readMore = () => reader.readEntries(async (batch) => {
        if (!batch.length) { for (const en of all) await walkEntry(en, prefix + entry.name + "/"); resolve(); }
        else { all.push(...batch); readMore(); }
      });
      readMore();
    } else resolve();
  });
}

async function addFile(f, path) {
  if (/\.zip$/i.test(f.name)) {
    const zip = await JSZip.loadAsync(await f.arrayBuffer());
    for (const [p, entry] of Object.entries(zip.files)) {
      if (entry.dir || !/\.pdf$/i.test(p) || /__MACOSX|^\./.test(p)) continue;
      files.push({ name: p.split("/").pop(), path: f.name.replace(/\.zip$/i, "") + "/" + p, bytes: new Uint8Array(await entry.async("arraybuffer")) });
    }
    return;
  }
  if (!/\.pdf$/i.test(f.name)) return;
  files.push({ name: f.name, path, bytes: new Uint8Array(await f.arrayBuffer()) });
}

function renderFileList() {
  const box = $("#file-list");
  box.replaceChildren(...files.map((f) => el("div", {}, `${f.path}  (${(f.bytes.length / 1048576).toFixed(1)} MB)`)));
  $("#run").disabled = !files.length;
  $("#progress").textContent = files.length ? L(`${files.length} ไฟล์`, `${files.length} files`) : "";
}

// ---------- เกณฑ์ ----------
function loadCriteria() {
  const c = JSON.parse(JSON.stringify(DEFAULT_CRITERIA));
  try { const saved = JSON.parse(localStorage.getItem("satp:criteria") || "{}"); for (const k of Object.keys(saved)) if (c[k]) Object.assign(c[k], saved[k]); } catch {}
  return c;
}
const CRIT_LABELS = () => ({
  dc48: [L("แรงดัน -48 VDC (ค่าสัมบูรณ์)", "-48 VDC voltage (absolute)"), ["min", "max"], "V"], hvdc: [L("แรงดัน HVDC ~240 V", "HVDC voltage ~240 V"), ["min", "max"], "V"], ac: [L("แรงดัน AC (PSI-M)", "AC voltage (PSI-M)"), ["min", "max"], "V"],
  groundMax: [L("ค่ากราวด์สูงสุด", "Max ground resistance"), ["value"], "Ω"], groundAllowNonNumeric: [L("ยอมรับกราวด์ N/A หรือ OL", "Accept ground N/A or OL"), ["value"], "bool"],
  imageSim: [L("รูปผ่านอัตโนมัติ: ความคล้ายขั้นต่ำ (ระบบปรับสูงขึ้นตามหัวข้อจากไซต์ตัวอย่าง)", "Photo auto-pass: minimum similarity (raised per topic from sample sites)"), ["value", "margin"], "0–1"],
  lossPerKmWarn: [L("Loss/km เตือนเมื่อเกิน (span ยาว)", "Loss/km warning above (long span)"), ["value", "minDistanceKm"], "dB/km, km"], shortSpanTotalLossWarn: [L("Total loss เตือนเมื่อเกิน (span สั้น)", "Total loss warning above (short span)"), ["value"], "dB"],
  lossTolerance: [L("ความคลาดเคลื่อน Total Loss vs TX−RX", "Tolerance Total Loss vs TX−RX"), ["value"], "dB"], shortSpanKm: [L("span สั้น = น้อยกว่า", "Short span = below"), ["value"], "km"], calibrationCheck: [L("ตรวจวันหมดอายุ calibration", "Check calibration expiry"), ["value"], "bool"],
});
function renderCriteria() {
  const t = el("table", {});
  t.append(el("tr", {}, el("th", {}, L("เกณฑ์", "Threshold")), el("th", {}, L("ค่า", "Value")), el("th", {}, L("หน่วย", "Unit")), el("th", {}, L("ที่มา", "Source"))));
  for (const [k, [label, fields, unit]] of Object.entries(CRIT_LABELS())) {
    const inputs = fields.map((f) => {
      const v = criteria[k][f];
      const inp = unit === "bool" ? el("input", { type: "checkbox" }) : el("input", { type: "number", step: "any", value: v ?? "" });
      if (unit === "bool") inp.checked = !!v;
      inp.addEventListener("change", () => { criteria[k][f] = unit === "bool" ? inp.checked : inp.value === "" ? null : +inp.value; saveCriteria(); });
      return [f === "max" ? " – " : f === "minDistanceKm" ? L(" เมื่อระยะ ≥ ", " when distance ≥ ") : f === "margin" ? L(" และไม่คล้าย section อื่นเกินกว่า +", " and not closer to another section by more than +") : "", inp];
    });
    t.append(el("tr", {}, el("td", {}, label), el("td", {}, ...inputs), el("td", {}, unit === "bool" ? "" : unit), el("td", { class: "hint" }, criteria[k].source)));
  }
  const reset = el("button", { class: "btn small", onclick: () => { localStorage.removeItem("satp:criteria"); criteria = loadCriteria(); renderCriteria(); } }, L("คืนค่าเริ่มต้น", "Reset to defaults"));
  $("#criteria").replaceChildren(el("p", { class: "hint" }, L("ค่าเริ่มต้นมาจาก template และสถิติเอกสารตัวอย่าง 46 ไซต์ — แก้แล้วเก็บในเบราว์เซอร์นี้ ค่าว่าง = ไม่ตัดสิน รายงานค่าอย่างเดียว", "Defaults come from the template and statistics of 46 sample sites — edits are kept in this browser; blank = report only, no judgement")), t, reset);
}
function saveCriteria() { localStorage.setItem("satp:criteria", JSON.stringify(criteria)); }

// ---------- 2. ตรวจ ----------
async function runCheck() {
  $("#run").disabled = true;
  const prog = $("#progress");
  try {
    const { results, errors } = await analyzeFiles(pdfjs, files, {
      criteria, wantImages: false,
      onProgress: (p) => { prog.textContent = L(`กำลังอ่าน ${p.done + 1}/${p.total}: ${p.file}`, `Reading ${p.done + 1}/${p.total}: ${p.file}`); },
    });
    run = { results, errors, when: new Date().toLocaleString("th-TH") };
    for (const k of Object.keys(reviewCache)) delete reviewCache[k];
    for (const r of results) { applyDecisions(r); r.summary = summarize(r.issues); reviews[r.site.key] = loadReview(r); }
    prog.textContent = L(`เสร็จ ${results.length} ไซต์ ${errors.length ? `(อ่านไม่ได้ ${errors.length} ไฟล์)` : ""}`, `Done ${results.length} sites ${errors.length ? `(${errors.length} files unreadable)` : ""}`);
    renderResults();
    saveHistory();
    await harvestSignedSites(results, prog);
    if (!window.satpTest?.skipBackground) await reviewAllInBackground(results, prog); // ทดสอบ: ข้ามงานพื้นหลังได้
  } catch (e) {
    prog.textContent = L("ผิดพลาด: ", "Error: ") + e.message;
    console.error(e);
  } finally { $("#run").disabled = false; }
}

function pill(status) {
  const cls = /^ผ่าน(?! \(ยังไม่ตรวจ)/.test(status) ? "ok" : status.startsWith("ไม่ผ่าน") ? "fail" : "warn";
  return el("span", { class: "pill " + cls }, statusText(status));
}

// สถานะรวม = ข้อความ (กฎ R01–R26) + รูป (ตัดสินอัตโนมัติ/ROM) — ผ่านต่อเมื่อทั้งสองส่วนผ่าน
// สรุปแยก 3 ส่วนสำหรับป้ายแท็บและบรรทัดสถานะ
function partSummary(r) {
  const real = r.issues.filter((i) => i.severity !== "info");
  const textIssues = real.filter((i) => !i.ocr), ocrIssues = real.filter((i) => i.ocr);
  const rv = reviews[r.site.key], st = reviewStats(rv);
  const auto = (rv?.items || []).filter((x) => x.autoAccepted).length;
  return {
    text: textIssues.some((i) => i.severity === "fail") ? L(`ไม่ผ่าน ${textIssues.filter((i) => i.severity === "fail").length}`, `Fail ${textIssues.filter((i) => i.severity === "fail").length}`) : textIssues.length ? L(`เตือน ${textIssues.length}`, `Warnings ${textIssues.length}`) : L("ผ่าน", "Pass"),
    textN: textIssues.length,
    ocr: r.ocrError ? L("ผิดพลาด", "error") : !r.ocrDone ? L("ยังไม่ตรวจ", "pending") : ocrIssues.length ? L(`ข้อสังเกต ${ocrIssues.length}`, `Remarks ${ocrIssues.length}`) : L("ผ่าน", "Pass"),
    ocrN: r.ocrDone ? ocrIssues.length : null,
    photo: !rv?.reviewed ? L("ยังไม่ตรวจ", "pending") : st.reject ? `Reject ${st.reject}` : st.pending ? L(`รอ ROM ${st.pending}`, `awaiting ROM ${st.pending}`) : L(`ผ่าน (อัตโนมัติ ${auto}${st.accept - auto ? ", ROM " + (st.accept - auto) : ""})`, `Pass (auto ${auto}${st.accept - auto ? ", ROM " + (st.accept - auto) : ""})`),
    st,
  };
}
function combineStatus(r) {
  const s = r.summary;
  if (s.textStatus == null) s.textStatus = s.status;
  const t = s.textStatus;
  if (r.facts.customerAccepted || !r.site.att) { s.status = t; return t; }
  const rv = reviews[r.site.key];
  if (!r.ocrDone) s.status = t === "ไม่ผ่าน" ? t : t + " (ยังไม่ตรวจ OCR/รูป)";
  else if (!rv?.reviewed) s.status = t === "ไม่ผ่าน" ? t : t + " (ยังไม่ตรวจรูป)";
  else {
    const st = reviewStats(rv);
    s.status = t === "ไม่ผ่าน" ? (st.reject || st.pending ? `ไม่ผ่าน (รูป ${st.reject ? "Reject " + st.reject : ""}${st.pending ? " รอ ROM " + st.pending : ""})`.replace(/\s+\)/, ")") : t)
      : st.reject ? `ไม่ผ่าน (รูป Reject ${st.reject})` : st.pending ? `รอ ROM ตรวจรูป ${st.pending}` : t;
  }
  return s.status;
}

function renderResults() {
  $("#sec-results").hidden = false;
  $("#run-meta").textContent = L(`ตรวจเมื่อ ${run.when} · ${run.results.length} ไซต์`, `Checked at ${run.when} · ${run.results.length} sites`);
  const t = $("#summary");
  t.replaceChildren(el("tr", {}, ...[L("ไซต์", "Site"), L("โฟลเดอร์", "Folder"), "Project / Link", "DWDM Model", L("ชนิดโหนด", "Node type"), L("รหัส", "Code"), L("โปรไฟล์", "Profile"), L("ทิศ", "Deg."), L("ไฟ", "Power"), L("สถานะ", "Status"), L("ไม่ผ่าน", "Fail"), L("เตือน", "Warn"), L("รูป (Accept/Reject/รอ)", "Photos (Accept/Reject/pending)")].map((h) => el("th", {}, h))));
  for (const r of run.results) {
    const rv = reviewStats(reviews[r.site.key]);
    const tr = el("tr", { class: "clickable", onclick: () => showDetail(r) },
      el("td", {}, r.facts.code), el("td", {}, r.site.folder), el("td", {}, r.site.satp?.header.project || ""), el("td", {}, r.site.satp?.header.model || ""), el("td", {}, r.facts.nodeKind || "?"), el("td", {}, `${r.facts.nodeType || "?"}_${r.facts.suffix || ""}`),
      el("td", {}, r.facts.profile || el("span", { class: "pill info" }, L("ไม่มี → ROM ตรวจเอง", "none → ROM reviews"))),
      el("td", {}, r.facts.degrees ?? "-"), el("td", {}, r.facts.power), statusCell(r),
      el("td", {}, r.summary.fail), el("td", {}, r.summary.warn), el("td", { id: "rv-" + cssId(r.site.key) }, r.facts.customerAccepted ? "–" : `${rv.accept} / ${rv.reject} / ${rv.pending}`));
    t.append(tr);
  }
  for (const e of run.errors) t.append(el("tr", {}, el("td", { colspan: 13, class: "pill fail" }, L(`อ่านไฟล์ไม่ได้: ${e.name} — ${e.error}`, `Cannot read file: ${e.name} — ${e.error}`))));
  $("#details").replaceChildren();
}
const cssId = (s) => s.replace(/[^a-zA-Z0-9]/g, "_");

function tabLabel(r, which) {
  const p = partSummary(r);
  if (which === "issues") return L(`ประเด็น (${p.textN + (p.ocrN || 0)})`, `Issues (${p.textN + (p.ocrN || 0)})`);
  if (which === "review") return L(`ตรวจรูป: ${p.photo}`, `Photos: ${p.photo}`);
  return `OCR screenshot: ${p.ocr}`;
}
// อัปเดตหัวข้อ/ป้ายแท็บ/บรรทัดสถานะของไซต์ที่กำลังแสดง เมื่อผล OCR หรือรูปในพื้นหลังเปลี่ยน
function refreshDetailHeader(r) {
  const box = $("#details"); if (!box || box.dataset.site !== r.site.key) return;
  const h3 = box.querySelector("h3"); if (h3) h3.replaceChildren(`${r.facts.code} — ${r.site.folder}`, " ", pill(r.summary.status), " ", breakdownLine(r));
  for (const b of box.querySelectorAll(".tabs button[data-tab]")) b.textContent = tabLabel(r, b.dataset.tab);
  const line = box.querySelector("#pass-line"); if (line) line.replaceWith(passLine(r));
  // แท็บประเด็นเปิดอยู่ → วาดตารางใหม่ให้เห็นประเด็น OCR ที่เพิ่งเพิ่ม (แท็บอื่นไม่รบกวน)
  const active = box.querySelector(".tabs button.active");
  if (active?.dataset.tab === "issues") { const body = box.querySelector(".detail > div:last-child"); if (body && !body.querySelector(".page-canvas")) body.replaceChildren(issuesTable(r)); }
}
// ช่องสถานะ: ป้ายสถานะรวม + รายละเอียดข้อความ/OCR/รูป
function statusCell(r) {
  combineStatus(r);
  return el("td", { class: "status-cell" }, pill(r.summary.status), breakdownLine(r));
}
function breakdownLine(r) {
  const p = partSummary(r);
  return el("div", { class: "hint breakdown" }, r.facts.customerAccepted ? L("ลูกค้าตรวจรับแล้ว", "Customer accepted") : L(`ข้อความ: ${p.text} · OCR: ${p.ocr} · รูป: ${p.photo}`, `Text: ${p.text} · OCR: ${p.ocr} · Photos: ${p.photo}`));
}
function passLine(r) {
  const p = partSummary(r);
  const ready = !r.facts.customerAccepted && /^ผ่าน/.test(r.summary.status) && !/ยังไม่/.test(r.summary.status);
  return el("p", { id: "pass-line", class: "hint" }, r.facts.customerAccepted ? L("ลูกค้าตรวจรับแล้ว — ไม่ต้องตรวจก่อน submit", "Customer accepted — no pre-submission check needed") : ready ? L("ผ่านครบทั้ง 3 ส่วน — ส่งลูกค้าได้", "All three parts passed — ready to submit") : "");
}
// ชื่อโปรไฟล์ (ไทยในโค้ด) → อังกฤษเมื่อสลับภาษา
const profileNameText = (n) => (i18n.lang === "en" && n ? n.replace(/ต่อทิศ/g, "per degree").replace(/ทิศ/g, "degrees").replace(/ใช้เกณฑ์ (P\d)/g, "uses $1 thresholds").replace(/เรียนรู้จาก ROM/g, "learned from ROM") : n);
function showDetail(r, showInfo = false) {
  const box = $("#details");
  const facts = r.facts;
  const S = r.site.satp;
  const head = el("div", { class: "facts" },
    `${S?.header.station || ""} · Model ${S?.header.model || "-"} · SW ${S?.software?.release || "-"} · ${L("ติดตั้ง", "Installed")} ${S?.header.installStart || "-"} – ${S?.header.installEnd || "-"} · Acceptance ${S?.header.acceptanceDate || L("ไม่มี", "none")} · `,
    facts.profile ? L(`โปรไฟล์ ${facts.profile}: ${facts.profileName}`, `Profile ${facts.profile}: ${profileNameText(facts.profileName)}`) : L(`ไม่ตรงโปรไฟล์ (ใกล้ ${facts.nearestProfile}: ${(facts.profileMismatches || []).join("; ")})`, `No matching profile (nearest ${facts.nearestProfile}: ${(facts.profileMismatches || []).join("; ")})`),
    facts.siteRef ? L(` · รายชื่อไซต์: ${facts.siteRef.neName} ${facts.siteRef.shelfType}`, ` · Site list: ${facts.siteRef.neName} ${facts.siteRef.shelfType}`) : L(" · ไม่อยู่ในรายชื่อ 56 ไซต์", " · not in the 56-site list"));
  if (!facts.profile) head.append(" ", el("button", { class: "btn small", onclick: () => {
    if (!confirm(L(`ยืนยันว่าเอกสารไซต์ ${facts.code} ถูกต้องและใช้เป็นตัวอย่างอ้างอิงสำหรับ config แบบนี้ได้?\n(${facts.nodeType}, ${JSON.stringify(facts.shelves)}, ${facts.power}, ${facts.degrees} ทิศ)`, `Confirm that site ${facts.code} documents are correct and can serve as the reference for this configuration?\n(${facts.nodeType}, ${JSON.stringify(facts.shelves)}, ${facts.power}, ${facts.degrees} degrees)`))) return;
    const p = learnProfile(r, $("#reviewer").value.trim()); setLearnedProfiles(kb.profiles);
    facts.profile = p.id; facts.profileName = p.name; facts.profileMismatches = [];
    alert(L(`บันทึกเป็นโปรไฟล์ ${p.id} (ตัวอย่าง ${p.samples} ไซต์) — ไซต์ต่อไปที่ config เดียวกันจะเทียบกับโปรไฟล์นี้`, `Saved as profile ${p.id} (${p.samples} sample sites) — future sites with this configuration will be compared against it`));
    renderKb(); showDetail(r);
  } }, L("ROM ยืนยัน: ใช้ไซต์นี้เป็นอ้างอิง", "ROM confirms: use this site as reference")));
  const tabs = el("div", { class: "tabs" });
  const body = el("div", {});
  const tabIssues = el("button", { class: "active", "data-tab": "issues", onclick: () => { activate(tabIssues); body.replaceChildren(issuesTable(r)); } }, tabLabel(r, "issues"));
  const tabReview = el("button", { onclick: async () => {
    activate(tabReview);
    const st = el("p", { class: "hint" }, L("กำลังดึงรูปจาก Attachment…", "Extracting photos from the Attachment…")); body.replaceChildren(st);
    body.replaceChildren(await reviewPanel(r, (t) => { st.textContent = t; }));
  } }, tabLabel(r, "review"));
  tabReview.dataset.tab = "review";
  const tabOcr = el("button", { "data-tab": "ocr", onclick: () => { activate(tabOcr); const wrap = el("div", {}); body.replaceChildren(wrap); ocrPanel(r, wrap); } }, tabLabel(r, "ocr"));
  const activate = (b) => { for (const x of tabs.children) x.classList.toggle("active", x === b); };
  if (r.facts.customerAccepted) tabs.append(tabIssues, el("span", { class: "hint" }, L("ลูกค้าตรวจรับแล้ว — ไม่ต้องตรวจรูป / OCR", "Customer accepted — no photo / OCR check")));
  else tabs.append(tabIssues, tabReview, tabOcr);
  box.dataset.site = r.site.key;
  box.replaceChildren(el("div", { class: "detail" }, el("h3", {}, `${facts.code} — ${r.site.folder}`, " ", pill(combineStatus(r)), " ", breakdownLine(r)), head, tabs, body));
  body.append(issuesTable(r, showInfo));
  if (!showInfo) box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function issuesTable(r, showInfo = false) {
  const wrap = el("div", {});
  const real = r.issues.filter((i) => i.severity !== "info");
  const infos = r.issues.filter((i) => i.severity === "info");
  // ผ่าน = ไม่แสดงอะไร นอกจากข้อความผ่าน; ข้อมูลอ้างอิง (โปรไฟล์, หมายเหตุ) ดูได้เมื่อกดขยาย
  combineStatus(r);
  wrap.append(passLine(r));
  if (infos.length) wrap.append(el("button", { class: "btn small", onclick: () => wrap.replaceWith(issuesTable(r, !showInfo)) }, showInfo ? L("ซ่อนข้อมูลอ้างอิง", "Hide reference info") : L(`แสดงข้อมูลอ้างอิง (${infos.length})`, `Show reference info (${infos.length})`)));
  const rows = showInfo ? r.issues : real;
  if (!rows.length) return wrap;
  const t = el("table", { class: "tbl issues" }, el("tr", {}, ...[L("ระดับ", "Level"), L("ผล", "Result"), L("กฎ", "Rule"), "Section", L("หน้า", "Page"), L("ประเด็น", "Issue"), L("ใครตรวจต่อ", "Next reviewer"), L("การตัดสินใจ ROM", "ROM decision")].map((h) => el("th", {}, h))));
  wrap.append(t);
  const viewer = el("div", { class: "page-viewer" }); wrap.append(viewer);
  const refresh = () => { applyDecisions(r); r.summary = summarize(r.issues); renderSummaryRow(r); showDetail(r, showInfo); };
  for (const i of rows) {
    // เตือน → ROM ตัดสินและระบบเรียนรู้ใช้กับทุกไซต์ · ไม่ผ่าน → ROM ยอมรับได้เฉพาะไซต์นี้ (ไม่เรียนรู้)
    const isFail = i.severity === "fail" && !r.facts.customerAccepted, isWarn = i.severity === "warn" && !r.facts.customerAccepted;
    let cell;
    if (i.learned) {
      const siteOnly = i.learned.scope === "site";
      cell = el("td", {}, el("span", { class: "pill " + (i.learned.decision === "accept" ? "ok" : "warn") }, i.learned.decision === "accept" ? (siteOnly ? L("ยอมรับแล้ว (เฉพาะไซต์นี้)", "Accepted (this site only)") : L("ยอมรับแล้ว", "Accepted")) : L("ยืนยันปัญหา", "Confirmed issue")), ` ${i.learned.by || ""} ${i.learned.at}`, i.learned.reason ? ` — ${i.learned.reason}` : "", " ", el("button", { class: "btn small", onclick: () => { forgetDecision(i, r.facts, i.learned.scope || "all"); refresh(); renderKb(); } }, L("ยกเลิก", "Undo")));
    } else if (isWarn) {
      const reason = el("input", { type: "text", placeholder: L("เหตุผล (ถ้ามี)", "reason (optional)"), size: "14" });
      const go = (d) => { recordDecision(i, r.facts, d, reason.value.trim(), $("#reviewer").value.trim()); refresh(); renderKb(); };
      cell = el("td", {}, el("button", { class: "btn small", onclick: () => go("accept") }, L("ยอมรับ", "Accept")), " ", el("button", { class: "btn small", onclick: () => go("confirm") }, L("ยืนยันปัญหา", "Confirm issue")), " ", reason);
    } else if (isFail) {
      const reason = el("input", { type: "text", placeholder: L("เหตุผลที่ยอมรับ", "reason for accepting"), size: "14" });
      cell = el("td", {}, el("button", { class: "btn small", title: L("ROM ตรวจสอบแล้วว่ายอมรับได้ — มีผลเฉพาะไซต์นี้ ระบบไม่นำไปใช้กับไซต์อื่น", "ROM checked and accepts — this site only, not learned for other sites"), onclick: () => { if (!reason.value.trim()) { alert(L("ระบุเหตุผลที่ยอมรับก่อน", "Enter the reason for accepting first")); return; } recordDecision(i, r.facts, "accept", reason.value.trim(), $("#reviewer").value.trim(), "site"); refresh(); renderKb(); } }, L("ยอมรับ (ไซต์นี้)", "Accept (this site)")), " ", reason, el("div", { class: "hint" }, L("ระบบยืนยันได้เอง", "verified by the system")));
    } else cell = el("td", { class: "hint" }, "");
    const pageCell = i.page ? el("td", {}, el("button", { class: "btn small", title: L("แสดงหน้าเอกสารและไฮไลต์จุดที่พบ", "Show the document page with the finding highlighted"), onclick: () => showIssuePage(r, i, viewer) }, L(`หน้า ${i.page}`, `Page ${i.page}`))) : el("td", {}, "");
    t.append(el("tr", {}, el("td", {}, levelText(i.level)), el("td", {}, el("span", { class: "pill " + (i.severity === "fail" ? "fail" : i.severity) }, sevText(i.severity)), i.origSeverity ? el("div", { class: "hint" }, L(`(เดิม ${sevText(i.origSeverity)})`, `(was ${sevText(i.origSeverity)})`)) : null), el("td", {}, i.rule), el("td", {}, sectionText(i.section)), pageCell, el("td", { class: "msg" }, msgOf(i)), el("td", {}, whoText(i.who)), cell));
  }
  return wrap;
}

// ---------- แสดงหน้าเอกสาร + ไฮไลต์จุดที่พบ ----------
const docCache = {}; // fileName -> pdfjs document
async function openDoc(fileName) {
  if (docCache[fileName]) return docCache[fileName];
  const f = files.find((x) => x.name === fileName);
  if (!f) return null;
  return (docCache[fileName] = await pdfjs.getDocument({ data: f.bytes.slice(), verbosity: 0 }).promise);
}
// คำที่จะไฮไลต์จากข้อความประเด็น: ข้อความใน '…' ก่อน ไม่มีก็ใช้ IP / slot / ตัวเลข
function highlightTerms(msg) {
  const quoted = [...msg.matchAll(/'([^']{2,})'/g)].map((m) => m[1]);
  if (quoted.length) return quoted;
  return [...new Set([...msg.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b|SH\d+\/SL\d+|-?\d+(?:[.,]\d+)+|\b\d{2,}\b/g)].map((m) => m[0]))];
}
async function showIssuePage(r, issue, viewer) {
  const isAtt = /^ATT|^Attachment/.test(issue.section);
  const fileName = isAtt ? r.site.attFile : r.site.satpFile;
  viewer.replaceChildren(el("p", { class: "hint" }, L(`กำลังเปิด ${fileName} หน้า ${issue.page}…`, `Opening ${fileName} page ${issue.page}…`)));
  viewer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const doc = await openDoc(fileName);
  if (!doc) { viewer.replaceChildren(el("p", { class: "hint" }, L("ไม่พบไฟล์ในรายการที่โหลด", "File not found among the loaded files"))); return; }
  let pageNo = issue.page;
  const render = async () => {
    const scale = 1.4;
    const canvas = await renderPage(pdfjs, doc, pageNo, scale);
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale });
    const terms = pageNo === issue.page ? highlightTerms(issue.msg).map((t) => t.toLowerCase()) : [];
    let hits = 0;
    if (terms.length) {
      const tc = await page.getTextContent();
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgba(255, 210, 0, 0.45)"; ctx.strokeStyle = "#d00"; ctx.lineWidth = 2;
      for (const it of tc.items) {
        const str = (it.str || "").toLowerCase();
        if (!str.trim() || !terms.some((t) => str.includes(t))) continue;
        const [a, b, c, d, e, f] = pdfjs.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(c, d), w = it.width * scale;
        ctx.fillRect(e - 2, f - h - 2, w + 4, h + 4); ctx.strokeRect(e - 2, f - h - 2, w + 4, h + 4);
        hits++;
      }
    }
    page.cleanup();
    const nav = el("div", { class: "row" },
      el("strong", {}, `${isAtt ? "Attachment" : "SATP"} ${L("หน้า", "page")} ${pageNo}/${doc.numPages}`), " ",
      el("button", { class: "btn small", onclick: () => { if (pageNo > 1) { pageNo--; render(); } } }, "◀"), " ",
      el("button", { class: "btn small", onclick: () => { if (pageNo < doc.numPages) { pageNo++; render(); } } }, "▶"), " ",
      el("span", { class: "hint" }, pageNo === issue.page ? (hits ? L(`ไฮไลต์ ${hits} จุด: ${highlightTerms(issue.msg).join(", ")}`, `${hits} highlight(s): ${highlightTerms(issue.msg).join(", ")}`) : L("ไม่พบข้อความที่ตรงในหน้านี้ (อาจอยู่ในรูป/ตาราง) — ดูตาม section ", "No matching text on this page (may be inside an image/table) — see section ") + sectionText(issue.section)) : ""), " ",
      el("button", { class: "btn small", onclick: () => viewer.replaceChildren() }, L("ปิด", "Close")));
    canvas.className = "page-canvas";
    viewer.replaceChildren(nav, canvas);
  };
  await render();
}

// ---------- 10/11. ตรวจรูป ----------
const REVIEW_SECTIONS = [["1.8", "1.8 Visual Inspection"], ["1.4", "1.4 Inventory"], ["1.5", "1.5 Power"], ["1.6", "1.6 Ground"], ["1.9", "1.9 NE Setup"], ["1.15", "1.15 Fiber Scope"]];

function reviewKey(r) { return `satp:review:${r.site.key}:${r.site.attFile}`; }
function loadReview(r) { try { return JSON.parse(localStorage.getItem(reviewKey(r)) || "null") || { items: [] }; } catch { return { items: [] }; } }
function saveReview(r) { localStorage.setItem(reviewKey(r), JSON.stringify(reviews[r.site.key])); const c = $("#rv-" + cssId(r.site.key)); if (c) { const s = reviewStats(reviews[r.site.key]); c.textContent = `${s.accept} / ${s.reject} / ${s.pending}`; } renderSummaryRow(r); }

// ตรวจรูปอัตโนมัติต่อจากการตรวจข้อความ ทีละไซต์ในพื้นหลัง — แท็บตรวจรูปที่เปิดระหว่างนั้นจะรอผลชุดเดียวกัน
const reviewJobs = {}; // siteKey -> Promise
const reviewCache = {}; // siteKey -> ผลตัดสินรูปล่าสุด (รูป + การจัดกลุ่ม) เปิดแท็บซ้ำแสดงทันทีโดยไม่คำนวณใหม่
function reviewSite(r, status = () => {}) {
  const c = reviewCache[r.site.key];
  if (c && !reviewJobs[r.site.key]) {
    // จัดกลุ่มใหม่ตามผลตัดสินปัจจุบัน (ROM อาจกด Accept/Reject ไปแล้ว)
    const need = [], autoOk = [], decided = [];
    for (const e of c.entries) { const it = e.item; if (it.verdict && it.by !== "ระบบ") decided.push(e); else if (it.verdict === "accept" && it.autoAccepted) autoOk.push(e); else need.push(e); }
    return Promise.resolve({ items: c.items, need, autoOk, decided, topicNotes: c.topicNotes, allRefs: c.allRefs, FLOOR: c.FLOOR });
  }
  if (!reviewJobs[r.site.key]) reviewJobs[r.site.key] = decideSiteImages(r, status).finally(() => { delete reviewJobs[r.site.key]; });
  return reviewJobs[r.site.key];
}
async function reviewAllInBackground(results, prog) {
  const todo = results.filter((r) => r.site.att && !r.facts.customerAccepted);
  let i = 0;
  for (const r of todo) {
    i++;
    const c = $("#rv-" + cssId(r.site.key)); if (c) c.textContent = L("กำลังตรวจ…", "checking…");
    try { await runOcrSite(r, (t) => { prog.textContent = `OCR ${i}/${todo.length} ${r.facts.code}: ${t}`; }); }
    catch (e) { console.warn("ocr", r.facts.code, e); r.ocrDone = true; r.ocrError = e.message || String(e); }
    try { await reviewSite(r, (t) => { prog.textContent = L(`ตรวจรูป ${i}/${todo.length} ${r.facts.code}: ${t}`, `Photos ${i}/${todo.length} ${r.facts.code}: ${t}`); }); }
    catch (e) { console.warn("review", r.facts.code, e); }
    renderSummaryRow(r);
  }
  prog.textContent = L(`เสร็จ ${results.length} ไซต์ · OCR และตรวจรูปแล้ว ${todo.length} ไซต์`, `Done ${results.length} sites · OCR and photos checked for ${todo.length} sites`);
}

const hashCache = {}; // `${site}|${page}|${idx}` -> hash

// หัวข้อย่อยของรูปจากข้อความบนหน้า เช่น "(a) Rack Installation" — ใช้จัดกลุ่มรูปอ้างอิงให้ละเอียดกว่าระดับ section
function topicFromText(pageText) {
  const m = /\(([a-g])\)\s*([^*:·(]{2,70})/.exec(pageText || "");
  return m ? `(${m[1]}) ${m[2].trim().replace(/\s+\S{0,3}$/, "")}` : "";
}

// ดึงรูปทุก section ที่ต้องตรวจจาก Attachment ของไซต์ → [{section, label, page, idx, im, pageText, topic, hash}]
async function collectSiteImages(r, onProgress = () => {}) {
  const A = r.site.att;
  if (!A) return { error: L("ไม่มี Attachment Report", "No Attachment Report"), items: [] };
  const f = files.find((x) => x.name === r.site.attFile);
  if (!f) return { error: L("ไม่พบไฟล์ Attachment ในรายการที่โหลด", "Attachment file not found among the loaded files"), items: [] };
  const doc = await pdfjs.getDocument({ data: f.bytes.slice(), verbosity: 0 }).promise;
  const secs = Object.entries(A.sections).sort((a, b) => a[1] - b[1]);
  const rangeOf = (sec) => { const i = secs.findIndex((s) => s[0] === sec); if (i < 0) return null; return [secs[i][1], i + 1 < secs.length ? secs[i + 1][1] - 1 : doc.numPages]; };
  const items = [];
  for (const [sec, label] of REVIEW_SECTIONS) {
    const range = rangeOf(sec);
    if (!range) continue;
    for (let p = range[0]; p <= range[1]; p++) {
      onProgress(L(`${r.facts.code}: อ่านรูปหน้า ${p}`, `${r.facts.code}: reading photos on page ${p}`));
      const page = await doc.getPage(p);
      const imgs = await pageImageCanvases(page);
      const pageText = (r.site.pagesAtt?.[p - 1]?.lines || []).filter((l) => /^\([a-g]\)|^Name:|SHELF|Power [AB]|Rack to|Shelf to/i.test(l)).join(" · ");
      const topic = topicFromText(pageText);
      imgs.forEach((im, idx) => {
        const key = `${r.site.key}|${p}|${idx}`;
        const c = hashCache[key] || (hashCache[key] = { h: aHash(im.canvas), d: pixelDigest(im.canvas), w: im.width, hh: im.height });
        items.push({ section: label, label, page: p, idx, im, pageText, topic, hash: c.h, digest: c.d, key });
      });
      page.cleanup();
    }
  }
  await doc.destroy();
  return { items };
}

// เก็บทุกรูปของไซต์เป็นรูปอ้างอิงของ (โปรไฟล์ × หัวข้อ) และจำจำนวนรูปต่อหัวข้อ
// source "signed" = ลูกค้าเซ็นแล้ว (อัตโนมัติ) · "sample" = ROM กำหนดให้ชุดนี้เป็นตัวอย่าง (ปุ่มในผลตรวจ)
async function harvestSites(list, source, prog) {
  const sites = list.filter((r) => r.site.att);
  if (!sites.length) return { sites: 0, added: 0 };
  const keys = await listRefKeys();
  const by = source === "signed" ? "ลูกค้าเซ็นแล้ว" : `ตัวอย่าง (${$("#reviewer").value.trim() || "ROM"})`;
  let canEmbed = false;
  try { await loadEmbedder((t) => { prog.textContent = t; }); canEmbed = true; } catch (e) { console.warn("embedder", e); }
  let added = 0, i = 0;
  for (const r of sites) {
    i++;
    const profileKey = r.facts.profile || "L:" + r.facts.nearestProfile;
    const { items } = await collectSiteImages(r, (t) => { prog.textContent = L(`เก็บรูปอ้างอิง ${i}/${sites.length} — ${t}`, `Collecting references ${i}/${sites.length} — ${t}`); });
    const counts = {};
    for (const it of items) {
      counts[topicOf(it.section, it.topic)] = (counts[topicOf(it.section, it.topic)] || 0) + 1;
      prog.textContent = L(`เก็บรูปอ้างอิง ${i}/${sites.length} — ${r.facts.code} หน้า ${it.page} (ใหม่ ${added})`, `Collecting references ${i}/${sites.length} — ${r.facts.code} page ${it.page} (new ${added})`);
      const th = thumb(it.im.canvas, 320);
      const emb = canEmbed ? encodeEmb(await embedImage(th)) : "";
      const rec = await addRefImage({ profile: profileKey, section: it.section, topic: it.topic, site: r.facts.code, page: it.page, thumb: th, hash: it.hash, digest: it.digest, by, source, emb }, keys);
      if (rec) added++;
    }
    const seenTopics = new Set();
    for (const it of items) { const k = topicOf(it.section, it.topic); if (seenTopics.has(k)) continue; seenTopics.add(k); recordSectionCount(profileKey, it.section, it.topic, r.facts.code, counts[k]); }
  }
  renderKb();
  return { sites: sites.length, added };
}
async function harvestSignedSites(results, prog) {
  const signed = results.filter((r) => r.facts.customerAccepted);
  if (!signed.length) return;
  const n = await harvestSites(signed, "signed", prog);
  prog.textContent = L(`เสร็จ ${results.length} ไซต์ · เก็บรูปอ้างอิงจากไซต์ที่ลูกค้าเซ็นแล้ว ${n.sites} ไซต์ (รูปใหม่ ${n.added})`, `Done ${results.length} sites · references collected from ${n.sites} customer-signed sites (${n.added} new photos)`);
}
async function harvestAllAsSamples() {
  if (!run) return;
  if (!confirm(L(`ใช้รูปของทุกไซต์ในชุดนี้ (${run.results.length} ไซต์) เป็นรูปอ้างอิงตัวอย่าง? ระบบจะถือว่ารูปเหล่านี้ถูกต้อง และใช้เทียบกับไซต์ต่อไปในโปรไฟล์เดียวกัน`, `Use the photos of all ${run.results.length} sites in this batch as reference samples? The system will treat them as correct and compare future sites of the same profile against them`))) return;
  const btn = $("#harvest"); btn.disabled = true;
  const n = await harvestSites(run.results, "sample", $("#progress"));
  $("#progress").textContent = L(`เก็บรูปอ้างอิงตัวอย่างจาก ${n.sites} ไซต์ (รูปใหม่ ${n.added})`, `Reference samples collected from ${n.sites} sites (${n.added} new photos)`);
  btn.disabled = false;
}

// ตัดสินรูปทุกรูปของไซต์ (ไม่สร้าง DOM) → { error, items, need, autoOk, decided, topicNotes, allRefs, FLOOR }
async function decideSiteImages(r, status = () => {}) {
  const profileKey = r.facts.profile || "L:" + r.facts.nearestProfile;
  const { error, items } = await collectSiteImages(r, status);
  if (error) return { error };
  const rv = reviews[r.site.key];
  const allRefs = (await refVectorsForProfile(profileKey)).filter((x) => x.site !== r.facts.code);
  const refByTopic = {}; for (const x of allRefs) (refByTopic[topicOf(x.section, x.topic)] ||= []).push(x);
  const rejectVecs = kb.imageDecisions.filter((d) => d.verdict === "reject" && d.emb).map((d) => ({ ...d, vec: decodeEmb(d.emb) }));
  let canEmbed = allRefs.length > 0;
  if (canEmbed) { try { await loadEmbedder(status); } catch (e) { console.warn("embedder", e); canEmbed = false; } }
  const FLOOR = criteria.imageSim?.value ?? 0.7, MARGIN = criteria.imageSim?.margin ?? 0.03;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const TH = topicThresholds(profileKey, allRefs, FLOOR);
  const labelExp = labelExpectations(r);
  const thOf = (tkey) => TH[tkey] ?? Math.max(FLOOR, 0.78);

  // ---------- ตัดสินแต่ละรูป ----------
  const need = [], autoOk = [], decided = [], topicNotes = [];
  const seenTopic = new Set();
  let done = 0;
  for (const it of items) {
    status(L(`กำลังเทียบรูปกับรูปอ้างอิง ${++done}/${items.length}`, `Comparing with references ${++done}/${items.length}`));
    const { im, page: p, idx, hash: h, digest, key } = it;
    const tkey = topicOf(it.section, it.topic);
    const isPhoto = /^1[.]8|^1[.]6/.test(it.section); // รูปถ่าย (ไม่ใช่ screenshot) — ใช้ aHash ใกล้เคียงเป็นสัญญาณเสริมได้
    if (!seenTopic.has(tkey)) {
      seenTopic.add(tkey);
      const n = items.filter((x) => topicOf(x.section, x.topic) === tkey).length;
      const exp = expectedCount(profileKey, it.section, it.topic);
      if (exp && (n < exp.min || n > exp.max)) topicNotes.push(M(`${it.topic || it.label}: มี ${n} รูป แต่ไซต์ตัวอย่างมี ${exp.min === exp.max ? exp.median : `${exp.min}–${exp.max}`} รูป (${exp.sites} ไซต์)`, `${it.topic || it.label}: ${n} photos but sample sites have ${exp.min === exp.max ? exp.median : `${exp.min}–${exp.max}`} (${exp.sites} sites)`));
    }
    let item = rv.items.find((x) => x.page === p && x.idx === idx);
    if (!item) { item = { section: it.label, page: p, idx, verdict: "", reason: "", by: "", at: "", hash: h }; rv.items.push(item); }
    item.hash = h; item.topic = it.topic; item.label = it.topic || it.label;
    const flags = [];
    // รูปซ้ำในชุดที่โหลด: ลายนิ้วมือพิกเซลตรงกัน (ไฟล์เดียวกัน) · รูปถ่ายที่ aHash ต่าง ≤ 2 บิต = น่าจะรูปเดียวกันแต่บันทึกใหม่
    const dupSeen = new Set();
    for (const [k2, v2] of Object.entries(hashCache)) {
      if (k2 === key || k2.split("|").slice(0, 2).join("|") === `${r.site.key}|${p}`) continue;
      const exact = v2.d === digest, near = isPhoto && v2.w === im.width && v2.hh === im.height && hamming(h, v2.h) <= 2;
      if (!exact && !near) continue;
      const whereTh = `${k2.split("|")[0]} หน้า ${k2.split("|")[1]}`, whereEn = `${k2.split("|")[0]} page ${k2.split("|")[1]}`; if (dupSeen.has(whereTh)) continue; dupSeen.add(whereTh);
      flags.push(exact ? M(`รูปเดียวกับ ${whereTh}`, `Same photo as ${whereEn}`) : M(`น่าจะรูปเดียวกับ ${whereTh}`, `Probably the same photo as ${whereEn}`));
    }
    const reused = allRefs.find((x) => isReferenceSource(x.source) && (x.digest ? x.digest === digest : isPhoto && hamming(h, x.hash) <= 2));
    if (reused) flags.push(M(`${reused.digest ? "รูปเดียวกับ" : "น่าจะรูปเดียวกับ"}ไซต์ตัวอย่าง ${reused.site} (หน้า ${reused.page}) — รูปถูกนำมาใช้ซ้ำ`, `${reused.digest ? "Same photo as" : "Probably the same photo as"} sample site ${reused.site} (page ${reused.page}) — photo reused`));
    const blur = blurScore(im.canvas);
    if (blur < 15) flags.push(M(`ภาพอาจเบลอ (คมชัด ${blur.toFixed(0)})`, `Photo may be blurry (sharpness ${blur.toFixed(0)})`));
    const prev = findImageDecision(h);
    if (prev && prev.verdict === "reject") flags.push(M(`รูปนี้เคยถูก Reject ที่ ${prev.site}: ${prev.reason} (${prev.by || ""})`, `This photo was rejected at ${prev.site}: ${prev.reason} (${prev.by || ""})`));
    // อ่านป้ายด้วย OCR (เฉพาะหัวข้อรูปถ่ายที่มีป้าย) เทียบรหัสไซต์/IP/ไซต์ปลายทางตามรูปแบบป้ายของโปรเจกต์
    const labelNotes = [];
    const ltopic = labelTopicOf(it.section, it.topic);
    if (ltopic) {
      try {
        if (!item.ocr || item.ocr.hash !== h) { status(L(`อ่านป้ายในรูป ${done}/${items.length} (OCR)`, `Reading labels ${done}/${items.length} (OCR)`)); const o = await ocrLabels(im.canvas, status); item.ocr = { hash: h, text: o.text.slice(0, 400), conf: Math.round(o.confidence), boxes: o.boxes }; }
        const res = checkLabelText(ltopic, item.ocr.text, labelExp, item.ocr.boxes > 0);
        flags.push(...res.flags); labelNotes.push(...res.notes);
        item.label_ok = res.found.code; item.label_ip = res.found.ip;
        // ป้ายยืนยันรหัสไซต์ (และ IP ตรง ถ้ามี) ในรูป rack/NE ID = หลักฐานตรงกว่าความคล้ายภาพ
        item.label_confirms = res.found.code && !res.flags.length && /\(a\)|\(b\)/.test(ltopic);
      } catch (e) { console.warn("label ocr", e); labelNotes.push(M("OCR ป้ายไม่ทำงาน: " + (e.message || e), "Label OCR failed: " + (e.message || e))); }
    }
    // เทียบกับรูปอ้างอิง
    let similar = [], verdictNote = "", auto = false;
    if (canEmbed) {
      try {
        const vec = await embedImage(thumb(im.canvas, 320));
        item.emb = encodeEmb(vec);
        const same = rank(vec, refByTopic[tkey] || [], 3);
        const otherSec = rank(vec, allRefs.filter((x) => x.section !== it.section), 1); // section อื่น (เช่น screenshot มาอยู่ในหมวดรูปถ่าย)
        const sibling = rank(vec, allRefs.filter((x) => x.section === it.section && topicOf(x.section, x.topic) !== tkey), 1); // หัวข้อย่อยอื่นใน section เดียวกัน (แจ้งอย่างเดียว)
        const rej = rank(vec, rejectVecs, 1);
        similar = same;
        const s1 = same[0]?.sim ?? 0, so = otherSec[0]?.sim ?? 0, th = thOf(tkey);
        item.sim = s1; item.match = same[0]?.ref.id || "";
        if (rej[0] && rej[0].sim >= 0.95) flags.push(M(`คล้ายรูปที่เคยถูก Reject ที่ ${rej[0].ref.site} (${pct(rej[0].sim)}): ${rej[0].ref.reason}`, `Similar to a photo rejected at ${rej[0].ref.site} (${pct(rej[0].sim)}): ${rej[0].ref.reason}`));
        const sibTopic = sibling[0]?.ref.topic || sibling[0]?.ref.section;
        const sibTh = sibling[0] && sibling[0].sim > s1 + MARGIN ? ` (คล้ายหัวข้อ "${sibTopic}" ${pct(sibling[0].sim)} มากกว่า)` : "", sibEn = sibling[0] && sibling[0].sim > s1 + MARGIN ? ` (closer to topic "${sibTopic}" at ${pct(sibling[0].sim)})` : "";
        const other = otherSec[0]?.ref.topic || otherSec[0]?.ref.section, here = it.topic || it.label;
        if (!same.length) verdictNote = M("ยังไม่มีรูปอ้างอิงของหัวข้อนี้ในโปรไฟล์นี้", "No reference photos for this topic in this profile yet");
        else if (flags.length) verdictNote = M(`คล้ายรูปอ้างอิง ${pct(s1)} แต่มีข้อสังเกต`, `Similar to references (${pct(s1)}) but has remarks`);
        else if (s1 >= th && s1 + MARGIN >= so) { auto = true; verdictNote = M(`ผ่านอัตโนมัติ: คล้ายรูปอ้างอิงของ ${same[0].ref.site} ${pct(s1)} (เกณฑ์หัวข้อนี้ ${pct(th)})${sibTh}`, `Auto-pass: similar to reference from ${same[0].ref.site} at ${pct(s1)} (topic threshold ${pct(th)})${sibEn}`); }
        else if (item.label_confirms) { auto = true; verdictNote = M(`ผ่านอัตโนมัติ: ป้ายในรูปยืนยันรหัสไซต์${item.label_ip ? " และ IP" : ""} (คล้ายรูปอ้างอิง ${pct(s1)})`, `Auto-pass: label in the photo confirms the site code${item.label_ip ? " and IP" : ""} (similarity ${pct(s1)})`); }
        else if (so >= th && so > s1 + MARGIN) verdictNote = M(`น่าจะเป็นรูปของ "${other}" (${pct(so)}) ไม่ใช่ "${here}" (${pct(s1)})`, `Looks like a "${other}" photo (${pct(so)}) rather than "${here}" (${pct(s1)})`);
        else verdictNote = M(`คล้ายรูปอ้างอิงเพียง ${pct(s1)} (เกณฑ์หัวข้อนี้ ${pct(th)})${sibTh}`, `Only ${pct(s1)} similar to references (topic threshold ${pct(th)})${sibEn}`);
      } catch (e) { console.warn("embed", e); verdictNote = M("เทียบรูปไม่ได้: " + (e.message || e), "Comparison failed: " + (e.message || e)); }
    } else verdictNote = allRefs.length ? M("โมเดลเปรียบเทียบรูปโหลดไม่ได้ — ตรวจเอง", "Image model failed to load — review manually") : M("ยังไม่มีรูปอ้างอิงของโปรไฟล์นี้", "No reference photos for this profile yet");
    const T = (p, k) => (typeof p === "string" ? p : p[k]);
    item.auto = [verdictNote, ...flags, ...labelNotes.map((n) => M("ป้าย: " + T(n, "th"), "Label: " + T(n, "en")))].map((p) => T(p, "th")).join("; ");
    item.auto_en = [verdictNote, ...flags, ...labelNotes.map((n) => M("ป้าย: " + T(n, "th"), "Label: " + T(n, "en")))].map((p) => T(p, "en")).join("; ");
    if (auto && !item.verdict) { item.verdict = "accept"; item.by = "ระบบ"; item.at = new Date().toLocaleString("th-TH"); item.autoAccepted = true; }
    else if (!auto && item.autoAccepted && item.by === "ระบบ") { item.verdict = ""; item.by = ""; item.at = ""; item.autoAccepted = false; } // เกณฑ์เปลี่ยน → ยกเลิกผลอัตโนมัติเดิม
    const entry = { it, item, similar };
    if (item.verdict && item.by !== "ระบบ") decided.push(entry);
    else if (item.verdict === "accept" && item.autoAccepted) autoOk.push(entry);
    else need.push(entry);
  }
  rv.reviewed = true;
  saveReview(r);
  reviewCache[r.site.key] = { items, entries: [...need, ...autoOk, ...decided], topicNotes, allRefs, FLOOR };
  return { items, need, autoOk, decided, topicNotes, allRefs, FLOOR };
}

async function reviewPanel(r, status = () => {}) {
  const res = await reviewSite(r, status);
  if (res.error) return el("p", {}, res.error);
  const { items, need, autoOk, decided, topicNotes, allRefs, FLOOR } = res;
  const rv = reviews[r.site.key];
  const pct = (x) => `${Math.round(x * 100)}%`;
  const wrap = el("div", {});
  // ---------- แสดงผล ----------
  // รูปอ้างอิงที่คล้ายที่สุด (ดาวน์โหลดรูปย่อตามต้องการ) แสดงเฉพาะรูปที่ต้องให้ ROM ตรวจ
  const grid = (list, withRefs) => { const g = el("div", { class: "review-grid" }); for (const e of list) g.append(reviewCard(r, e.item, e.it.im, e.it.pageText, withRefs ? e.similar : null)); return g; };
  const summary = el("div", { class: "row" },
    el("span", { class: "pill warn" }, L(`ต้องให้ ROM ตรวจ ${need.length}`, `Needs ROM ${need.length}`)), " ",
    el("span", { class: "pill ok" }, L(`ผ่านอัตโนมัติ ${autoOk.length}`, `Auto-pass ${autoOk.length}`)), " ",
    el("span", { class: "pill info" }, L(`ROM ตัดสินแล้ว ${decided.length}`, `Decided by ROM ${decided.length}`)), " ",
    el("button", { class: "btn small", onclick: () => { for (const it of rv.items) if (!it.verdict) setVerdict(r, it, "accept"); wrap.querySelectorAll(".review-item").forEach((c) => c.dispatchEvent(new Event("refresh"))); } }, L("Accept ที่เหลือทั้งหมด", "Accept all remaining")), " ",
    el("button", { class: "btn small", title: L("คำนวณใหม่ เช่น หลังแก้เกณฑ์หรือมีรูปอ้างอิงเพิ่ม", "Recompute, e.g. after changing thresholds or adding references"), onclick: async () => { delete reviewCache[r.site.key]; const st = el("p", { class: "hint" }, L("กำลังตรวจรูปใหม่…", "Re-checking photos…")); wrap.replaceWith(st); st.replaceWith(await reviewPanel(r, (t) => { st.textContent = t; })); } }, L("ตรวจรูปใหม่", "Re-check photos")),
    el("span", { class: "hint" }, L(`เทียบกับรูปอ้างอิง ${allRefs.length} รูปจาก ${new Set(allRefs.map((x) => x.site)).size} ไซต์ตัวอย่างของโปรไฟล์นี้ · เกณฑ์ผ่านอัตโนมัติปรับตามหัวข้อ (ขั้นต่ำ ${pct(FLOOR)} แก้ได้ที่ "เกณฑ์ตรวจ")`, `Compared with ${allRefs.length} reference photos from ${new Set(allRefs.map((x) => x.site)).size} sample sites of this profile · auto-pass threshold adapts per topic (floor ${pct(FLOOR)}, editable under "Thresholds")`)));
  wrap.append(summary);
  if (topicNotes.length) wrap.append(el("div", { class: "auto-note" }, L("จำนวนรูปต่างจากไซต์ตัวอย่าง: ", "Photo counts differ from sample sites: "), el("ul", {}, ...topicNotes.map((t) => el("li", {}, msgOf(t))))));
  if (!items.length) wrap.append(el("p", {}, L("ไม่พบรูปใน Attachment", "No photos found in the Attachment")));
  const section = (title, list, open) => {
    if (!list.length) return;
    const g = grid(list, open); g.style.display = open ? "" : "none";
    const btn = el("button", { class: "btn small", onclick: () => { const hidden = g.style.display === "none"; g.style.display = hidden ? "" : "none"; btn.textContent = (hidden ? L("ซ่อน", "Hide") : L("แสดง", "Show")) + ` (${list.length})`; } }, (open ? L("ซ่อน", "Hide") : L("แสดง", "Show")) + ` (${list.length})`);
    wrap.append(el("h3", {}, title, " ", btn), g);
  };
  section(L("ต้องให้ ROM ตรวจ", "Needs ROM review"), need, true);
  section(L("ผ่านอัตโนมัติ — คล้ายรูปอ้างอิงของไซต์ตัวอย่าง (กด Reject ได้ถ้าไม่เห็นด้วย)", "Auto-passed — similar to sample-site references (Reject if you disagree)"), autoOk, false);
  section(L("ROM ตัดสินแล้ว", "Decided by ROM"), decided, false);
  return wrap;
}

function setVerdict(r, item, v, reason, canvas) {
  item.verdict = v; item.reason = v === "reject" ? reason || item.reason : "";
  item.by = $("#reviewer").value.trim(); item.at = new Date().toLocaleString("th-TH");
  saveReview(r);
  // เรียนรู้: Accept → เก็บเป็นรูปอ้างอิงของ (โปรไฟล์ × section) · Reject → จำ hash + เหตุผล
  const profileKey = r.facts.profile || "L:" + r.facts.nearestProfile;
  item.autoAccepted = false;
  if (v === "accept" && canvas) addRefImage({ profile: profileKey, section: item.section, topic: item.topic || "", site: r.facts.code, page: item.page, thumb: thumb(canvas, 320), hash: item.hash, by: item.by, source: "rom", emb: item.emb || "" }).then(renderKb);
  recordImageDecision({ hash: item.hash, verdict: v, reason: item.reason, site: r.facts.code, section: item.section, by: item.by, emb: v === "reject" ? item.emb || "" : "" });
  renderKb();
}

// เกณฑ์ความคล้ายต่อหัวข้อ = p10 ของ "ความคล้ายสูงสุดกับไซต์อื่นในหัวข้อเดียวกัน" ของรูปอ้างอิงเอง (leave-one-site-out) อย่างน้อย floor สูงสุด 0.90 · หัวข้อที่มีรูป < 8 ใช้ 0.78
const thresholdCache = {};
function topicThresholds(profileKey, refs, floor) {
  const ck = `${profileKey}|${refs.length}|${floor}`;
  if (thresholdCache[ck]) return thresholdCache[ck];
  const byTopic = {}; for (const r of refs) (byTopic[topicOf(r.section, r.topic)] ||= []).push(r);
  const out = {};
  for (const [t, list] of Object.entries(byTopic)) {
    if (list.length < 8) { out[t] = Math.max(floor, 0.78); continue; }
    const sims = [];
    for (const r of list) { let best = 0; for (const o of list) if (o.site !== r.site) { const s = cosine(r.vec, o.vec); if (s > best) best = s; } if (best) sims.push(best); }
    sims.sort((a, b) => a - b);
    const p10 = sims[Math.floor(sims.length * 0.1)] ?? 0.78;
    out[t] = Math.min(0.9, Math.max(floor, p10));
  }
  return (thresholdCache[ck] = out);
}

function similarStrip(similar) {
  if (!similar?.length) return null;
  const strip = el("div", { class: "ref-strip small" }, el("span", { class: "hint" }, L("รูปอ้างอิงที่คล้ายที่สุด: ", "Most similar references: ")));
  for (const { ref, sim } of similar) {
    const img = el("img", { alt: ref.site, title: `${ref.site} ${L("หน้า", "page")} ${ref.page} · ${ref.source === "signed" ? L("ลูกค้าเซ็น", "customer-signed") : ref.source === "sample" ? L("ตัวอย่าง", "sample") : "ROM"}` });
    refThumb(ref.id).then((t) => { if (t) img.src = t; else img.remove(); });
    strip.append(el("span", { class: "ref-item signed" }, img, el("small", {}, `${ref.site} · ${Math.round(sim * 100)}%`)));
  }
  return strip;
}

function reviewCard(r, item, im, pageText, similar = null) {
  const card = el("div", { class: "review-item " + item.verdict });
  const img = el("img", { src: thumb(im.canvas), loading: "lazy", alt: L(`หน้า ${item.page}`, `page ${item.page}`) });
  const reasonSel = el("select", {}, el("option", { value: "" }, L("เหตุผล Reject…", "Reject reason…")), ...REJECT_REASONS.map((x) => el("option", { value: x }, reasonText(x))));
  const reasonTxt = el("input", { type: "text", placeholder: L("รายละเอียด", "details"), size: "18" });
  if (item.reason) { const known = REJECT_REASONS.find((x) => item.reason.startsWith(x)); reasonSel.value = known || "อื่นๆ (ระบุ)"; reasonTxt.value = known ? item.reason.slice(known.length).replace(/^: /, "") : item.reason; }
  const status = el("span", { class: "hint" });
  const refresh = () => { card.className = "review-item " + item.verdict; status.textContent = item.verdict ? `${item.verdict === "accept" ? "Accept" : "Reject"} · ${item.by === "ระบบ" ? L("ระบบ", "System") : item.by || "-"} · ${item.at}` : L("ยังไม่ตรวจ", "not reviewed"); };
  card.addEventListener("refresh", refresh);
  const accept = el("button", { class: "btn small", onclick: () => { setVerdict(r, item, "accept", "", im.canvas); refresh(); } }, "Accept");
  const reject = el("button", { class: "btn small", onclick: () => {
    if (!reasonSel.value) { alert(L("เลือกเหตุผล Reject ก่อน", "Choose a Reject reason first")); return; }
    const reason = reasonSel.value === "อื่นๆ (ระบุ)" ? reasonTxt.value.trim() || "อื่นๆ" : reasonSel.value + (reasonTxt.value.trim() ? ": " + reasonTxt.value.trim() : "");
    setVerdict(r, item, "reject", reason, im.canvas); refresh();
  } }, "Reject");
  card.append(...[img, el("div", { class: "cap" }, el("strong", {}, item.label || item.section), L(` · หน้า ${item.page} รูปที่ ${item.idx + 1} · ${im.width}×${im.height}`, ` · page ${item.page} photo ${item.idx + 1} · ${im.width}×${im.height}`), pageText ? el("div", { class: "hint" }, pageText.slice(0, 160)) : null),
    item.auto ? el("div", { class: item.autoAccepted ? "hint" : "auto-note" }, L("ระบบ: ", "System: ") + msgOf({ msg: item.auto, msg_en: item.auto_en })) : null,
    similarStrip(similar),
    el("div", { class: "act" }, accept, reject, reasonSel, reasonTxt), status].filter(Boolean));
  refresh();
  return card;
}

// ---------- 10. OCR screenshot ----------
const ocrCache = {}; // siteKey -> raw
// OCR screenshot (กฎ O01–O06) ของไซต์ — ทำครั้งเดียว ผลเข้าประเด็น/สถานะ/Excel · ใช้ทั้งงานพื้นหลังและแท็บ OCR
const ocrJobs = {}; // siteKey -> Promise
function runOcrSite(r, status = () => {}) {
  if (r.ocrDone) return Promise.resolve(r.ocrResult);
  if (ocrJobs[r.site.key]) return ocrJobs[r.site.key];
  ocrJobs[r.site.key] = (async () => {
    const att = files.find((x) => x.name === r.site.attFile);
    const satp = files.find((x) => x.name === r.site.satpFile);
    if (!att && !satp) throw new Error(L("ไม่พบไฟล์ของไซต์นี้ในรายการที่โหลด", "Files of this site not found among the loaded files"));
    let ocr = ocrCache[r.site.key];
    if (!ocr) { ocr = await ocrSite(pdfjs, r, att?.bytes, satp?.bytes, status); ocrCache[r.site.key] = ocr; }
    const rows = parseInventory(ocr.inventory);
    if (rows.length) recordInventory(r.facts.code, { profile: r.facts.profile || "L:" + r.facts.nearestProfile, rows, page: rows[0].page });
    r.inventory = rows;
    const found = ocrChecks(ocr, r.site, r.facts, { rows, inventory: kb.inventory });
    r.issues = r.issues.filter((i) => !i.ocr).concat(found);
    r.issues.sort((a, b) => (a.level || 9) - (b.level || 9));
    applyDecisions(r);
    r.summary = summarize(r.issues); r.summary.textStatus = r.summary.status;
    r.ocrDone = true; r.ocrResult = { ocr, found };
    renderSummaryRow(r);
    return r.ocrResult;
  })().finally(() => { delete ocrJobs[r.site.key]; });
  return ocrJobs[r.site.key];
}
async function ocrPanel(r, wrap) {
  const status = el("p", { class: "hint ocr-status" }, r.ocrDone ? "" : L("กำลังเตรียม OCR…", "Preparing OCR…"));
  wrap.append(status);
  try {
    const { ocr, found } = await runOcrSite(r, (s) => { status.textContent = s; });
    status.textContent = L(`OCR อ่าน ${ocr.raw.length} รูป พบประเด็น ${found.filter((i) => i.severity !== "info").length} ข้อ (รวมอยู่ในแท็บ "ประเด็น" และ Excel แล้ว)`, `OCR read ${ocr.raw.length} images, ${found.filter((i) => i.severity !== "info").length} issues found (included in the "Issues" tab and Excel)`);
    const t = el("table", { class: "tbl" }, el("tr", {}, ...[L("ผล", "Result"), "Section", L("หน้า", "Page"), L("ประเด็น", "Issue")].map((h) => el("th", {}, h))));
    const viewer = el("div", { class: "page-viewer" });
    for (const i of found) {
      const open = () => showIssuePage(r, i, viewer);
      t.append(el("tr", { class: i.page ? "clickable" : "", onclick: (e) => { if (i.page && e.target.tagName !== "BUTTON") open(); } },
        el("td", {}, el("span", { class: "pill " + (i.severity === "fail" ? "fail" : i.severity) }, sevText(i.severity))), el("td", {}, sectionText(i.section)),
        el("td", {}, i.page ? el("button", { class: "btn small", title: L("แสดงหน้าเอกสาร", "Show the document page"), onclick: open }, L(`หน้า ${i.page}`, `Page ${i.page}`)) : ""), el("td", { class: "msg" }, msgOf(i))));
    }
    wrap.append(el("p", { class: "hint" }, L("กดแถวหรือปุ่มหน้าเพื่อดูหน้าเอกสารจริง", "Click a row or the page button to view the document page")), t, viewer, el("h3", {}, L("ข้อความที่ OCR อ่านได้ (ตัดสั้น)", "Text read by OCR (truncated)")));
    const raw = el("table", { class: "tbl" }, el("tr", {}, ...[L("เอกสาร", "Document"), L("ส่วน", "Part"), L("หน้า", "Page"), L("ความมั่นใจ", "Confidence"), L("ข้อความ", "Text")].map((h) => el("th", {}, h))));
    for (const x of ocr.raw) raw.append(el("tr", { class: "clickable", onclick: () => showIssuePage(r, { section: x.doc === "SATP" ? x.section : "Attachment " + x.section, page: x.page, msg: "" }, viewer) }, el("td", {}, x.doc), el("td", {}, x.section), el("td", {}, x.page), el("td", {}, Math.round(x.confidence) + "%"), el("td", { class: "msg hint" }, x.text.replace(/\s+/g, " ").slice(0, 300))));
    wrap.append(raw);
  } catch (e) { status.textContent = L("OCR ผิดพลาด: ", "OCR error: ") + e.message; console.error(e); }
  return wrap;
}
function renderSummaryRow(r) {
  const rows = [...$("#summary").querySelectorAll("tr.clickable")];
  const row = rows.find((tr) => tr.children[1].textContent === r.site.folder && tr.children[0].textContent === r.facts.code);
  if (!row) return;
  row.children[9].replaceWith(statusCell(r)); row.children[10].textContent = r.summary.fail; row.children[11].textContent = r.summary.warn;
  refreshDetailHeader(r);
}

// ---------- ฐานความรู้ ----------
async function renderKb() {
  const box = $("#kb"); if (!box) return;
  const st = await kbStats();
  const head = el("p", {}, L(`การตัดสินใจประเด็น ${st.decisions} · โปรไฟล์ที่เรียนรู้ ${st.profiles} · รูปอ้างอิง ${st.refImages} (จากไซต์ตัวอย่าง/ลูกค้าเซ็นแล้ว ${st.signedRefs} รูป / ${st.signedSites} ไซต์) · รูปที่เคยตัดสิน ${st.imageDecisions}`, `Issue decisions ${st.decisions} · learned profiles ${st.profiles} · reference photos ${st.refImages} (from sample / customer-signed sites: ${st.signedRefs} photos / ${st.signedSites} sites) · photo verdicts ${st.imageDecisions}`));
  const dt = el("table", { class: "tbl" }, el("tr", {}, ...[L("กฎ", "Rule"), "Section", L("ตัดสินใจ", "Decision"), L("เหตุผล", "Reason"), L("ตัวอย่างประเด็น", "Example issue"), L("โดย", "By"), L("เมื่อ", "When"), L("ครั้ง", "Count"), ""].map((h) => el("th", {}, h))));
  for (const d of kb.decisions.slice().reverse().slice(0, 30)) dt.append(el("tr", {}, el("td", {}, d.rule), el("td", {}, sectionText(d.section)), el("td", {}, el("span", { class: "pill " + (d.decision === "accept" ? "ok" : "warn") }, d.decision === "accept" ? L("ยอมรับ", "Accepted") : L("ยืนยันปัญหา", "Confirmed issue"))), el("td", {}, d.reason), el("td", { class: "hint msg" }, d.example), el("td", {}, d.by), el("td", {}, d.at), el("td", {}, d.count || 1), el("td", {}, el("button", { class: "btn small", onclick: () => { deleteDecisionRecord(d); renderKb(); } }, L("ลบ", "Delete")))));
  const pt = el("table", { class: "tbl" }, el("tr", {}, ...[L("โปรไฟล์", "Profile"), L("ชื่อ", "Name"), L("ตัวอย่าง", "Samples"), L("ไซต์", "Sites"), L("โดย", "By"), ""].map((h) => el("th", {}, h))));
  for (const p of kb.profiles) pt.append(el("tr", {}, el("td", {}, p.id), el("td", {}, p.name), el("td", {}, p.samples), el("td", {}, (p.sites || []).join(", ")), el("td", {}, `${p.by || ""} ${p.at || ""}`), el("td", {}, el("button", { class: "btn small", onclick: () => { forgetProfile(p.id); setLearnedProfiles(kb.profiles); renderKb(); } }, L("ลบ", "Delete")))));
  const up = cloud.ready ? el("button", { class: "btn small", onclick: async (e) => { if (!confirm(L("ส่งฐานความรู้ในเครื่องนี้ทั้งหมดขึ้นคลาวด์ของทีม? (รายการที่มีอยู่แล้วจะถูกเขียนทับด้วยของเครื่องนี้)", "Upload this PC's whole knowledge base to the team cloud? (existing entries are overwritten with this PC's)"))) return; e.target.disabled = true; const n = await uploadLocalToCloud((t) => { e.target.textContent = t; }); e.target.textContent = L(`อัปโหลดแล้ว ${n} รายการ`, `Uploaded ${n} entries`); } }, L("อัปโหลดฐานความรู้ในเครื่องขึ้นคลาวด์", "Upload local knowledge base to cloud")) : null;
  const note = cloud.ready ? L("ฐานความรู้ซิงก์กับคลาวด์ของทีม — ทุกการตัดสินใจและรูปอ้างอิงใหม่ขึ้นคลาวด์ทันที ลบรายการได้ที่ปุ่ม ลบ/ยกเลิก/× ของรายการนั้น", "Synced with the team cloud — every new decision and reference photo goes up immediately; remove an entry with its Delete / Undo / × button") : cloud.enabled ? L("เชื่อมต่อฐานความรู้ทีมไม่ได้ — ข้อมูลอยู่ในเครื่องนี้ (กดซิงก์ที่แถบด้านบนเมื่อออนไลน์)", "Team cloud unreachable — data stays on this PC (press Sync in the top bar when online)") : L("ฐานความรู้อยู่ในเบราว์เซอร์เครื่องนี้ (ยังไม่ได้ตั้งค่าคลาวด์)", "Knowledge base lives in this browser (cloud not configured)");
  box.replaceChildren(head, el("div", { class: "row" }, up, el("span", { class: "hint" }, note)),
    el("h3", {}, L("การตัดสินใจประเด็น (ล่าสุด 30)", "Issue decisions (latest 30)")), dt, el("h3", {}, L("โปรไฟล์ที่เรียนรู้จาก ROM", "Profiles learned from ROM")), pt.children.length > 1 ? pt : el("p", { class: "hint" }, L("ยังไม่มี — ไซต์ที่ไม่ตรงโปรไฟล์ P1–P5 จะมีปุ่ม 'ROM ยืนยัน: ใช้ไซต์นี้เป็นอ้างอิง'", "None yet — a site matching no P1–P5 profile shows the button 'ROM confirms: use this site as reference'")));
}

// ---------- Excel / ประวัติ ----------
function exportExcel() {
  if (!run) return;
  const wb = buildWorkbook(run.results, reviews, { when: run.when, reviewer: $("#reviewer").value.trim(), version: VERSION });
  XLSX.writeFile(wb, `SATP_check_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
function saveHistory() {
  const h = JSON.parse(localStorage.getItem("satp:history") || "[]");
  for (const r of run.results) h.unshift({ when: run.when, code: r.facts.code, folder: r.site.folder, kind: r.facts.nodeKind, project: r.site.satp?.header.project || "", model: r.site.satp?.header.model || "", status: r.summary.status, fail: r.summary.fail, warn: r.summary.warn, profile: r.facts.profile || "-" });
  localStorage.setItem("satp:history", JSON.stringify(h.slice(0, 300)));
  renderHistory();
}
function renderHistory() {
  const h = JSON.parse(localStorage.getItem("satp:history") || "[]");
  const t = $("#history");
  t.replaceChildren(el("tr", {}, ...[L("เมื่อ", "When"), L("ไซต์", "Site"), L("โฟลเดอร์", "Folder"), "Project / Link", "DWDM Model", L("ชนิดโหนด", "Node type"), L("โปรไฟล์", "Profile"), L("สถานะ", "Status"), L("ไม่ผ่าน", "Fail"), L("เตือน", "Warn"), ""].map((x) => el("th", {}, x))));
  h.slice(0, 50).forEach((x, i) => t.append(el("tr", {}, el("td", {}, x.when), el("td", {}, x.code), el("td", {}, x.folder), el("td", {}, x.project || ""), el("td", {}, x.model || ""), el("td", {}, x.kind || ""), el("td", {}, x.profile), el("td", {}, pill(x.status)), el("td", {}, x.fail), el("td", {}, x.warn),
    el("td", {}, el("button", { class: "btn small", title: L("ลบรายการนี้", "Delete this entry"), onclick: () => { h.splice(i, 1); localStorage.setItem("satp:history", JSON.stringify(h)); renderHistory(); } }, L("ลบ", "Delete"))))));
  if (!h.length) t.append(el("tr", {}, el("td", { colspan: 11, class: "hint" }, L("ยังไม่มีประวัติ", "No history yet"))));
}

// ---------- ทดสอบในเครื่อง (localhost เท่านั้น) ----------
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  window.satpTest = {
    async load(paths) {
      for (const p of paths) {
        const res = await fetch("/samples/" + p.split("/").map(encodeURIComponent).join("/"));
        if (!res.ok) { console.warn("load fail", p); continue; }
        files.push({ name: p.split("/").pop(), path: p, bytes: new Uint8Array(await res.arrayBuffer()) });
      }
      renderFileList();
    },
    runCheck, harvestAllAsSamples: () => harvestSites(run.results, "sample", $("#progress")), get result() { return run; },
    decideSiteImages, reviews,
    harvestInventory: async () => { // OCR เฉพาะ screenshot Inventory ของทุกไซต์ที่โหลด → เก็บผังการ์ด/serial ขึ้นคลาวด์
      const prog = $("#progress"); let n = 0, i = 0;
      for (const r of run.results) {
        i++; const att = files.find((x) => x.name === r.site.attFile); if (!att || kb.inventory?.[r.facts.code]) continue; // ข้ามไซต์ที่เก็บแล้ว
        const ocr = await ocrSite(pdfjs, r, att.bytes, null, (t) => { prog.textContent = `inventory ${i}/${run.results.length} ${r.facts.code}: ${t}`; }, ["1.4"]);
        const rows = parseInventory(ocr.inventory);
        if (rows.length) { recordInventory(r.facts.code, { profile: r.facts.profile || "L:" + r.facts.nearestProfile, rows, page: rows[0].page }); n++; }
      }
      prog.textContent = `เก็บ inventory แล้ว ${n} ไซต์`; return n;
    },
    backfillDigests: async () => { // เติมลายนิ้วมือพิกเซลให้รูปอ้างอิงของไซต์ที่โหลดอยู่ (ใช้ครั้งเดียวกับชุดตัวอย่าง)
      const prog = $("#progress"); let n = 0, i = 0;
      for (const r of run.results) {
        i++; const profileKey = r.facts.profile || "L:" + r.facts.nearestProfile;
        const { items } = await collectSiteImages(r, (t) => { prog.textContent = `digest ${i}/${run.results.length} ${t}`; });
        n += await setRefDigests(profileKey, items.map((it) => ({ hash: it.hash, digest: it.digest })));
      }
      prog.textContent = `เติม digest แล้ว ${n} รูป`; return n;
    },
    backfillEmbeddings: (profile) => backfillEmbeddings(embedImage, encodeEmb, (t) => { $("#progress").textContent = t; }, profile), loadEmbedder: () => loadEmbedder((t) => { $("#progress").textContent = t; }), refVectorsForProfile, decodeEmb, cosine, embedImage, files: () => files, reviews, ocrCache, wb: () => buildWorkbook(run.results, reviews, { when: run.when, reviewer: "", version: VERSION }),
  };
}
