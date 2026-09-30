// หน้าเว็บหลัก — ทุกอย่างทำในเบราว์เซอร์ ไม่มี request ส่งไฟล์ออกไป
import { analyzeFiles, DEFAULT_CRITERIA } from "./engine/index.js";
import { MASTERFILE_DATE, SITES } from "./data/sites.js";
import { buildWorkbook, reviewStats } from "./ui/report.js";
import { pageImageCanvases, aHash, hamming, blurScore, thumb, pixelDigest } from "./ui/images.js";
import { ocrSite } from "./ui/ocr.js";
import { ocrChecks } from "./engine/ocrRules.js";
import { summarize } from "./engine/rules.js";
import { setLearnedProfiles } from "./engine/profiles.js";
import { kb, applyDecisions, recordDecision, forgetDecision, deleteDecisionRecord, learnProfile, forgetProfile, addRefImage, refImagesFor, refImagesForProfile, refVectorsForProfile, refThumb, backfillEmbeddings, setRefDigests, ensureThumbs, removeRefImage, listRefKeys, isReferenceSource, recordImageDecision, findImageDecision, recordSectionCount, expectedCount, topicOf, exportKb, importKb, kbStats, syncFromCloud, uploadLocalToCloud } from "./ui/learn.js";
import { cloud, initCloud } from "./ui/cloud.js";
import { embedder, loadEmbedder, embedImage, encodeEmb, decodeEmb, cosine, rank } from "./ui/embed.js";

