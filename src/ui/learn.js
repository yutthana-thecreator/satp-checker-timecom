// ฐานความรู้จากการตัดสินใจของคน (ROM) — เก็บในเครื่อง (localStorage + IndexedDB) ส่งออก/นำเข้าเป็นไฟล์ JSON เพื่อแชร์ในทีม
// 1) decisions: ประเด็นที่ระบบตัดสินไม่ได้ → ROM กด "ยอมรับ" / "ยืนยันปัญหา" → ครั้งต่อไปประเด็นแบบเดียวกันถูกติดป้ายอัตโนมัติ
// 2) profiles: ไซต์ที่ไม่ตรงโปรไฟล์ใด → ROM ยืนยันว่าเอกสารถูกต้อง → บันทึกเป็นโปรไฟล์อ้างอิงใหม่ (L1, L2, …)
// 3) refImages: รูปที่ ROM กด Accept → เป็นรูปตัวอย่างของ (โปรไฟล์ × section) แสดงเทียบข้างรูปใหม่ · รูปที่ Reject → จำ hash ไว้เตือน

import { cloud, pushRow, deleteRow, pullAll, pushRefImage, deleteRefImage as cloudDeleteRef, downloadThumb } from "./cloud.js";

const KEY = "satp:kb";
const DB = "satp-kb", STORE = "refimg";

export const kb = load();

function load() {
  const empty = () => ({ version: 2, decisions: [], profiles: [], imageDecisions: [], sectionStats: {} });
  try { return Object.assign(empty(), JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return empty(); }
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
  pushRow("issue_decisions", sig, d);
  return d;
}

export function forgetDecision(issue, facts) {
  const sig = issueSignature(issue, facts);
  kb.decisions = kb.decisions.filter((d) => d.sig !== sig);
  saveKb();
  deleteRow("issue_decisions", sig);
}
export function deleteDecisionRecord(d) { kb.decisions = kb.decisions.filter((x) => x !== d); saveKb(); deleteRow("issue_decisions", d.sig); }

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
    saveKb(); pushRow("learned_profiles", matchKey(existing.match), existing); return existing;
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
  pushRow("learned_profiles", matchKey(p.match), p);
  return p;
}
const matchKey = (m) => "M:" + JSON.stringify([m.nodeType, m.power, m.project || "", Object.entries(m.shelves || {}).sort(), [...(m.modules || [])].sort(), m.degrees]);
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
export function forgetProfile(id) { const p = kb.profiles.find((x) => x.id === id); kb.profiles = kb.profiles.filter((x) => x.id !== id); saveKb(); if (p) deleteRow("learned_profiles", matchKey(p.match)); }

// ---------- รูปอ้างอิง (IndexedDB) ----------
function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const st = db.objectStoreNames.contains(STORE) ? req.transaction.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: "id" });
      if (!st.indexNames.contains("profile")) st.createIndex("profile", "profile");
    };
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
function tx(mode, fn) {
  return idb().then((db) => new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const out = fn(s); t.oncomplete = () => res(out.result ?? out); t.onerror = () => rej(t.error); }));
}
// รูปอ้างอิงต่อ (โปรไฟล์ × หัวข้อ): source "signed" = จากไซต์ที่ลูกค้าเซ็นแล้ว (เก็บทั้งหมด) · "rom" = ROM กด Accept (เก็บล่าสุด MAX_ROM_REF รูป)
const MAX_ROM_REF = 3;
export const topicOf = (section, topic) => (topic ? `${section} ${topic}` : section);
// id = profile|topicKey|hash → ตรวจซ้ำจาก key อย่างเดียว ไม่ต้องอ่านรูปย่อทั้งหมด
export const listRefKeys = () => tx("readonly", (s) => s.getAllKeys()).then((r) => r || []);
const sameImage = (keys, profile, hash) => keys.some((k) => k.startsWith(profile + "|") && k.endsWith("|" + hash));
export const isReferenceSource = (src) => src === "signed" || src === "sample";
export async function addRefImage({ profile, section, topic, site, page, thumb, hash, by, source = "rom" }, keys = null) {
  keys = keys || (await listRefKeys());
  const key = topicOf(section, topic);
  if (sameImage(keys, profile, hash)) return null;
  if (source === "rom") {
    const same = (await listRefImages()).filter((x) => x.profile === profile && topicOf(x.section, x.topic) === key && (x.source || "rom") === "rom").sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (same.length >= MAX_ROM_REF) await tx("readwrite", (s) => s.delete(same[0].id));
  }
  const rec = { id: `${profile}|${key}|${hash}`, profile, section, topic: topic || "", site, page, thumb, hash, by, source, at: new Date().toLocaleString("th-TH"), ts: Date.now() };
  await tx("readwrite", (s) => s.put(rec));
  keys.push(rec.id);
  if (metaCache) metaCache.push({ id: rec.id, profile, site, source });
  await pushRefImage(rec);
  return rec;
}
export function listRefImages() { return tx("readonly", (s) => s.getAll()).then((r) => r || []); }
export async function removeRefImage(id) { const rec = await tx("readonly", (s) => s.get(id)); await tx("readwrite", (s) => s.delete(id)); metaCache = null; if (rec) cloudDeleteRef(rec); }
export async function refImagesFor(profile, section, topic) { const key = topicOf(section, topic); return (await listRefImages()).filter((x) => x.profile === profile && topicOf(x.section, x.topic) === key); }
export async function refImagesForProfile(profile) { return tx("readonly", (s) => s.index("profile").getAll(profile)).then((r) => r || []); }
// ข้อมูลย่อของรูปอ้างอิง (ไม่รวมรูปย่อ) สำหรับสถิติ — cache ในหน่วยความจำ ล้างเมื่อมีการเพิ่ม/ลบ/ซิงก์
let metaCache = null;
export const invalidateRefMeta = () => { metaCache = null; };
async function refMeta() { if (!metaCache) metaCache = (await listRefImages()).map((x) => ({ id: x.id, profile: x.profile, site: x.site, source: x.source })); return metaCache; }

