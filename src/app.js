// หน้าเว็บหลัก — ทุกอย่างทำในเบราว์เซอร์ ไม่มี request ส่งไฟล์ออกไป
import { analyzeFiles, DEFAULT_CRITERIA } from "./engine/index.js";
import { MASTERFILE_DATE, SITES } from "./data/sites.js";
import { buildWorkbook, reviewStats } from "./ui/report.js";
import { pageImageCanvases, aHash, hamming, blurScore, thumb } from "./ui/images.js";
import { ocrSite } from "./ui/ocr.js";
import { ocrChecks } from "./engine/ocrRules.js";
import { summarize } from "./engine/rules.js";
import { setLearnedProfiles } from "./engine/profiles.js";
import { kb, applyDecisions, recordDecision, forgetDecision, learnProfile, forgetProfile, addRefImage, refImagesFor, removeRefImage, recordImageDecision, findImageDecision, exportKb, importKb, kbStats } from "./ui/learn.js";

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
  pdfjs = await import(PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  setupDrop();
  renderCriteria();
  renderHistory();
  $("#run").addEventListener("click", runCheck);

  $("#clear").addEventListener("click", () => { files = []; renderFileList(); });
  $("#toggle-criteria").addEventListener("click", () => { $("#criteria").hidden = !$("#criteria").hidden; });
  $("#export").addEventListener("click", exportExcel);
  $("#clear-history").addEventListener("click", () => { if (confirm("ล้างประวัติการตรวจทั้งหมดในเบราว์เซอร์นี้?")) { localStorage.removeItem("satp:history"); renderHistory(); } });
  $("#clear-reviews").addEventListener("click", () => { if (!confirm("ล้างผล Accept/Reject ของทุกไซต์ในเบราว์เซอร์นี้? (รูปอ้างอิงในฐานความรู้ยังอยู่)")) return; for (const k of Object.keys(localStorage)) if (k.startsWith("satp:review:")) localStorage.removeItem(k); for (const k of Object.keys(reviews)) delete reviews[k]; if (run) { for (const r of run.results) reviews[r.site.key] = { items: [] }; renderResults(); } });
  $("#clear-all").addEventListener("click", async () => {
    if (!confirm("ล้างข้อมูลทั้งหมดในเบราว์เซอร์นี้: ประวัติ, ผลตรวจรูป, ฐานความรู้ (การตัดสินใจ/โปรไฟล์ที่เรียนรู้/รูปอ้างอิง), เกณฑ์ที่แก้ไว้, ชื่อผู้ตรวจ? แนะนำให้กด 'ส่งออกฐานความรู้' ก่อน")) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith("satp:")) localStorage.removeItem(k);
    await new Promise((res) => { const req = indexedDB.deleteDatabase("satp-kb"); req.onsuccess = req.onerror = req.onblocked = () => res(); });
    location.reload();
  });
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
      return [f === "max" ? " – " : f === "minDistanceKm" ? " เมื่อระยะ ≥ " : "", inp];
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
      el("td", {}, r.summary.fail), el("td", {}, r.summary.warn), el("td", { id: "rv-" + cssId(r.site.key) }, `${rv.accept} / ${rv.reject} / ${rv.pending}`));
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
  const tabReview = el("button", { onclick: async () => { activate(tabReview); body.replaceChildren(el("p", { class: "hint" }, "กำลังดึงรูปจาก Attachment…")); body.replaceChildren(await reviewPanel(r)); } }, "ตรวจรูป (Accept/Reject)");
  const tabOcr = el("button", { onclick: () => { activate(tabOcr); const wrap = el("div", {}); body.replaceChildren(wrap); ocrPanel(r, wrap); } }, "OCR screenshot");
  const activate = (b) => { for (const x of tabs.children) x.classList.toggle("active", x === b); };
  tabs.append(tabIssues, tabReview, tabOcr);
  box.replaceChildren(el("div", { class: "detail" }, el("h3", {}, `${facts.code} — ${r.site.folder}`, " ", pill(r.summary.status)), head, tabs, body));
  body.append(issuesTable(r));
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function issuesTable(r) {
  const LV = { 0: "-", 1: "1 ครบถ้วน", 2: "2 สอดคล้อง", 3: "3 ค่าเทคนิค" };
  const t = el("table", { class: "tbl issues" }, el("tr", {}, ...["ระดับ", "ผล", "กฎ", "Section", "หน้า", "ประเด็น", "ใครตรวจต่อ", "การตัดสินใจ ROM"].map((h) => el("th", {}, h))));
  const refresh = () => { applyDecisions(r); r.summary = summarize(r.issues); renderSummaryRow(r); t.replaceWith(issuesTable(r)); };
  for (const i of r.issues) {
    const needsHuman = !(i.severity === "fail" && i.who === "ระบบ") && i.rule !== "P00" && !r.facts.customerAccepted;
    let cell;
    if (i.learned) {
      cell = el("td", {}, el("span", { class: "pill " + (i.learned.decision === "accept" ? "ok" : "warn") }, i.learned.decision === "accept" ? "ยอมรับแล้ว" : "ยืนยันปัญหา"), ` ${i.learned.by || ""} ${i.learned.at}`, i.learned.reason ? ` — ${i.learned.reason}` : "", " ", el("button", { class: "btn small", onclick: () => { forgetDecision(i, r.facts); refresh(); renderKb(); } }, "ลบ"));
    } else if (needsHuman) {
      const reason = el("input", { type: "text", placeholder: "เหตุผล (ถ้ามี)", size: "14" });
      const go = (d) => { recordDecision(i, r.facts, d, reason.value.trim(), $("#reviewer").value.trim()); refresh(); renderKb(); };
      cell = el("td", {}, el("button", { class: "btn small", onclick: () => go("accept") }, "ยอมรับ"), " ", el("button", { class: "btn small", onclick: () => go("confirm") }, "ยืนยันปัญหา"), " ", reason);
    } else cell = el("td", { class: "hint" }, "ระบบยืนยันได้เอง");
    t.append(el("tr", {}, el("td", {}, LV[i.level]), el("td", {}, el("span", { class: "pill " + (i.severity === "fail" ? "fail" : i.severity) }, i.severity === "fail" ? "ไม่ผ่าน" : i.severity === "warn" ? "เตือน" : "ข้อมูล"), i.origSeverity ? el("div", { class: "hint" }, `(เดิม ${i.origSeverity})`) : null), el("td", {}, i.rule), el("td", {}, i.section), el("td", {}, i.page ?? ""), el("td", { class: "msg" }, i.msg), el("td", {}, i.who), cell));
  }
  return t;
}