const VERSION = "0.2.0";
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const REJECT_REASONS = ["รูปไม่ชัด/เบลอ", "รูปไม่ครบตามที่กำหนด", "ถ่ายผิดสิ่ง/ผิดมุม", "ป้าย/label ไม่ครบหรืออ่านไม่ได้", "การจัดสายไม่เรียบร้อย", "การ์ด/อุปกรณ์ไม่ตรง config", "กราวด์/สายไฟไม่ถูกต้อง", "รูปซ้ำจากไซต์อื่น", "อื่นๆ (ระบุ)"];

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
  $("#clear-history").addEventListener("click", () => { if (confirm("ล้างประวัติการตรวจทั้งหมดในเบราว์เซอร์นี้?")) { localStorage.removeItem("satp:history"); renderHistory(); } });
  $("#clear-reviews").addEventListener("click", () => { if (!confirm("ล้างผล Accept/Reject ของทุกไซต์ในเบราว์เซอร์นี้? (รูปอ้างอิงในฐานความรู้ยังอยู่)")) return; for (const k of Object.keys(localStorage)) if (k.startsWith("satp:review:")) localStorage.removeItem(k); for (const k of Object.keys(reviews)) delete reviews[k]; if (run) { for (const r of run.results) reviews[r.site.key] = { items: [] }; renderResults(); } });
  $("#clear-all").addEventListener("click", async () => {
    if (!confirm("ล้างข้อมูลทั้งหมดในเบราว์เซอร์นี้: ประวัติ, ผลตรวจรูป, ฐานความรู้ (การตัดสินใจ/โปรไฟล์ที่เรียนรู้/รูปอ้างอิง), เกณฑ์ที่แก้ไว้, ชื่อผู้ตรวจ? แนะนำให้กด 'ส่งออกฐานความรู้' ก่อน")) return;
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
  box.replaceChildren(el("span", {}, "☁ ฐานความรู้ทีม: ", el("strong", {}, cloud.ready ? "เชื่อมต่อแล้ว" : "เชื่อมต่อไม่ได้ — ใช้ข้อมูลในเครื่องนี้")), " ",
    cloud.ready ? el("button", { class: "btn small", onclick: () => pullCloud() }, "ซิงก์") : null, " ",
    el("span", { class: "hint", id: "cloud-status" }));
}
async function pullCloud() {
  const st = $("#cloud-status"); const say = (t) => { if (st) st.textContent = t; };
  try {
    say("กำลังซิงก์…");
    const n = await syncFromCloud(say);
    setLearnedProfiles(kb.profiles); renderKb();
    if (n) say(`ซิงก์แล้ว ${new Date().toLocaleTimeString("th-TH")} · ประเด็น ${n.decisions} · รูปอ้างอิงใหม่ ${n.refImages}${n.removed ? ` · ถอดออก ${n.removed}` : ""}`);
  } catch (e) { say("ซิงก์ไม่ได้: " + (e.message || e)); console.warn(e); }
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
  $("#progress").textContent = files.length ? `${files.length} ไฟล์` : "";
}

// ---------- เกณฑ์ ----------
function loadCriteria() {
  const c = JSON.parse(JSON.stringify(DEFAULT_CRITERIA));
  try { const saved = JSON.parse(localStorage.getItem("satp:criteria") || "{}"); for (const k of Object.keys(saved)) if (c[k]) Object.assign(c[k], saved[k]); } catch {}
  return c;
}
const CRIT_LABELS = {
  dc48: ["แรงดัน -48 VDC (ค่าสัมบูรณ์)", ["min", "max"], "V"], hvdc: ["แรงดัน HVDC ~240 V", ["min", "max"], "V"], ac: ["แรงดัน AC (PSI-M)", ["min", "max"], "V"],
  groundMax: ["ค่ากราวด์สูงสุด", ["value"], "Ω"], groundAllowNonNumeric: ["ยอมรับกราวด์ N/A หรือ OL", ["value"], "bool"],
  imageSim: ["รูปผ่านอัตโนมัติ: ความคล้ายขั้นต่ำ (ระบบปรับสูงขึ้นตามหัวข้อจากไซต์ตัวอย่าง)", ["value", "margin"], "0–1"],
  lossPerKmWarn: ["Loss/km เตือนเมื่อเกิน (span ยาว)", ["value", "minDistanceKm"], "dB/km, km"], shortSpanTotalLossWarn: ["Total loss เตือนเมื่อเกิน (span สั้น)", ["value"], "dB"],
  lossTolerance: ["ความคลาดเคลื่อน Total Loss vs TX−RX", ["value"], "dB"], shortSpanKm: ["span สั้น = น้อยกว่า", ["value"], "km"], calibrationCheck: ["ตรวจวันหมดอายุ calibration", ["value"], "bool"],
};
function renderCriteria() {
  const t = el("table", {});
  t.append(el("tr", {}, el("th", {}, "เกณฑ์"), el("th", {}, "ค่า"), el("th", {}, "หน่วย"), el("th", {}, "ที่มา")));
  for (const [k, [label, fields, unit]] of Object.entries(CRIT_LABELS)) {
    const inputs = fields.map((f) => {
      const v = criteria[k][f];
      const inp = unit === "bool" ? el("input", { type: "checkbox" }) : el("input", { type: "number", step: "any", value: v ?? "" });
      if (unit === "bool") inp.checked = !!v;
      inp.addEventListener("change", () => { criteria[k][f] = unit === "bool" ? inp.checked : inp.value === "" ? null : +inp.value; saveCriteria(); });
      return [f === "max" ? " – " : f === "minDistanceKm" ? " เมื่อระยะ ≥ " : f === "margin" ? " และไม่คล้าย section อื่นเกินกว่า +" : "", inp];
    });
    t.append(el("tr", {}, el("td", {}, label), el("td", {}, ...inputs), el("td", {}, unit === "bool" ? "" : unit), el("td", { class: "hint" }, criteria[k].source)));
  }
  const reset = el("button", { class: "btn small", onclick: () => { localStorage.removeItem("satp:criteria"); criteria = loadCriteria(); renderCriteria(); } }, "คืนค่าเริ่มต้น");
  $("#criteria").replaceChildren(el("p", { class: "hint" }, "ค่าเริ่มต้นมาจาก template และสถิติเอกสารตัวอย่าง 46 ไซต์ — แก้แล้วเก็บในเบราว์เซอร์นี้ ค่าว่าง = ไม่ตัดสิน รายงานค่าอย่างเดียว"), t, reset);
}
function saveCriteria() { localStorage.setItem("satp:criteria", JSON.stringify(criteria)); }

// ---------- 2. ตรวจ ----------
async function runCheck() {
  $("#run").disabled = true;
  const prog = $("#progress");
  try {
    const { results, errors } = await analyzeFiles(pdfjs, files, {
      criteria, wantImages: false,
      onProgress: (p) => { prog.textContent = `กำลังอ่าน ${p.done + 1}/${p.total}: ${p.file}`; },
    });
    run = { results, errors, when: new Date().toLocaleString("th-TH") };
    for (const r of results) { applyDecisions(r); r.summary = summarize(r.issues); reviews[r.site.key] = loadReview(r); }
    prog.textContent = `เสร็จ ${results.length} ไซต์ ${errors.length ? `(อ่านไม่ได้ ${errors.length} ไฟล์)` : ""}`;
    renderResults();
    saveHistory();
    await harvestSignedSites(results, prog);
  } catch (e) {
    prog.textContent = "ผิดพลาด: " + e.message;
    console.error(e);
  } finally { $("#run").disabled = false; }
}

function pill(status) {
  const cls = status.startsWith("ผ่าน (") || status === "ผ่าน" ? "ok" : status === "ไม่ผ่าน" ? "fail" : "warn";
  return el("span", { class: "pill " + cls }, status);
}

function renderResults() {
  $("#sec-results").hidden = false;
  $("#run-meta").textContent = `ตรวจเมื่อ ${run.when} · ${run.results.length} ไซต์`;
  const t = $("#summary");
  t.replaceChildren(el("tr", {}, ...["ไซต์", "โฟลเดอร์", "Project / Link", "DWDM Model", "ชนิดโหนด", "รหัส", "โปรไฟล์", "ทิศ", "ไฟ", "สถานะ", "ไม่ผ่าน", "เตือน", "รูป (Accept/Reject/รอ)"].map((h) => el("th", {}, h))));
  for (const r of run.results) {
    const rv = reviewStats(reviews[r.site.key]);
    const tr = el("tr", { class: "clickable", onclick: () => showDetail(r) },
      el("td", {}, r.facts.code), el("td", {}, r.site.folder), el("td", {}, r.site.satp?.header.project || ""), el("td", {}, r.site.satp?.header.model || ""), el("td", {}, r.facts.nodeKind || "?"), el("td", {}, `${r.facts.nodeType || "?"}_${r.facts.suffix || ""}`),
      el("td", {}, r.facts.profile || el("span", { class: "pill info" }, `ไม่มี → ROM ตรวจเอง`)),
      el("td", {}, r.facts.degrees ?? "-"), el("td", {}, r.facts.power), el("td", {}, pill(r.summary.status)),
      el("td", {}, r.summary.fail), el("td", {}, r.summary.warn), el("td", { id: "rv-" + cssId(r.site.key) }, r.facts.customerAccepted ? "–" : `${rv.accept} / ${rv.reject} / ${rv.pending}`));
    t.append(tr);
  }
  for (const e of run.errors) t.append(el("tr", {}, el("td", { colspan: 13, class: "pill fail" }, `อ่านไฟล์ไม่ได้: ${e.name} — ${e.error}`)));
  $("#details").replaceChildren();
}
const cssId = (s) => s.replace(/[^a-zA-Z0-9]/g, "_");

function showDetail(r) {
  const box = $("#details");
  const facts = r.facts;
  const S = r.site.satp;
  const head = el("div", { class: "facts" },
    `${S?.header.station || ""} · Model ${S?.header.model || "-"} · SW ${S?.software?.release || "-"} · ติดตั้ง ${S?.header.installStart || "-"} – ${S?.header.installEnd || "-"} · Acceptance ${S?.header.acceptanceDate || "ไม่มี"} · `,
    facts.profile ? `โปรไฟล์ ${facts.profile}: ${facts.profileName}` : `ไม่ตรงโปรไฟล์ (ใกล้ ${facts.nearestProfile}: ${(facts.profileMismatches || []).join("; ")})`,
    facts.siteRef ? ` · รายชื่อไซต์: ${facts.siteRef.neName} ${facts.siteRef.shelfType}` : " · ไม่อยู่ในรายชื่อ 56 ไซต์");
  if (!facts.profile) head.append(" ", el("button", { class: "btn small", onclick: () => {
    if (!confirm(`ยืนยันว่าเอกสารไซต์ ${facts.code} ถูกต้องและใช้เป็นตัวอย่างอ้างอิงสำหรับ config แบบนี้ได้?\n(${facts.nodeType}, ${JSON.stringify(facts.shelves)}, ${facts.power}, ${facts.degrees} ทิศ)`)) return;
    const p = learnProfile(r, $("#reviewer").value.trim()); setLearnedProfiles(kb.profiles);
    facts.profile = p.id; facts.profileName = p.name; facts.profileMismatches = [];
    alert(`บันทึกเป็นโปรไฟล์ ${p.id} (ตัวอย่าง ${p.samples} ไซต์) — ไซต์ต่อไปที่ config เดียวกันจะเทียบกับโปรไฟล์นี้`);
    renderKb(); showDetail(r);
  } }, "ROM ยืนยัน: ใช้ไซต์นี้เป็นอ้างอิง"));
  const tabs = el("div", { class: "tabs" });
  const body = el("div", {});
  const tabIssues = el("button", { class: "active", onclick: () => { activate(tabIssues); body.replaceChildren(issuesTable(r)); } }, `ประเด็น (${r.issues.filter((i) => i.severity !== "info").length})`);
  const tabReview = el("button", { onclick: async () => {
    activate(tabReview);
    const st = el("p", { class: "hint" }, "กำลังดึงรูปจาก Attachment…"); body.replaceChildren(st);
    body.replaceChildren(await reviewPanel(r, (t) => { st.textContent = t; }));
  } }, "ตรวจรูป (Accept/Reject)");
  const tabOcr = el("button", { onclick: () => { activate(tabOcr); const wrap = el("div", {}); body.replaceChildren(wrap); ocrPanel(r, wrap); } }, "OCR screenshot");
  const activate = (b) => { for (const x of tabs.children) x.classList.toggle("active", x === b); };
  if (r.facts.customerAccepted) tabs.append(tabIssues, el("span", { class: "hint" }, "ลูกค้าตรวจรับแล้ว — ไม่ต้องตรวจรูป / OCR"));
  else tabs.append(tabIssues, tabReview, tabOcr);
  box.replaceChildren(el("div", { class: "detail" }, el("h3", {}, `${facts.code} — ${r.site.folder}`, " ", pill(r.summary.status)), head, tabs, body));
  body.append(issuesTable(r));
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function issuesTable(r, showInfo = false) {
  const LV = { 0: "-", 1: "1 ครบถ้วน", 2: "2 สอดคล้อง", 3: "3 ค่าเทคนิค" };
  const wrap = el("div", {});
  const real = r.issues.filter((i) => i.severity !== "info");
  const infos = r.issues.filter((i) => i.severity === "info");
  // ผ่าน = ไม่แสดงอะไร นอกจากข้อความผ่าน; ข้อมูลอ้างอิง (โปรไฟล์, หมายเหตุ) ดูได้เมื่อกดขยาย
  if (!real.length) wrap.append(el("p", {}, el("span", { class: "pill ok" }, r.summary.status), " ", r.facts.customerAccepted ? "ลูกค้าตรวจรับแล้ว — ไม่ต้องตรวจก่อน submit" : "ไม่พบข้อผิดหรือข้อสังเกต — ส่งลูกค้าได้"));
  if (infos.length) wrap.append(el("button", { class: "btn small", onclick: () => wrap.replaceWith(issuesTable(r, !showInfo)) }, showInfo ? "ซ่อนข้อมูลอ้างอิง" : `แสดงข้อมูลอ้างอิง (${infos.length})`));
  const rows = showInfo ? r.issues : real;
  if (!rows.length) return wrap;
  const t = el("table", { class: "tbl issues" }, el("tr", {}, ...["ระดับ", "ผล", "กฎ", "Section", "หน้า", "ประเด็น", "ใครตรวจต่อ", "การตัดสินใจ ROM"].map((h) => el("th", {}, h))));
  wrap.append(t);
  const refresh = () => { applyDecisions(r); r.summary = summarize(r.issues); renderSummaryRow(r); wrap.replaceWith(issuesTable(r, showInfo)); };
  for (const i of rows) {
    // ปุ่มตัดสินใจเฉพาะ "เตือน" (ระบบไม่แน่ใจ) — ข้อมูลและข้อผิดที่ระบบยืนยันได้ไม่ต้องตัดสิน
    const needsHuman = i.severity === "warn" && !r.facts.customerAccepted;
    let cell;
    if (i.learned) {
      cell = el("td", {}, el("span", { class: "pill " + (i.learned.decision === "accept" ? "ok" : "warn") }, i.learned.decision === "accept" ? "ยอมรับแล้ว" : "ยืนยันปัญหา"), ` ${i.learned.by || ""} ${i.learned.at}`, i.learned.reason ? ` — ${i.learned.reason}` : "", " ", el("button", { class: "btn small", onclick: () => { forgetDecision(i, r.facts); refresh(); renderKb(); } }, "ลบ"));
    } else if (needsHuman) {
      const reason = el("input", { type: "text", placeholder: "เหตุผล (ถ้ามี)", size: "14" });
      const go = (d) => { recordDecision(i, r.facts, d, reason.value.trim(), $("#reviewer").value.trim()); refresh(); renderKb(); };
      cell = el("td", {}, el("button", { class: "btn small", onclick: () => go("accept") }, "ยอมรับ"), " ", el("button", { class: "btn small", onclick: () => go("confirm") }, "ยืนยันปัญหา"), " ", reason);
    } else cell = el("td", { class: "hint" }, i.severity === "fail" ? "ระบบยืนยันได้เอง" : "");
    t.append(el("tr", {}, el("td", {}, LV[i.level]), el("td", {}, el("span", { class: "pill " + (i.severity === "fail" ? "fail" : i.severity) }, i.severity === "fail" ? "ไม่ผ่าน" : i.severity === "warn" ? "เตือน" : "ข้อมูล"), i.origSeverity ? el("div", { class: "hint" }, `(เดิม ${i.origSeverity})`) : null), el("td", {}, i.rule), el("td", {}, i.section), el("td", {}, i.page ?? ""), el("td", { class: "msg" }, i.msg), el("td", {}, i.who), cell));
  }
  return wrap;
}

// ---------- 10/11. ตรวจรูป ----------
const REVIEW_SECTIONS = [["1.8", "1.8 Visual Inspection"], ["1.4", "1.4 Inventory"], ["1.5", "1.5 Power"], ["1.6", "1.6 Ground"], ["1.9", "1.9 NE Setup"], ["1.15", "1.15 Fiber Scope"]];

function reviewKey(r) { return `satp:review:${r.site.key}:${r.site.attFile}`; }
function loadReview(r) { try { return JSON.parse(localStorage.getItem(reviewKey(r)) || "null") || { items: [] }; } catch { return { items: [] }; } }
function saveReview(r) { localStorage.setItem(reviewKey(r), JSON.stringify(reviews[r.site.key])); const c = $("#rv-" + cssId(r.site.key)); if (c) { const s = reviewStats(reviews[r.site.key]); c.textContent = `${s.accept} / ${s.reject} / ${s.pending}`; } }

const hashCache = {}; // `${site}|${page}|${idx}` -> hash

// หัวข้อย่อยของรูปจากข้อความบนหน้า เช่น "(a) Rack Installation" — ใช้จัดกลุ่มรูปอ้างอิงให้ละเอียดกว่าระดับ section
function topicFromText(pageText) {
  const m = /\(([a-g])\)\s*([^*:·(]{2,70})/.exec(pageText || "");
  return m ? `(${m[1]}) ${m[2].trim().replace(/\s+\S{0,3}$/, "")}` : "";
}

// ดึงรูปทุก section ที่ต้องตรวจจาก Attachment ของไซต์ → [{section, label, page, idx, im, pageText, topic, hash}]
async function collectSiteImages(r, onProgress = () => {}) {
  const A = r.site.att;
  if (!A) return { error: "ไม่มี Attachment Report", items: [] };
  const f = files.find((x) => x.name === r.site.attFile);
  if (!f) return { error: "ไม่พบไฟล์ Attachment ในรายการที่โหลด", items: [] };
  const doc = await pdfjs.getDocument({ data: f.bytes.slice(), verbosity: 0 }).promise;
  const secs = Object.entries(A.sections).sort((a, b) => a[1] - b[1]);
  const rangeOf = (sec) => { const i = secs.findIndex((s) => s[0] === sec); if (i < 0) return null; return [secs[i][1], i + 1 < secs.length ? secs[i + 1][1] - 1 : doc.numPages]; };
  const items = [];
  for (const [sec, label] of REVIEW_SECTIONS) {
    const range = rangeOf(sec);
    if (!range) continue;
    for (let p = range[0]; p <= range[1]; p++) {
      onProgress(`${r.facts.code}: อ่านรูปหน้า ${p}`);
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
    const { items } = await collectSiteImages(r, (t) => { prog.textContent = `เก็บรูปอ้างอิง ${i}/${sites.length} — ${t}`; });
    const counts = {};
    for (const it of items) {
      counts[topicOf(it.section, it.topic)] = (counts[topicOf(it.section, it.topic)] || 0) + 1;
      prog.textContent = `เก็บรูปอ้างอิง ${i}/${sites.length} — ${r.facts.code} หน้า ${it.page} (ใหม่ ${added})`;
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
  prog.textContent = `เสร็จ ${results.length} ไซต์ · เก็บรูปอ้างอิงจากไซต์ที่ลูกค้าเซ็นแล้ว ${n.sites} ไซต์ (รูปใหม่ ${n.added})`;
}
async function harvestAllAsSamples() {
  if (!run) return;
  if (!confirm(`ใช้รูปของทุกไซต์ในชุดนี้ (${run.results.length} ไซต์) เป็นรูปอ้างอิงตัวอย่าง? ระบบจะถือว่ารูปเหล่านี้ถูกต้อง และใช้เทียบกับไซต์ต่อไปในโปรไฟล์เดียวกัน`)) return;
  const btn = $("#harvest"); btn.disabled = true;
  const n = await harvestSites(run.results, "sample", $("#progress"));
  $("#progress").textContent = `เก็บรูปอ้างอิงตัวอย่างจาก ${n.sites} ไซต์ (รูปใหม่ ${n.added})`;
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
  const thOf = (tkey) => TH[tkey] ?? Math.max(FLOOR, 0.78);

  // ---------- ตัดสินแต่ละรูป ----------
  const need = [], autoOk = [], decided = [], topicNotes = [];
  const seenTopic = new Set();
  let done = 0;
  for (const it of items) {
    status(`กำลังเทียบรูปกับรูปอ้างอิง ${++done}/${items.length}`);
    const { im, page: p, idx, hash: h, digest, key } = it;
    const tkey = topicOf(it.section, it.topic);
    const isPhoto = /^1[.]8|^1[.]6/.test(it.section); // รูปถ่าย (ไม่ใช่ screenshot) — ใช้ aHash ใกล้เคียงเป็นสัญญาณเสริมได้
    if (!seenTopic.has(tkey)) {
      seenTopic.add(tkey);
      const n = items.filter((x) => topicOf(x.section, x.topic) === tkey).length;
      const exp = expectedCount(profileKey, it.section, it.topic);
      if (exp && (n < exp.min || n > exp.max)) topicNotes.push(`${it.topic || it.label}: มี ${n} รูป แต่ไซต์ตัวอย่างมี ${exp.min === exp.max ? exp.median : `${exp.min}–${exp.max}`} รูป (${exp.sites} ไซต์)`);
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
      const where = `${k2.split("|")[0]} หน้า ${k2.split("|")[1]}`; if (dupSeen.has(where)) continue; dupSeen.add(where);
      flags.push(exact ? `รูปเดียวกับ ${where}` : `น่าจะรูปเดียวกับ ${where}`);
    }
    const reused = allRefs.find((x) => isReferenceSource(x.source) && (x.digest ? x.digest === digest : isPhoto && hamming(h, x.hash) <= 2));
    if (reused) flags.push(`${reused.digest ? "รูปเดียวกับ" : "น่าจะรูปเดียวกับ"}ไซต์ตัวอย่าง ${reused.site} (หน้า ${reused.page}) — รูปถูกนำมาใช้ซ้ำ`);
    const blur = blurScore(im.canvas);
    if (blur < 15) flags.push(`ภาพอาจเบลอ (คมชัด ${blur.toFixed(0)})`);
    const prev = findImageDecision(h);
    if (prev && prev.verdict === "reject") flags.push(`รูปนี้เคยถูก Reject ที่ ${prev.site}: ${prev.reason} (${prev.by || ""})`);
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
        if (rej[0] && rej[0].sim >= 0.95) flags.push(`คล้ายรูปที่เคยถูก Reject ที่ ${rej[0].ref.site} (${pct(rej[0].sim)}): ${rej[0].ref.reason}`);
        const sibNote = sibling[0] && sibling[0].sim > s1 + MARGIN ? ` (คล้ายหัวข้อ "${sibling[0].ref.topic || sibling[0].ref.section}" ${pct(sibling[0].sim)} มากกว่า)` : "";
        if (!same.length) verdictNote = "ยังไม่มีรูปอ้างอิงของหัวข้อนี้ในโปรไฟล์นี้";
        else if (flags.length) verdictNote = `คล้ายรูปอ้างอิง ${pct(s1)} แต่มีข้อสังเกต`;
        else if (s1 >= th && s1 + MARGIN >= so) { auto = true; verdictNote = `ผ่านอัตโนมัติ: คล้ายรูปอ้างอิงของ ${same[0].ref.site} ${pct(s1)} (เกณฑ์หัวข้อนี้ ${pct(th)})${sibNote}`; }
        else if (so >= th && so > s1 + MARGIN) verdictNote = `น่าจะเป็นรูปของ "${otherSec[0].ref.topic || otherSec[0].ref.section}" (${pct(so)}) ไม่ใช่ "${it.topic || it.label}" (${pct(s1)})`;
        else verdictNote = `คล้ายรูปอ้างอิงเพียง ${pct(s1)} (เกณฑ์หัวข้อนี้ ${pct(th)})${sibNote}`;
      } catch (e) { console.warn("embed", e); verdictNote = "เทียบรูปไม่ได้: " + (e.message || e); }
    } else verdictNote = allRefs.length ? "โมเดลเปรียบเทียบรูปโหลดไม่ได้ — ตรวจเอง" : "ยังไม่มีรูปอ้างอิงของโปรไฟล์นี้";
    item.auto = [verdictNote, ...flags].join("; ");
    if (auto && !item.verdict) { item.verdict = "accept"; item.by = "ระบบ"; item.at = new Date().toLocaleString("th-TH"); item.autoAccepted = true; }
    else if (!auto && item.autoAccepted && item.by === "ระบบ") { item.verdict = ""; item.by = ""; item.at = ""; item.autoAccepted = false; } // เกณฑ์เปลี่ยน → ยกเลิกผลอัตโนมัติเดิม
    const entry = { it, item, similar };
    if (item.verdict && item.by !== "ระบบ") decided.push(entry);
    else if (item.verdict === "accept" && item.autoAccepted) autoOk.push(entry);
    else need.push(entry);
  }
  saveReview(r);
  return { items, need, autoOk, decided, topicNotes, allRefs, FLOOR };
}

async function reviewPanel(r, status = () => {}) {
  const res = await decideSiteImages(r, status);
  if (res.error) return el("p", {}, res.error);
  const { items, need, autoOk, decided, topicNotes, allRefs, FLOOR } = res;
  const rv = reviews[r.site.key];
  const pct = (x) => `${Math.round(x * 100)}%`;
  const wrap = el("div", {});
  // ---------- แสดงผล ----------
  // รูปอ้างอิงที่คล้ายที่สุด (ดาวน์โหลดรูปย่อตามต้องการ) แสดงเฉพาะรูปที่ต้องให้ ROM ตรวจ
  const grid = (list, withRefs) => { const g = el("div", { class: "review-grid" }); for (const e of list) g.append(reviewCard(r, e.item, e.it.im, e.it.pageText, withRefs ? e.similar : null)); return g; };
  const summary = el("div", { class: "row" },
    el("span", { class: "pill warn" }, `ต้องให้ ROM ตรวจ ${need.length}`), " ",
    el("span", { class: "pill ok" }, `ผ่านอัตโนมัติ ${autoOk.length}`), " ",
    el("span", { class: "pill info" }, `ROM ตัดสินแล้ว ${decided.length}`), " ",
    el("button", { class: "btn small", onclick: () => { for (const it of rv.items) if (!it.verdict) setVerdict(r, it, "accept"); wrap.querySelectorAll(".review-item").forEach((c) => c.dispatchEvent(new Event("refresh"))); } }, "Accept ที่เหลือทั้งหมด"),
    el("span", { class: "hint" }, `เทียบกับรูปอ้างอิง ${allRefs.length} รูปจาก ${new Set(allRefs.map((x) => x.site)).size} ไซต์ตัวอย่างของโปรไฟล์นี้ · เกณฑ์ผ่านอัตโนมัติปรับตามหัวข้อ (ขั้นต่ำ ${pct(FLOOR)} แก้ได้ที่ "เกณฑ์ตรวจ")`));
  wrap.append(summary);
  if (topicNotes.length) wrap.append(el("div", { class: "auto-note" }, "จำนวนรูปต่างจากไซต์ตัวอย่าง: ", el("ul", {}, ...topicNotes.map((t) => el("li", {}, t)))));
  if (!items.length) wrap.append(el("p", {}, "ไม่พบรูปใน Attachment"));
  const section = (title, list, open) => {
    if (!list.length) return;
    const g = grid(list, open); g.style.display = open ? "" : "none";
    const btn = el("button", { class: "btn small", onclick: () => { const hidden = g.style.display === "none"; g.style.display = hidden ? "" : "none"; btn.textContent = (hidden ? "ซ่อน" : "แสดง") + ` (${list.length})`; } }, (open ? "ซ่อน" : "แสดง") + ` (${list.length})`);
    wrap.append(el("h3", {}, title, " ", btn), g);
  };
  section("ต้องให้ ROM ตรวจ", need, true);
  section("ผ่านอัตโนมัติ — คล้ายรูปอ้างอิงของไซต์ตัวอย่าง (กด Reject ได้ถ้าไม่เห็นด้วย)", autoOk, false);
  section("ROM ตัดสินแล้ว", decided, false);
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
  const strip = el("div", { class: "ref-strip small" }, el("span", { class: "hint" }, "รูปอ้างอิงที่คล้ายที่สุด: "));
  for (const { ref, sim } of similar) {
    const img = el("img", { alt: ref.site, title: `${ref.site} หน้า ${ref.page} · ${ref.source === "signed" ? "ลูกค้าเซ็น" : ref.source === "sample" ? "ตัวอย่าง" : "ROM"}` });
    refThumb(ref.id).then((t) => { if (t) img.src = t; else img.remove(); });
    strip.append(el("span", { class: "ref-item signed" }, img, el("small", {}, `${ref.site} · ${Math.round(sim * 100)}%`)));
  }
  return strip;
}

function reviewCard(r, item, im, pageText, similar = null) {
  const card = el("div", { class: "review-item " + item.verdict });
  const img = el("img", { src: thumb(im.canvas), loading: "lazy", alt: `หน้า ${item.page}` });
  const reasonSel = el("select", {}, el("option", { value: "" }, "เหตุผล Reject…"), ...REJECT_REASONS.map((x) => el("option", { value: x }, x)));
  const reasonTxt = el("input", { type: "text", placeholder: "รายละเอียด", size: "18" });
  if (item.reason) { const known = REJECT_REASONS.find((x) => item.reason.startsWith(x)); reasonSel.value = known || "อื่นๆ (ระบุ)"; reasonTxt.value = known ? item.reason.slice(known.length).replace(/^: /, "") : item.reason; }
  const status = el("span", { class: "hint" });
  const refresh = () => { card.className = "review-item " + item.verdict; status.textContent = item.verdict ? `${item.verdict === "accept" ? "Accept" : "Reject"} · ${item.by || "-"} · ${item.at}` : "ยังไม่ตรวจ"; };
  card.addEventListener("refresh", refresh);
  const accept = el("button", { class: "btn small", onclick: () => { setVerdict(r, item, "accept", "", im.canvas); refresh(); } }, "Accept");
  const reject = el("button", { class: "btn small", onclick: () => {
    if (!reasonSel.value) { alert("เลือกเหตุผล Reject ก่อน"); return; }
    const reason = reasonSel.value === "อื่นๆ (ระบุ)" ? reasonTxt.value.trim() || "อื่นๆ" : reasonSel.value + (reasonTxt.value.trim() ? ": " + reasonTxt.value.trim() : "");
    setVerdict(r, item, "reject", reason, im.canvas); refresh();
  } }, "Reject");
  card.append(...[img, el("div", { class: "cap" }, el("strong", {}, item.label || item.section), ` · หน้า ${item.page} รูปที่ ${item.idx + 1} · ${im.width}×${im.height}`, pageText ? el("div", { class: "hint" }, pageText.slice(0, 160)) : null),
    item.auto ? el("div", { class: item.autoAccepted ? "hint" : "auto-note" }, "ระบบ: " + item.auto) : null,
    similarStrip(similar),
    el("div", { class: "act" }, accept, reject, reasonSel, reasonTxt), status].filter(Boolean));
  refresh();
  return card;
}

// ---------- 10. OCR screenshot ----------
const ocrCache = {}; // siteKey -> raw
async function ocrPanel(r, wrap) {
  const status = el("p", { class: "hint ocr-status" }, "กำลังเตรียม OCR…");
  wrap.append(status);
  const att = files.find((x) => x.name === r.site.attFile);
  const satp = files.find((x) => x.name === r.site.satpFile);
  if (!att && !satp) { status.textContent = "ไม่พบไฟล์ของไซต์นี้ในรายการที่โหลด"; return wrap; }
  try {
    let ocr = ocrCache[r.site.key];
    if (!ocr) { ocr = await ocrSite(pdfjs, r, att?.bytes, satp?.bytes, (s) => { status.textContent = s; }); ocrCache[r.site.key] = ocr; }
    const found = ocrChecks(ocr, r.site, r.facts);
    r.issues = r.issues.filter((i) => !i.ocr).concat(found);
    r.issues.sort((a, b) => (a.level || 9) - (b.level || 9));
    r.summary = summarize(r.issues);
    status.textContent = `OCR เสร็จ: อ่าน ${ocr.raw.length} รูป พบประเด็น ${found.filter((i) => i.severity !== "info").length} ข้อ (เพิ่มเข้าแท็บ "ประเด็น" และ Excel แล้ว)`;
    renderSummaryRow(r);
    const t = el("table", { class: "tbl" }, el("tr", {}, ...["ผล", "Section", "หน้า", "ประเด็น"].map((h) => el("th", {}, h))));
    for (const i of found) t.append(el("tr", {}, el("td", {}, el("span", { class: "pill " + (i.severity === "fail" ? "fail" : i.severity) }, i.severity === "warn" ? "เตือน" : "ข้อมูล")), el("td", {}, i.section), el("td", {}, i.page ?? ""), el("td", { class: "msg" }, i.msg)));
    wrap.append(t, el("h3", {}, "ข้อความที่ OCR อ่านได้ (ตัดสั้น)"));
    const raw = el("table", { class: "tbl" }, el("tr", {}, ...["เอกสาร", "ส่วน", "หน้า", "ความมั่นใจ", "ข้อความ"].map((h) => el("th", {}, h))));
    for (const x of ocr.raw) raw.append(el("tr", {}, el("td", {}, x.doc), el("td", {}, x.section), el("td", {}, x.page), el("td", {}, Math.round(x.confidence) + "%"), el("td", { class: "msg hint" }, x.text.replace(/\s+/g, " ").slice(0, 300))));
    wrap.append(raw);
  } catch (e) { status.textContent = "OCR ผิดพลาด: " + e.message; console.error(e); }
  return wrap;
}
function renderSummaryRow(r) {
  const rows = [...$("#summary").querySelectorAll("tr.clickable")];
  const row = rows.find((tr) => tr.children[1].textContent === r.site.folder && tr.children[0].textContent === r.facts.code);
  if (!row) return;
  row.children[9].replaceChildren(pill(r.summary.status)); row.children[10].textContent = r.summary.fail; row.children[11].textContent = r.summary.warn;
}

// ---------- ฐานความรู้ ----------
async function renderKb() {
  const box = $("#kb"); if (!box) return;
  const st = await kbStats();
  const head = el("p", {}, `การตัดสินใจประเด็น ${st.decisions} · โปรไฟล์ที่เรียนรู้ ${st.profiles} · รูปอ้างอิง ${st.refImages} (จากไซต์ตัวอย่าง/ลูกค้าเซ็นแล้ว ${st.signedRefs} รูป / ${st.signedSites} ไซต์) · รูปที่เคยตัดสิน ${st.imageDecisions}`);
  const dt = el("table", { class: "tbl" }, el("tr", {}, ...["กฎ", "Section", "ตัดสินใจ", "เหตุผล", "ตัวอย่างประเด็น", "โดย", "เมื่อ", "ครั้ง", ""].map((h) => el("th", {}, h))));
  for (const d of kb.decisions.slice().reverse().slice(0, 30)) dt.append(el("tr", {}, el("td", {}, d.rule), el("td", {}, d.section), el("td", {}, el("span", { class: "pill " + (d.decision === "accept" ? "ok" : "warn") }, d.decision === "accept" ? "ยอมรับ" : "ยืนยันปัญหา")), el("td", {}, d.reason), el("td", { class: "hint msg" }, d.example), el("td", {}, d.by), el("td", {}, d.at), el("td", {}, d.count || 1), el("td", {}, el("button", { class: "btn small", onclick: () => { deleteDecisionRecord(d); renderKb(); } }, "ลบ"))));
  const pt = el("table", { class: "tbl" }, el("tr", {}, ...["โปรไฟล์", "ชื่อ", "ตัวอย่าง", "ไซต์", "โดย", ""].map((h) => el("th", {}, h))));
  for (const p of kb.profiles) pt.append(el("tr", {}, el("td", {}, p.id), el("td", {}, p.name), el("td", {}, p.samples), el("td", {}, (p.sites || []).join(", ")), el("td", {}, `${p.by || ""} ${p.at || ""}`), el("td", {}, el("button", { class: "btn small", onclick: () => { forgetProfile(p.id); setLearnedProfiles(kb.profiles); renderKb(); } }, "ลบ"))));
  const exp = el("button", { class: "btn", onclick: async () => { const blob = new Blob([await exportKb()], { type: "application/json" }); const a = el("a", { href: URL.createObjectURL(blob), download: `satp_knowledge_${new Date().toISOString().slice(0, 10)}.json` }); a.click(); } }, "ส่งออกฐานความรู้ (JSON)");
  const clr = el("button", { class: "btn small danger", onclick: async () => { if (!confirm("ล้างฐานความรู้ทั้งหมด (การตัดสินใจ, โปรไฟล์ที่เรียนรู้, รูปอ้างอิง)? แนะนำให้ส่งออกก่อน")) return; kb.decisions = []; kb.profiles = []; kb.imageDecisions = []; localStorage.setItem("satp:kb", JSON.stringify(kb)); await new Promise((res) => { const req = indexedDB.deleteDatabase("satp-kb"); req.onsuccess = req.onerror = req.onblocked = () => res(); }); setLearnedProfiles([]); renderKb(); } }, "ล้างฐานความรู้");
  const imp = el("label", { class: "btn" }, "นำเข้าฐานความรู้", el("input", { type: "file", accept: ".json", hidden: "", onchange: async (e) => { const f = e.target.files[0]; if (!f) return; const m = await importKb(await f.text()); setLearnedProfiles(kb.profiles); alert(`นำเข้าแล้ว ${m.added} รายการ`); renderKb(); } }));
  const up = cloud.ready ? el("button", { class: "btn small", onclick: async (e) => { if (!confirm("ส่งฐานความรู้ในเครื่องนี้ทั้งหมดขึ้นคลาวด์ของทีม? (รายการที่มีอยู่แล้วจะถูกเขียนทับด้วยของเครื่องนี้)")) return; e.target.disabled = true; const n = await uploadLocalToCloud((t) => { e.target.textContent = t; }); e.target.textContent = `อัปโหลดแล้ว ${n} รายการ`; } }, "อัปโหลดฐานความรู้ในเครื่องขึ้นคลาวด์") : null;
  const note = cloud.ready ? "ฐานความรู้ซิงก์กับคลาวด์ของทีม — ทุกการตัดสินใจและรูปอ้างอิงใหม่ขึ้นคลาวด์ทันที ปุ่มล้างมีผลเฉพาะเครื่องนี้" : cloud.enabled ? "เชื่อมต่อฐานความรู้ทีมไม่ได้ — ข้อมูลอยู่ในเครื่องนี้ (กดซิงก์ที่แถบด้านบนเมื่อออนไลน์)" : "ฐานความรู้อยู่ในเบราว์เซอร์เครื่องนี้ — ส่งออกไฟล์ให้ทีมนำเข้าเพื่อใช้ร่วมกัน (ไม่มีข้อมูลเอกสาร มีแต่ลายเซ็นประเด็น, รูปย่อที่ Accept และค่าที่วัด)";
  box.replaceChildren(head, el("div", { class: "row" }, exp, imp, up, clr, el("span", { class: "hint" }, note)),
    el("h3", {}, "การตัดสินใจประเด็น (ล่าสุด 30)"), dt, el("h3", {}, "โปรไฟล์ที่เรียนรู้จาก ROM"), pt.children.length > 1 ? pt : el("p", { class: "hint" }, "ยังไม่มี — ไซต์ที่ไม่ตรงโปรไฟล์ P1–P5 จะมีปุ่ม 'ROM ยืนยัน: ใช้ไซต์นี้เป็นอ้างอิง'"));
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
  t.replaceChildren(el("tr", {}, ...["เมื่อ", "ไซต์", "โฟลเดอร์", "Project / Link", "DWDM Model", "ชนิดโหนด", "โปรไฟล์", "สถานะ", "ไม่ผ่าน", "เตือน", ""].map((x) => el("th", {}, x))));
  h.slice(0, 50).forEach((x, i) => t.append(el("tr", {}, el("td", {}, x.when), el("td", {}, x.code), el("td", {}, x.folder), el("td", {}, x.project || ""), el("td", {}, x.model || ""), el("td", {}, x.kind || ""), el("td", {}, x.profile), el("td", {}, pill(x.status)), el("td", {}, x.fail), el("td", {}, x.warn),
    el("td", {}, el("button", { class: "btn small", title: "ลบรายการนี้", onclick: () => { h.splice(i, 1); localStorage.setItem("satp:history", JSON.stringify(h)); renderHistory(); } }, "ลบ")))));
  if (!h.length) t.append(el("tr", {}, el("td", { colspan: 11, class: "hint" }, "ยังไม่มีประวัติ")));
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