// ---------- สถิติจำนวนรูปต่อ (โปรไฟล์ × หัวข้อ) จากไซต์ที่ลูกค้าเซ็นแล้ว ----------
export function recordSectionCount(profile, section, topic, site, n) {
  const key = `${profile}|${topicOf(section, topic)}`;
  const st = kb.sectionStats[key] || (kb.sectionStats[key] = { profile, section, topic: topic || "", sites: {} });
  st.sites[site] = n;
  saveKb();
  pushRow("section_stats", key, st);
}
export function expectedCount(profile, section, topic) {
  const st = kb.sectionStats[`${profile}|${topicOf(section, topic)}`];
  if (!st) return null;
  const ns = Object.values(st.sites).sort((a, b) => a - b);
  if (!ns.length) return null;
  return { median: ns[Math.floor(ns.length / 2)], min: ns[0], max: ns[ns.length - 1], sites: ns.length };
}

export function recordImageDecision({ hash, verdict, reason, site, section, by }) {
  kb.imageDecisions = kb.imageDecisions.filter((d) => d.hash !== hash);
  const d = { hash, verdict, reason: reason || "", site, section, by: by || "", at: new Date().toLocaleString("th-TH") };
  kb.imageDecisions.push(d);
  saveKb();
  pushRow("image_decisions", hash, d);
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
  metaCache = null;
  for (const [k, st] of Object.entries(data.sectionStats || {})) { const cur = kb.sectionStats[k] || (kb.sectionStats[k] = { ...st, sites: {} }); Object.assign(cur.sites, st.sites); merged.added++; }
  saveKb();
  return merged;
}
export async function kbStats() {
  const meta = await refMeta();
  const ref = meta.filter((x) => isReferenceSource(x.source));
  return { decisions: kb.decisions.length, profiles: kb.profiles.length, imageDecisions: kb.imageDecisions.length, refImages: meta.length, signedRefs: ref.length, signedSites: new Set(ref.map((x) => x.site)).size };
}

// ---------- ซิงก์กับฐานความรู้ร่วมของทีม (Supabase) ----------
// ดึงจากคลาวด์มารวมกับในเครื่อง (คลาวด์ชนะเมื่อ key ซ้ำ) · รูปย่อที่ยังไม่มีในเครื่องจะถูกดาวน์โหลดครั้งเดียวแล้วเก็บใน IndexedDB
export async function syncFromCloud(onProgress = () => {}) {
  if (!cloud.ready) return null;
  const c = await pullAll();
  if (!c) return null;
  const n = { decisions: 0, profiles: 0, imageDecisions: 0, refImages: 0, sectionStats: 0 };
  for (const d of c.issue_decisions) { const i = kb.decisions.findIndex((x) => x.sig === d.sig); if (i >= 0) kb.decisions[i] = strip(d); else kb.decisions.push(strip(d)); n.decisions++; }
  for (const d of c.image_decisions) { kb.imageDecisions = kb.imageDecisions.filter((x) => x.hash !== d.hash); kb.imageDecisions.push(strip(d)); n.imageDecisions++; }
  for (const p of c.learned_profiles) { const i = kb.profiles.findIndex((x) => matchKey(x.match) === p.key); const rec = strip(p); if (i >= 0) { rec.id = kb.profiles[i].id; kb.profiles[i] = rec; } else { rec.id = "L" + (kb.profiles.length + 1); kb.profiles.push(rec); } n.profiles++; }
  for (const st of c.section_stats) { kb.sectionStats[st.key] = strip(st); n.sectionStats++; }
  saveKb();
  const localKeys = new Set(await listRefKeys());
  const todo = c.ref_images.filter((r) => !localKeys.has(r.key));
  let done = 0;
  // ดาวน์โหลดรูปย่อขนานกัน 6 รูป
  const queue = todo.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const r = queue.shift();
      try { const thumb = await downloadThumb(r.thumb_path); await tx("readwrite", (s) => s.put({ ...strip(r), id: r.key, thumb })); n.refImages++; } catch (e) { console.warn("thumb", r.key, e?.message || e); }
      onProgress(`ดาวน์โหลดรูปอ้างอิง ${++done}/${todo.length}`);
    }
  }));
  if (todo.length) metaCache = null;
  return n;
}
const strip = ({ key, ...rest }) => rest;
// ส่งของที่มีในเครื่องขึ้นคลาวด์ทั้งหมด (ใช้ครั้งแรกเพื่อย้ายฐานความรู้เดิม)
export async function uploadLocalToCloud(onProgress = () => {}) {
  if (!cloud.ready) return null;
  let n = 0;
  for (const d of kb.decisions) { await pushRow("issue_decisions", d.sig, d); n++; }
  for (const d of kb.imageDecisions) { await pushRow("image_decisions", d.hash, d); n++; }
  for (const p of kb.profiles) { await pushRow("learned_profiles", matchKey(p.match), p); n++; }
  for (const [k, st] of Object.entries(kb.sectionStats)) { await pushRow("section_stats", k, st); n++; }
  const refs = await listRefImages();
  let i = 0;
  for (const r of refs) { onProgress(`อัปโหลดรูปอ้างอิง ${++i}/${refs.length}`); if (await pushRefImage(r)) n++; }
  return n;
}