// ---------- 10/11. ตรวจรูป ----------
const REVIEW_SECTIONS = [["1.8", "1.8 Visual Inspection"], ["1.4", "1.4 Inventory"], ["1.5", "1.5 Power"], ["1.6", "1.6 Ground"], ["1.9", "1.9 NE Setup"], ["1.15", "1.15 Fiber Scope"]];

function reviewKey(r) { return `satp:review:${r.site.key}:${r.site.attFile}`; }
function loadReview(r) { try { return JSON.parse(localStorage.getItem(reviewKey(r)) || "null") || { items: [] }; } catch { return { items: [] }; } }
function saveReview(r) { localStorage.setItem(reviewKey(r), JSON.stringify(reviews[r.site.key])); const c = $("#rv-" + cssId(r.site.key)); if (c) { const s = reviewStats(reviews[r.site.key]); c.textContent = `${s.accept} / ${s.reject} / ${s.pending}`; } }

const hashCache = {}; // `${site}|${page}|${idx}` -> hash

async function reviewPanel(r) {
  const A = r.site.att;
  if (!A) return el("p", {}, "ไม่มี Attachment Report");
  const f = files.find((x) => x.name === r.site.attFile);
  if (!f) return el("p", {}, "ไม่พบไฟล์ Attachment ในรายการที่โหลด");
  const doc = await pdfjs.getDocument({ data: f.bytes.slice(), verbosity: 0 }).promise;
  const secs = Object.entries(A.sections).sort((a, b) => a[1] - b[1]);
  const rangeOf = (sec) => { const i = secs.findIndex((s) => s[0] === sec); if (i < 0) return null; return [secs[i][1], i + 1 < secs.length ? secs[i + 1][1] - 1 : doc.numPages]; };
  const rv = reviews[r.site.key];
  const wrap = el("div", {});
  const seen = rv.items.length > 0;
  const grid = el("div", { class: "review-grid" });
  let idxAll = 0;
  for (const [sec, label] of REVIEW_SECTIONS) {
    const range = rangeOf(sec);
    if (!range) continue;
    wrap.append(el("h3", {}, label));
    const refs = await refImagesFor(r.facts.profile || "L:" + r.facts.nearestProfile, label);
    if (refs.length) wrap.append(el("div", { class: "ref-strip" }, el("span", { class: "hint" }, "รูปอ้างอิงที่ ROM เคย Accept: "), ...refs.map((x) => el("span", { class: "ref-item" }, el("img", { src: x.thumb, title: `${x.site} หน้า ${x.page} · ${x.by || ""} ${x.at}` }), el("button", { class: "btn small", onclick: async (e) => { await removeRefImage(x.id); e.target.parentElement.remove(); renderKb(); } }, "×")))));
    const g = el("div", { class: "review-grid" });
    for (let p = range[0]; p <= range[1]; p++) {
      const page = await doc.getPage(p);
      const caps = (A.pages?.[p - 1]?.text) || "";
      const imgs = await pageImageCanvases(page);
      const pageText = (r.site.pagesAtt?.[p - 1]?.lines || []).filter((l) => /^\([a-g]\)|^Name:|SHELF|Power [AB]|Rack to|Shelf to/i.test(l)).join(" · ");
      imgs.forEach((im, idx) => {
        const key = `${r.site.key}|${p}|${idx}`;
        const h = hashCache[key]?.h || (hashCache[key] = { h: aHash(im.canvas), w: im.width, hh: im.height }).h;
        const blur = blurScore(im.canvas);
        let item = rv.items.find((x) => x.page === p && x.idx === idx);
        if (!item) { item = { section: label, page: p, idx, verdict: "", reason: "", by: "", at: "", hash: h }; rv.items.push(item); }
        item.hash = h;
        const auto = [];
        // รูปซ้ำ = ขนาดพิกเซลเท่ากันและ hash ต่างไม่เกิน 4/256 บิต (ไม่นับรูปเดียวกันที่ถูกวางซ้ำในหน้าเดียว)
        for (const [k2, v2] of Object.entries(hashCache)) if (k2 !== key && v2.w === im.width && v2.hh === im.height && k2.split("|").slice(0, 2).join("|") !== `${r.site.key}|${p}` && hamming(h, v2.h) <= 4) auto.push(`เหมือนรูป ${k2.split("|")[0]} หน้า ${k2.split("|")[1]}`);
        if (blur < 15) auto.push(`ภาพอาจเบลอ (คมชัด ${blur.toFixed(0)})`);
        const prev = findImageDecision(h);
        if (prev && prev.verdict === "reject") auto.push(`รูปนี้เคยถูก Reject ที่ ${prev.site}: ${prev.reason} (${prev.by || ""})`);
        item.auto = auto.join("; ");
        g.append(reviewCard(r, item, im, pageText));
      });
      page.cleanup();
    }
    wrap.append(g);
  }
  if (!rv.items.length) wrap.append(el("p", {}, "ไม่พบรูปใน Attachment"));
  saveReview(r);
  await doc.destroy();
  const bulk = el("div", { class: "row" },
    el("button", { class: "btn small", onclick: () => { for (const it of rv.items) if (!it.verdict) setVerdict(r, it, "accept"); wrap.querySelectorAll(".review-item").forEach((c) => c.dispatchEvent(new Event("refresh"))); } }, "Accept ที่เหลือทั้งหมด"),
    el("span", { class: "hint" }, "ไซต์จะ 'ผ่าน' ส่วนรูปเมื่อทุกรูปถูก Accept — Reject ต้องระบุเหตุผล"));
  wrap.prepend(bulk);
  return wrap;
}

