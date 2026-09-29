// ฐานความรู้จากการตัดสินใจของคน (ROM) — เก็บในเครื่อง (localStorage + IndexedDB) ส่งออก/นำเข้าเป็นไฟล์ JSON เพื่อแชร์ในทีม
// 1) decisions: ประเด็นที่ระบบตัดสินไม่ได้ → ROM กด "ยอมรับ" / "ยืนยันปัญหา" → ครั้งต่อไปประเด็นแบบเดียวกันถูกติดป้ายอัตโนมัติ
// 2) profiles: ไซต์ที่ไม่ตรงโปรไฟล์ใด → ROM ยืนยันว่าเอกสารถูกต้อง → บันทึกเป็นโปรไฟล์อ้างอิงใหม่ (L1, L2, …)
// 3) refImages: รูปที่ ROM กด Accept → เป็นรูปตัวอย่างของ (โปรไฟล์ × section) แสดงเทียบข้างรูปใหม่ · รูปที่ Reject → จำ hash ไว้เตือน

const KEY = "satp:kb";
const DB = "satp-kb", STORE = "refimg";

export const kb = load();

function load() {
  try { return Object.assign({ version: 1, decisions: [], profiles: [], imageDecisions: [] }, JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return { version: 1, decisions: [], profiles: [], imageDecisions: [] }; }
}
export function saveKb() { localStorage.setItem(KEY, JSON.stringify(kb)); }

// ---------- ลายเซ็นประเด็น: ตัดตัวเลข/รหัสไซต์ออก ให้ประเด็น "ชนิดเดียวกัน" ได้ลายเซ็นเดียวกัน ----------
export function issueSignature(issue, facts) {
  const msg = issue.msg
    .replace(/\b[A-Z0-9]{5}(?:DCAG)?\b/g, "#SITE")
    .replace(/-?\d+(?:[.,]\d+)?/g, "#")
    .replace(/\s+/g, " ").trim().slice(0, 120);
  return `${issue.rule}|${issue.section}|${facts.nodeType || ""}|${facts.profile || "L:" + (facts.nearestProfile || "")}|${msg}`;
}

export function findDecision(issue, facts) {
  const sig = issueSignature(issue, facts);
  return kb.decisions.find((d) => d.sig === sig) || null;
}

export function recordDecision(issue, facts, decision, reason, by) {
  const sig = issueSignature(issue, facts);
  const d = { sig, decision, reason: reason || "", by: by || "", at: new Date().toLocaleString("th-TH"), rule: issue.rule, section: issue.section, example: issue.msg, site: facts.code, count: 1 };
  const i = kb.decisions.findIndex((x) => x.sig === sig);
  if (i >= 0) { d.count = (kb.decisions[i].count || 1) + 1; kb.decisions[i] = d; } else kb.decisions.push(d);
  saveKb();
  return d;
}

export function forgetDecision(issue, facts) {
  const sig = issueSignature(issue, facts);
  kb.decisions = kb.decisions.filter((d) => d.sig !== sig);
  saveKb();
}

// ใส่ผลการตัดสินใจเดิมลงในประเด็นของผลตรวจใหม่ (เรียกหลัง checkSite)
export function applyDecisions(result) {
  if (result.facts.customerAccepted) return;
  for (const i of result.issues) {
    if (i.severity === "fail" && i.who === "ระบบ") continue; // ข้อผิดที่ระบบยืนยันได้เอง ไม่ต้องเรียนรู้
    const d = findDecision(i, result.facts);
    if (!d) { delete i.learned; continue; }
    i.learned = d;
    if (d.decision === "accept") { i.origSeverity = i.origSeverity || i.severity; i.severity = "info"; }
    if (d.decision === "confirm" && i.severity === "info") { i.origSeverity = i.origSeverity || i.severity; i.severity = "warn"; }
  }
}

// ---------- โปรไฟล์ที่เรียนรู้ ----------
export function learnProfile(result, by) {
  const f = result.facts, S = result.site.satp;
  const existing = kb.profiles.find((p) => sameMatch(p.match, f));
  const vals = collectValues(S);
  if (existing) {
    existing.samples++; existing.sites.push(f.code); existing.by = by; existing.at = new Date().toLocaleString("th-TH");
    for (const k of Object.keys(vals)) existing.values[k] = (existing.values[k] || []).concat(vals[k]);
    saveKb(); return existing;
  }
  const id = "L" + (kb.profiles.length + 1);
  const p = {
    id, name: `${f.project || ""} ${f.nodeType} — ${Object.entries(f.shelves || {}).map(([t, n]) => `${t} ×${n}`).join(" + ")}, ${[...(f.modules || [])].join("/")}, ${f.degrees} ทิศ, ${f.power} (เรียนรู้จาก ROM)`,
    match: { nodeType: f.nodeType, shelves: { ...(f.shelves || {}) }, power: f.power, modules: [...(f.modules || [])], degrees: [f.degrees, f.degrees], project: f.project || undefined },
    samples: 1, sites: [f.code], values: vals, learned: true, by, at: new Date().toLocaleString("th-TH"),
    expect: { spanRows: f.degrees * 2, txRows: f.degrees, rxRows: f.degrees },
  };
  kb.profiles.push(p);
  saveKb();
  return p;
}
function sameMatch(m, f) {
  if (m.nodeType !== f.nodeType || m.power !== f.power) return false;
  if (m.project && m.project !== f.project) return false;
  const a = JSON.stringify(Object.entries(m.shelves).sort()), b = JSON.stringify(Object.entries(f.shelves || {}).sort());
  if (a !== b) return false;
  for (const mod of f.modules || []) if (!m.modules.includes(mod)) return false;
  return f.degrees >= m.degrees[0] && f.degrees <= m.degrees[1];
}
function collectValues(S) {
  const v = { power: [], ground: [], lossPerKm: [], totalLoss: [] };
  if (!S) return v;
  for (const x of [S.power?.main, S.power?.standby]) if (x != null) v.power.push(Math.abs(x));
  for (const g of [S.ground?.rackToBusbar, S.ground?.shelfToRack]) if (g?.value != null) v.ground.push(g.value);
  for (const r of S.span) if (r.distance > 0) { v.totalLoss.push(Math.abs(r.totalLoss)); v.lossPerKm.push(Math.abs(r.totalLoss) / r.distance); }
  return v;
}
export function forgetProfile(id) { kb.profiles = kb.profiles.filter((p) => p.id !== id); saveKb(); }

// ---------- รูปอ้างอิง (IndexedDB) ----------
function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
function tx(mode, fn) {
  return idb().then((db) => new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const out = fn(s); t.oncomplete = () => res(out.result ?? out); t.onerror = () => rej(t.error); }));
}
const MAX_REF = 3;
export async function addRefImage({ profile, section, site, page, thumb, hash, by }) {
  const all = await listRefImages();
  const same = all.filter((x) => x.profile === profile && x.section === section).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (same.some((x) => x.hash === hash)) return;
  if (same.length >= MAX_REF) await tx("readwrite", (s) => s.delete(same[0].id));
  const rec = { id: `${profile}|${section}|${hash}`, profile, section, site, page, thumb, hash, by, at: new Date().toLocaleString("th-TH"), ts: Date.now() };
  await tx("readwrite", (s) => s.put(rec));
}
export function listRefImages() { return tx("readonly", (s) => s.getAll()).then((r) => r || []); }
export function removeRefImage(id) { return tx("readwrite", (s) => s.delete(id)); }
export async function refImagesFor(profile, section) { return (await listRefImages()).filter((x) => x.profile === profile && x.section === section); }

