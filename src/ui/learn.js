// ฐานความรู้จากการตัดสินใจของคน (ROM) — เก็บในเครื่อง (localStorage + IndexedDB) ส่งออก/นำเข้าเป็นไฟล์ JSON เพื่อแชร์ในทีม
// 1) decisions: ประเด็นที่ระบบตัดสินไม่ได้ → ROM กด "ยอมรับ" / "ยืนยันปัญหา" → ครั้งต่อไปประเด็นแบบเดียวกันถูกติดป้ายอัตโนมัติ
// 2) profiles: ไซต์ที่ไม่ตรงโปรไฟล์ใด → ROM ยืนยันว่าเอกสารถูกต้อง → บันทึกเป็นโปรไฟล์อ้างอิงใหม่ (L1, L2, …)
// 3) refImages: รูปที่ ROM กด Accept → เป็นรูปตัวอย่างของ (โปรไฟล์ × section) แสดงเทียบข้างรูปใหม่ · รูปที่ Reject → จำ hash ไว้เตือน

import { cloud, pushRow, pushRows, deleteRow, pullAll, pushRefImage, deleteRefImage as cloudDeleteRef, downloadThumb } from "./cloud.js";
import { decodeEmb } from "./embed.js";

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

// scope "all" = ใช้กับประเด็นชนิดเดียวกันทุกไซต์ (เรียนรู้) · "site" = เฉพาะไซต์นี้ (ROM ตรวจแล้วยอมรับเป็นรายกรณี ไม่เรียนรู้)
const siteSig = (issue, facts) => `S:${facts.code}|${issue.page ?? ""}|${issueSignature(issue, facts)}`;
export function findDecision(issue, facts, scope = null) {
  const sSig = siteSig(issue, facts), sig = issueSignature(issue, facts);
  if (scope !== "all") { const d = kb.decisions.find((x) => x.sig === sSig); if (d || scope === "site") return d || null; }
  return kb.decisions.find((d) => d.sig === sig) || null;
}

export function recordDecision(issue, facts, decision, reason, by, scope = "all") {
  const sig = scope === "site" ? siteSig(issue, facts) : issueSignature(issue, facts);
  const d = { sig, scope, decision, reason: reason || "", by: by || "", at: new Date().toLocaleString("th-TH"), rule: issue.rule, section: issue.section, example: issue.msg, site: facts.code, count: 1 };
  const i = kb.decisions.findIndex((x) => x.sig === sig);
  if (i >= 0) { d.count = (kb.decisions[i].count || 1) + 1; kb.decisions[i] = d; } else kb.decisions.push(d);
  saveKb();
  pushRow("issue_decisions", sig, d);
  return d;
}

export function forgetDecision(issue, facts, scope = "all") {
  const sig = scope === "site" ? siteSig(issue, facts) : issueSignature(issue, facts);
  kb.decisions = kb.decisions.filter((d) => d.sig !== sig);
  saveKb();
  deleteRow("issue_decisions", sig);
}
export function deleteDecisionRecord(d) { kb.decisions = kb.decisions.filter((x) => x !== d); saveKb(); deleteRow("issue_decisions", d.sig); }