function setVerdict(r, item, v, reason, canvas) {
  item.verdict = v; item.reason = v === "reject" ? reason || item.reason : "";
  item.by = $("#reviewer").value.trim(); item.at = new Date().toLocaleString("th-TH");
  saveReview(r);
  // เรียนรู้: Accept → เก็บเป็นรูปอ้างอิงของ (โปรไฟล์ × section) · Reject → จำ hash + เหตุผล
  const profileKey = r.facts.profile || "L:" + r.facts.nearestProfile;
  if (v === "accept" && canvas) addRefImage({ profile: profileKey, section: item.section, site: r.facts.code, page: item.page, thumb: thumb(canvas, 320), hash: item.hash, by: item.by }).then(renderKb);
  recordImageDecision({ hash: item.hash, verdict: v, reason: item.reason, site: r.facts.code, section: item.section, by: item.by });
  renderKb();
}

function reviewCard(r, item, im, pageText) {
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
  card.append(img, el("div", { class: "cap" }, `หน้า ${item.page} รูปที่ ${item.idx + 1} · ${im.width}×${im.height}`, pageText ? el("div", { class: "hint" }, pageText.slice(0, 160)) : null),
    item.auto ? el("div", { class: "auto-note" }, "ระบบ: " + item.auto) : null,
    el("div", { class: "act" }, accept, reject, reasonSel, reasonTxt), status);
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
  const head = el("p", {}, `การตัดสินใจประเด็น ${st.decisions} · โปรไฟล์ที่เรียนรู้ ${st.profiles} · รูปอ้างอิง ${st.refImages} · รูปที่เคยตัดสิน ${st.imageDecisions}`);
  const dt = el("table", { class: "tbl" }, el("tr", {}, ...["กฎ", "Section", "ตัดสินใจ", "เหตุผล", "ตัวอย่างประเด็น", "โดย", "เมื่อ", "ครั้ง", ""].map((h) => el("th", {}, h))));
  for (const d of kb.decisions.slice().reverse().slice(0, 30)) dt.append(el("tr", {}, el("td", {}, d.rule), el("td", {}, d.section), el("td", {}, el("span", { class: "pill " + (d.decision === "accept" ? "ok" : "warn") }, d.decision === "accept" ? "ยอมรับ" : "ยืนยันปัญหา")), el("td", {}, d.reason), el("td", { class: "hint msg" }, d.example), el("td", {}, d.by), el("td", {}, d.at), el("td", {}, d.count || 1), el("td", {}, el("button", { class: "btn small", onclick: () => { kb.decisions = kb.decisions.filter((x) => x !== d); localStorage.setItem("satp:kb", JSON.stringify(kb)); renderKb(); } }, "ลบ"))));
  const pt = el("table", { class: "tbl" }, el("tr", {}, ...["โปรไฟล์", "ชื่อ", "ตัวอย่าง", "ไซต์", "โดย", ""].map((h) => el("th", {}, h))));
  for (const p of kb.profiles) pt.append(el("tr", {}, el("td", {}, p.id), el("td", {}, p.name), el("td", {}, p.samples), el("td", {}, (p.sites || []).join(", ")), el("td", {}, `${p.by || ""} ${p.at || ""}`), el("td", {}, el("button", { class: "btn small", onclick: () => { forgetProfile(p.id); setLearnedProfiles(kb.profiles); renderKb(); } }, "ลบ"))));
  const exp = el("button", { class: "btn", onclick: async () => { const blob = new Blob([await exportKb()], { type: "application/json" }); const a = el("a", { href: URL.createObjectURL(blob), download: `satp_knowledge_${new Date().toISOString().slice(0, 10)}.json` }); a.click(); } }, "ส่งออกฐานความรู้ (JSON)");
  const clr = el("button", { class: "btn small danger", onclick: async () => { if (!confirm("ล้างฐานความรู้ทั้งหมด (การตัดสินใจ, โปรไฟล์ที่เรียนรู้, รูปอ้างอิง)? แนะนำให้ส่งออกก่อน")) return; kb.decisions = []; kb.profiles = []; kb.imageDecisions = []; localStorage.setItem("satp:kb", JSON.stringify(kb)); await new Promise((res) => { const req = indexedDB.deleteDatabase("satp-kb"); req.onsuccess = req.onerror = req.onblocked = () => res(); }); setLearnedProfiles([]); renderKb(); } }, "ล้างฐานความรู้");
  const imp = el("label", { class: "btn" }, "นำเข้าฐานความรู้", el("input", { type: "file", accept: ".json", hidden: "", onchange: async (e) => { const f = e.target.files[0]; if (!f) return; const m = await importKb(await f.text()); setLearnedProfiles(kb.profiles); alert(`นำเข้าแล้ว ${m.added} รายการ`); renderKb(); } }));
  box.replaceChildren(head, el("div", { class: "row" }, exp, imp, clr, el("span", { class: "hint" }, "ฐานความรู้อยู่ในเบราว์เซอร์เครื่องนี้ — ส่งออกไฟล์ให้ทีมนำเข้าเพื่อใช้ร่วมกัน (ไม่มีข้อมูลเอกสาร มีแต่ลายเซ็นประเด็น, รูปย่อที่ Accept และค่าที่วัด)")),
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
    runCheck, get result() { return run; }, files: () => files, reviews, ocrCache, wb: () => buildWorkbook(run.results, reviews, { when: run.when, reviewer: "", version: VERSION }),
  };
}