export function recordImageDecision({ hash, verdict, reason, site, section, by }) {
  kb.imageDecisions = kb.imageDecisions.filter((d) => d.hash !== hash);
  kb.imageDecisions.push({ hash, verdict, reason: reason || "", site, section, by: by || "", at: new Date().toLocaleString("th-TH") });
  saveKb();
}
export function findImageDecision(hash) { return kb.imageDecisions.find((d) => d.hash === hash) || null; }

// ---------- ส่งออก / นำเข้า ----------
export async function exportKb() {
  const refImages = await listRefImages();
  return JSON.stringify({ ...kb, refImages, exportedAt: new Date().toISOString() }, null, 1);
}
export async function importKb(json) {
  const data = JSON.parse(json);
  const merged = { added: 0 };
  for (const d of data.decisions || []) if (!kb.decisions.some((x) => x.sig === d.sig)) { kb.decisions.push(d); merged.added++; }
  for (const p of data.profiles || []) if (!kb.profiles.some((x) => JSON.stringify(x.match) === JSON.stringify(p.match))) { p.id = "L" + (kb.profiles.length + 1); kb.profiles.push(p); merged.added++; }
  for (const d of data.imageDecisions || []) if (!kb.imageDecisions.some((x) => x.hash === d.hash)) { kb.imageDecisions.push(d); merged.added++; }
  for (const r of data.refImages || []) { await tx("readwrite", (s) => s.put(r)); merged.added++; }
  saveKb();
  return merged;
}
export async function kbStats() { return { decisions: kb.decisions.length, profiles: kb.profiles.length, imageDecisions: kb.imageDecisions.length, refImages: (await listRefImages()).length }; }