// ใส่ผลการตัดสินใจเดิมลงในประเด็นของผลตรวจใหม่ (เรียกหลัง checkSite)
export function applyDecisions(result) {
  if (result.facts.customerAccepted) return;
  for (const i of result.issues) {
    // ข้อผิดที่ระบบยืนยันได้เอง: ไม่เรียนรู้ข้ามไซต์ แต่ ROM ยอมรับเฉพาะไซต์นี้ได้
    if (i.origSeverity) { i.severity = i.origSeverity; delete i.origSeverity; } // คืนค่าเดิมก่อนใช้การตัดสินใจล่าสุด (รองรับการยกเลิก)
    const d = findDecision(i, result.facts, i.severity === "fail" && i.who === "ระบบ" ? "site" : null);
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
  return idb().then((db) => new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }));
}
// รูปอ้างอิงต่อ (โปรไฟล์ × หัวข้อ): source "signed" = จากไซต์ที่ลูกค้าเซ็นแล้ว (เก็บทั้งหมด) · "rom" = ROM กด Accept (เก็บล่าสุด MAX_ROM_REF รูป)
const MAX_ROM_REF = 3;
export const topicOf = (section, topic) => (topic ? `${section} ${topic}` : section);
// id = profile|topicKey|hash → ตรวจซ้ำจาก key อย่างเดียว ไม่ต้องอ่านรูปย่อทั้งหมด
export const listRefKeys = () => tx("readonly", (s) => s.getAllKeys()).then((r) => r || []);
const sameImage = (keys, profile, hash) => keys.some((k) => k.startsWith(profile + "|") && k.endsWith("|" + hash));
export const isReferenceSource = (src) => src === "signed" || src === "sample";
export async function addRefImage({ profile, section, topic, site, page, thumb, hash, digest = "", by, source = "rom", emb = "" }, keys = null) {
  keys = keys || (await listRefKeys());
  const key = topicOf(section, topic);
  if (sameImage(keys, profile, hash)) return null;
  if (source === "rom") {
    const same = (await listRefImages()).filter((x) => x.profile === profile && topicOf(x.section, x.topic) === key && (x.source || "rom") === "rom").sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (same.length >= MAX_ROM_REF) await tx("readwrite", (s) => s.delete(same[0].id));
  }
  const rec = { id: `${profile}|${key}|${hash}`, profile, section, topic: topic || "", site, page, thumb, hash, digest, by, source, emb, at: new Date().toLocaleString("th-TH"), ts: Date.now() };
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
async function refMeta() { if (!metaCache) metaCache = (await listRefImages()).map((x) => ({ id: x.id, profile: x.profile, site: x.site, source: x.source, emb: !!x.emb, digest: !!x.digest })); return metaCache; }

// ---------- ลายเซ็นภาพของรูปอ้างอิง (ไม่ต้องมีรูปย่อ) ----------
// → [{id, profile, section, topic, site, page, hash, source, vec}] เฉพาะที่มี emb
export async function refVectorsForProfile(profile) {
  return (await refImagesForProfile(profile)).filter((x) => x.emb).map((x) => ({ id: x.id, profile: x.profile, section: x.section, topic: x.topic, site: x.site, page: x.page, hash: x.hash, digest: x.digest || "", source: x.source, thumb_path: x.thumb_path, vec: decodeEmb(x.emb) }));
}
// เติมลายนิ้วมือพิกเซลให้รูปอ้างอิงที่ hash ตรงกัน (โปรไฟล์เดียวกัน) แล้วส่งขึ้นคลาวด์เป็นชุด
export async function setRefDigests(profile, pairs) {
  const refs = await refImagesForProfile(profile);
  const byHash = new Map(refs.map((x) => [x.hash, x]));
  const rows = [];
  for (const { hash, digest } of pairs) { const rec = byHash.get(hash); if (!rec || rec.digest === digest) continue; rec.digest = digest; await tx("readwrite", (s) => s.put(rec)); const { thumb, ...meta } = rec; rows.push({ key: rec.id, data: meta }); }
  for (let i = 0; i < rows.length; i += 40) await pushRows("ref_images", rows.slice(i, i + 40));
  return rows.length;
}
export async function refThumb(id) {
  const rec = await tx("readonly", (s) => s.get(id));
  if (!rec) return null;
  if (rec.thumb) return rec.thumb;
  if (!rec.thumb_path || !cloud.ready) return null;
  try { rec.thumb = await downloadThumb(rec.thumb_path); await tx("readwrite", (s) => s.put(rec)); return rec.thumb; } catch { return null; }
}
// เติมลายเซ็นภาพให้รูปอ้างอิงที่ยังไม่มี (ดาวน์โหลดรูปย่อถ้าจำเป็น) แล้วส่งขึ้นคลาวด์ — ใช้ครั้งแรกหลังเปิดฟีเจอร์เปรียบเทียบรูป
export async function backfillEmbeddings(embedFn, encodeFn, onProgress = () => {}, profile = null) {
  const all = (await listRefImages()).filter((x) => !x.emb && (!profile || x.profile === profile));
  let done = 0, ok = 0, batch = [];
  const flush = async () => { if (batch.length) { await pushRows("ref_images", batch); batch = []; } };
  // ดาวน์โหลดรูปย่อล่วงหน้าแบบขนาน 4 รูป ระหว่างที่คำนวณลายเซ็นทีละรูป
  const queue = all.slice(); const ready = [];
  const fetcher = async () => { while (queue.length) { const rec = queue.shift(); try { if (!rec.thumb && rec.thumb_path && cloud.ready) rec.thumb = await downloadThumb(rec.thumb_path); } catch (e) { console.warn("thumb", rec.id, e?.message || e); } ready.push(rec); } };
  const fetchers = Promise.all(Array.from({ length: 4 }, fetcher));
  while (done < all.length) {
    if (!ready.length) { await new Promise((r) => setTimeout(r, 50)); continue; }
    const rec = ready.shift();
    onProgress(`สร้างลายเซ็นภาพ ${++done}/${all.length}`);
    try {
      if (!rec.thumb) continue;
      rec.emb = encodeFn(await embedFn(rec.thumb));
      await tx("readwrite", (s) => s.put(rec));
      const { thumb, ...meta } = rec;
      batch.push({ key: rec.id, data: meta });
      if (batch.length >= 40) await flush();
      ok++;
    } catch (e) { console.warn("embed", rec.id, e?.message || e); }
  }
  await fetchers; await flush();
  metaCache = null;
  return { total: all.length, ok };
}

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

export function recordImageDecision({ hash, verdict, reason, site, section, by, emb = "" }) {
  kb.imageDecisions = kb.imageDecisions.filter((d) => d.hash !== hash);
  const d = { hash, verdict, reason: reason || "", site, section, by: by || "", emb, at: new Date().toLocaleString("th-TH") };
  kb.imageDecisions.push(d);
  saveKb();
  pushRow("image_decisions", hash, d);
}
export function findImageDecision(hash) { return kb.imageDecisions.find((d) => d.hash === hash) || null; }

// ---------- ส่งออก / นำเข้า ----------
export async function exportKb() {
  const refImages = (await listRefImages()).filter((x) => x.thumb);
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
  return { decisions: kb.decisions.length, profiles: kb.profiles.length, imageDecisions: kb.imageDecisions.length, refImages: meta.length, withEmb: meta.filter((x) => x.emb).length, signedRefs: ref.length, signedSites: new Set(ref.map((x) => x.site)).size };
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
  // เก็บเฉพาะข้อมูลย่อของรูปอ้างอิงใหม่ (ไม่มีรูปย่อ) — รูปย่อจะถูกดาวน์โหลดเมื่อเปิดดูโปรไฟล์นั้นครั้งแรก (ensureThumbs)
  const localKeys = new Set(await listRefKeys());
  const todo = c.ref_images.filter((r) => !localKeys.has(r.key));
  if (todo.length) {
    onProgress(`รับข้อมูลรูปอ้างอิงใหม่ ${todo.length} รูป`);
    await tx("readwrite", (s) => { for (const r of todo) s.put({ ...strip(r), id: r.key, thumb: null }); return null; });
    n.refImages = todo.length;
    metaCache = null;
  }
  // รูปที่มีในเครื่องแล้วแต่คลาวด์มีลายเซ็นภาพ (emb) ใหม่กว่า → อัปเดต
  const localMeta = new Map((await refMeta()).map((x) => [x.id, x]));
  const upd = c.ref_images.filter((r) => localKeys.has(r.key) && ((r.emb && !localMeta.get(r.key)?.emb) || (r.digest && !localMeta.get(r.key)?.digest)));
  if (upd.length) { await tx("readwrite", (s) => { for (const r of upd) { const req = s.get(r.key); req.onsuccess = () => { if (req.result) s.put({ ...req.result, emb: r.emb || req.result.emb, digest: r.digest || req.result.digest || "", thumb_path: r.thumb_path || req.result.thumb_path }); }; } return null; }); metaCache = null; }
  // รูปที่ถูกลบจากคลาวด์ (ROM ถอดออกจากเครื่องอื่น) → ลบในเครื่องด้วย
  const cloudKeys = new Set(c.ref_images.map((r) => r.key));
  const gone = [...localKeys].filter((k) => !cloudKeys.has(k));
  if (gone.length) { await tx("readwrite", (s) => { for (const k of gone) s.delete(k); return null; }); metaCache = null; n.removed = gone.length; }
  return n;
}
// ดาวน์โหลดรูปย่อที่ยังไม่มีของโปรไฟล์นี้ (ขนาน 6) — เรียกก่อนแสดงแท็บตรวจรูป
export async function ensureThumbs(profile, onProgress = () => {}) {
  const missing = (await refImagesForProfile(profile)).filter((x) => !x.thumb && x.thumb_path);
  if (!missing.length || !cloud.ready) return 0;
  let done = 0;
  const queue = missing.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const r = queue.shift();
      try { r.thumb = await downloadThumb(r.thumb_path); await tx("readwrite", (s) => s.put(r)); } catch (e) { console.warn("thumb", r.id, e?.message || e); }
      onProgress(`ดาวน์โหลดรูปอ้างอิงของโปรไฟล์ ${profile}: ${++done}/${missing.length}`);
    }
  }));
  return done;
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
