import { M, isPair } from "../i18n.js";
// กฎตรวจจากข้อความที่ OCR ได้จาก screenshot/รูป (O01–O07) — รับข้อความล้วน ไม่แตะรูปโดยตรง เพื่อให้ทดสอบได้
// ทุกข้อเป็น warn/info ให้คนยืนยัน เพราะ OCR อาจอ่านผิด

const CARD_NAMES = ["AWBILA", "OMDCL", "IRDM32", "MSH4-FSB", "MSH4FSB", "OTDR", "OTDRWB", "AAR-8A", "AAR8A", "MCS8-16", "MCS816", "OPSUM", "8EC2", "MEC2L", "PSILPFDC", "PSILPFAC", "8DC30", "RA5PB", "SWR", "SWU"];
const PROFILE_CARDS = {
  P1: { need: ["AWBILA"], forbid: ["OTDR"] },
  P2: { need: ["AWBILA", "OTDR"], forbid: [] },
  P3: { need: ["OMDCL", "IRDM32", "MSH4-FSB"], forbid: [] },
  P4: { need: ["OMDCL", "IRDM32", "MSH4-FSB", "AAR-8A", "MCS8-16", "OPSUM"], forbid: [] },
  P5: { need: ["AWBILA"], forbid: ["OTDR"] },
};
const normCard = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const clean = (t) => String(t || "").replace(/[|_]/g, " ").replace(/[ \t]+/g, " ");

export function findCards(text) {
  const T = normCard(text);
  const found = new Set();
  for (const c of CARD_NAMES) if (T.includes(normCard(c))) found.add(canonical(c));
  return [...found];
}
const canonical = (c) => ({ MSH4FSB: "MSH4-FSB", AAR8A: "AAR-8A", MCS816: "MCS8-16", OTDRWB: "OTDR" })[c] || c;

export function fuzzyHas(text, code) {
  // รหัสไซต์ 5 ตัว: ยอมให้ OCR ผิด 1 ตัว (O↔0, I↔1, S↔5, B↔8)
  const T = normCard(text).replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
  const C = normCard(code).replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
  if (T.includes(C)) return true;
  for (let i = 0; i < C.length; i++) {
    const re = new RegExp(C.slice(0, i) + "." + C.slice(i + 1));
    if (re.test(T)) return true;
  }
  return false;
}

const DATE_RE = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;
const TIME_RE = /\b\d{1,2}:\d{2}(:\d{2})?\b/;
const IP_RE = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
const VOLT_RE = /-?\s?(\d{2,3}[.,]\d)\s?V?/g;

// ---------- ตาราง Card Inventory (screenshot 1.4) → แถว {shelf, slot, card, sw, clei, part, serial, page} ----------
// รูปแบบแถวบนจอ: Shelf Slot Present/Provisioned SoftwareLoad Mnemonic CLEI UnitPartNumber SerialNumber
// เช่น "1 2 AWBILA/AWBILA 1830PSSECX-24.12-0 AWBILA WOGUA4LUTC 8DG63026AANE03 KD244001021"
export function parseInventory(invList) {
  const rows = [];
  for (const x of invList || []) {
    for (const line of String(x.text || "").split(/\n/)) {
      const toks = line.trim().split(/\s+/);
      const i = toks.findIndex((t) => /^[A-Z0-9\-]{2,}\/[A-Z0-9\-]{2,}$/i.test(t));
      if (i < 2 || !/^\d$/.test(toks[i - 2]) || !/^\d{1,2}$/.test(toks[i - 1])) continue;
      const rest = toks.slice(i + 1).map((t) => t.replace(/[^A-Za-z0-9.\-]/g, ""));
      const sw = rest.find((t) => /1830PSS/i.test(t)) || (rest.some((t) => /^Not$/i.test(t)) ? "Not Applicable" : "");
      const clei = rest.find((t) => /^W[A-Z0-9]{9}$/.test(t)) || "";
      // Serial: 2 ตัวอักษร + 9 หลัก (RT253219562, KD244001021) ยอมให้ OCR อ่านตัวเลขเป็น O/I/S/B
      const fixDigits = (t) => t.slice(0, 2) + t.slice(2).replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8");
      let serial = "";
      for (let k = rest.length - 1; k >= 0; k--) { const t = fixDigits(rest[k].toUpperCase()); if (/^[A-Z]{2}\d{9}$/.test(t)) { serial = t; break; } }
      if (!serial && rest.length && /^[A-Z0-9]{9,16}$/i.test(rest[rest.length - 1])) serial = rest[rest.length - 1].toUpperCase();
      const part = rest.find((t, k) => k < rest.length - 1 && /^[0-9][A-Z0-9]{10,15}$/i.test(t)) || "";
      rows.push({ shelf: +toks[i - 2], slot: +toks[i - 1], card: knownCard(toks[i].split("/")[0]), sw, clei, part: part.toUpperCase(), serial, page: x.page });
    }
  }
  // ตัดแถวซ้ำ (screenshot 2 รูปทับกัน)
  const seen = new Set();
  return rows.filter((r) => { const k = `${r.shelf}/${r.slot}/${r.card}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
const swDigits = (s) => (String(s || "").match(/\d+/g) || []).join("");
// ชื่อการ์ดจาก OCR → ชื่อที่รู้จัก (ยอมผิด 1 ตัวอักษร เช่น BEC2→8EC2, PE→PF)
const KNOWN_CARDS = [...CARD_NAMES, "PF", "SHFPNL", "FAN", "EC", "SFD", "OSCT", "MSH8-FSB", "MSH8FSB"];
function knownCard(raw) {
  const c = normCard(raw);
  if (KNOWN_CARDS.some((k) => normCard(k) === c)) return canonical(c);
  const cand = KNOWN_CARDS.map(normCard).filter((k) => k.length === c.length);
  for (const k of cand) { let d = 0; for (let i = 0; i < k.length; i++) if (k[i] !== c[i]) d++; if (d <= 1) return canonical(k); }
  return canonical(c);
}

// ผังการ์ดที่เรียนรู้จากไซต์ตัวอย่าง: layouts[profile] = { sites: N, slots: { "shelf/slot": { card: nSites } } }
export function buildLayouts(inventory, excludeSite = null) {
  const L = {};
  for (const [site, inv] of Object.entries(inventory || {})) {
    if (site === excludeSite || !inv?.profile || !inv.rows?.length) continue;
    const l = L[inv.profile] || (L[inv.profile] = { sites: 0, slots: {} });
    l.sites++;
    const seen = new Set();
    for (const r of inv.rows) { const k = `${r.shelf}/${r.slot}`; if (seen.has(k + r.card)) continue; seen.add(k + r.card); const s = l.slots[k] || (l.slots[k] = {}); s[r.card] = (s[r.card] || 0) + 1; }
  }
  return L;
}

// ocr: { inventory:[{page,text}], power:[...], neSetup:[...], neLabel:[...], fiberScope:[...], blockDiagram:[...] }
// ctx: { rows: แถว inventory ของไซต์นี้ (parseInventory), inventory: kb.inventory ของทุกไซต์ (สำหรับผังการ์ดและ serial ซ้ำ) }
export function ocrChecks(ocr, site, facts, ctx = {}) {
  const issues = [];
  const add = (rule, severity, section, page, msg, who = "คนตรวจ") => issues.push({ rule, level: 2, severity, section, page, ...(isPair(msg) ? { msg: msg.th, msg_en: msg.en } : { msg }), who, ocr: true });
  const S = site.satp;
  const code = facts.code || "";

  // O08–O10 จากตาราง Card Inventory ที่แยกเป็นแถวได้
  const rows = ctx.rows || parseInventory(ocr.inventory);
  if (rows.length) {
    const page = rows[0].page;
    // O08 Software Load บน screenshot vs SW REL หน้า 1 ของ SATP
    const rel = swDigits(S?.software?.release);
    const loads = [...new Set(rows.map((r) => r.sw).filter((s) => /1830PSS/i.test(s)))];
    if (rel && loads.length) {
      const bad = loads.filter((l) => swDigits(l) !== rel);
      if (bad.length) add("O08", "warn", "Attachment 1.4 Inventory", page, M(`Software Load บน screenshot (${bad.join(", ")}) ไม่ตรง SW REL ในหน้า 1 SATP (${S.software.release}) — screenshot จากคนละเวอร์ชัน/คนละไซต์?`, `Software Load on screenshot (${bad.join(", ")}) ≠ SW REL on SATP page 1 (${S.software.release}) — screenshot from another version/site?`));
      else add("O08", "info", "Attachment 1.4 Inventory", page, M(`Software Load ${loads[0]} ตรงกับ SATP (${S.software.release})`, `Software Load ${loads[0]} matches SATP (${S.software.release})`), "ระบบ");
    }
    // O09 ผังการ์ดต่อ shelf/slot vs ไซต์ตัวอย่างโปรไฟล์เดียวกัน
    const L = buildLayouts(ctx.inventory, code)[facts.profile];
    if (L && L.sites >= 3) {
      const here = {}; for (const r of rows) (here[`${r.shelf}/${r.slot}`] ||= new Set()).add(r.card);
      const PASSIVE = new Set(["PF", "FAN", "SHFPNL", "MFC", "8SP", "8FAN", "8DC30"]); // การ์ด/โมดูลพื้นฐาน ไม่ใช้ตัดสินว่า "ขาด" (OCR มักหลุดแถวเหล่านี้)
      const odd = [], missing = [];
      for (const [k, cards] of Object.entries(here)) { const exp = L.slots[k]; if (!exp) { odd.push(`${k} ${[...cards].join("/")} (ไซต์ตัวอย่างไม่มีการ์ดที่ slot นี้)`); continue; } for (const c of cards) if (!exp[c]) odd.push(`${k} ${c} (ตัวอย่างมี ${Object.keys(exp).join("/")})`); }
      // แถวที่อ่านได้น้อยกว่าไซต์ตัวอย่างชัดเจน = OCR หลุดแถว → ไม่ตัดสิน "ขาด" แค่แจ้ง
      const rowCounts = Object.values(ctx.inventory || {}).filter((v) => v.profile === facts.profile && v.site !== code).map((v) => v.rows.length).sort((a, b) => a - b);
      const median = rowCounts.length ? rowCounts[Math.floor(rowCounts.length / 2)] : 0;
      const incomplete = median && rows.length < median * 0.8;
      for (const [k, exp] of Object.entries(L.slots)) for (const [c, n] of Object.entries(exp)) if (n / L.sites >= 0.7 && !PASSIVE.has(c) && !here[k]?.has(c)) missing.push(`${k} ${c} (${n}/${L.sites} ไซต์มี)`);
      if (odd.length) add("O09", "warn", "Attachment 1.4 Inventory", page, M(`การ์ดอยู่ต่างจากผังไซต์ตัวอย่าง ${facts.profile}: ${odd.join("; ")}`, `Cards differ from the ${facts.profile} sample layout: ${odd.join("; ")}`));
      if (missing.length && !incomplete) add("O09", "warn", "Attachment 1.4 Inventory", page, M(`ไม่พบการ์ดที่ไซต์ตัวอย่างส่วนใหญ่มี: ${missing.join("; ")}`, `Cards most sample sites have were not found: ${missing.join("; ")}`));
      else if (missing.length) add("O09", "info", "Attachment 1.4 Inventory", page, M(`OCR อ่านได้ ${rows.length} แถว น้อยกว่าไซต์ตัวอย่าง (ค่ากลาง ${median}) — ไม่พบ ${missing.join("; ")} อาจเพราะอ่านไม่ครบ ให้คนดู`, `OCR read ${rows.length} rows, fewer than sample sites (median ${median}) — ${missing.join("; ")} not found, possibly unread; please check`));
      if (!odd.length && !missing.length) add("O09", "info", "Attachment 1.4 Inventory", page, M(`ผังการ์ด ${rows.length} แถวตรงกับไซต์ตัวอย่าง ${facts.profile} (${L.sites} ไซต์)`, `Card layout (${rows.length} rows) matches ${facts.profile} sample sites (${L.sites} sites)`), "ระบบ");
    }
    // O10 Serial number ซ้ำกับไซต์อื่น (screenshot ถูกนำมาใช้ซ้ำ หรือการ์ดย้ายไซต์)
    const dup = [];
    for (const r of rows) {
      if (!r.serial || r.serial.length < 9) continue;
      for (const [other, inv] of Object.entries(ctx.inventory || {})) { if (other === code) continue; if ((inv.rows || []).some((q) => q.serial === r.serial)) dup.push(`${r.serial} (${r.card} shelf ${r.shelf} slot ${r.slot}) พบที่ไซต์ ${other}`); }
    }
    if (dup.length) add("O10", "warn", "Attachment 1.4 Inventory", page, M(`Serial number ซ้ำกับไซต์อื่น: ${dup.join("; ")} — screenshot นำมาใช้ซ้ำ หรือการ์ดถูกย้าย?`, `Serial numbers also found at other sites: ${dup.join("; ")} — reused screenshot or moved card?`));
    else add("O10", "info", "Attachment 1.4 Inventory", page, M(`อ่าน serial number ได้ ${rows.filter((r) => r.serial).length}/${rows.length} การ์ด ไม่ซ้ำกับไซต์อื่น`, `Serial numbers read for ${rows.filter((r) => r.serial).length}/${rows.length} cards, none shared with other sites`), "ระบบ");
  }

  // O01 Inventory: การ์ดตามโปรไฟล์ + shelf + วันที่-เวลา PC
  const invText = clean(ocr.inventory.map((x) => x.text).join("\n"));
  if (ocr.inventory.length) {
    const cards = findCards(invText);
    const pc = PROFILE_CARDS[facts.profile];
    if (pc) {
      const missing = pc.need.filter((c) => !cards.includes(c));
      const extra = pc.forbid.filter((c) => cards.includes(c));
      if (missing.length) add("O01", "warn", "Attachment 1.4 Inventory", ocr.inventory[0].page, M(`OCR ไม่พบการ์ด ${missing.join(", ")} ที่โปรไฟล์ ${facts.profile} ควรมี (พบ: ${cards.join(", ") || "-"})`, `OCR did not find cards ${missing.join(", ")} required by profile ${facts.profile} (found: ${cards.join(", ") || "-"})`));
      if (extra.length) add("O01", "warn", "Attachment 1.4 Inventory", ocr.inventory[0].page, M(`OCR พบการ์ด ${extra.join(", ")} ซึ่งโปรไฟล์ ${facts.profile} ไม่ควรมี`, `OCR found cards ${extra.join(", ")} that profile ${facts.profile} should not have`));
      if (!missing.length && !extra.length) add("O01", "info", "Attachment 1.4 Inventory", ocr.inventory[0].page, M(`OCR พบการ์ดครบตามโปรไฟล์: ${cards.join(", ")}`, `OCR found all cards of the profile: ${cards.join(", ")}`), "ระบบ");
    } else add("O01", "info", "Attachment 1.4 Inventory", ocr.inventory[0].page, M(`OCR พบการ์ด: ${cards.join(", ") || "อ่านไม่ได้"}`, `OCR found cards: ${cards.join(", ") || "unreadable"}`), "ระบบ");
    const shelfNos = new Set([...invText.matchAll(/(?:shelf|sh)\s*[#:]?\s*0?(\d)\b/gi)].map((m) => m[1]));
    const want = Object.values(facts.shelves || {}).reduce((a, b) => a + b, 0);
    if (want >= 2 && shelfNos.size && shelfNos.size < want) add("O01", "warn", "Attachment 1.4 Inventory", ocr.inventory[0].page, M(`OCR พบ shelf ${[...shelfNos].join(", ")} แต่ไซต์นี้ควรมี ${want} shelf`, `OCR found shelf ${[...shelfNos].join(", ")} but this site should have ${want} shelves`));
    if (!DATE_RE.test(invText) || !TIME_RE.test(invText)) add("O07", "warn", "Attachment 1.4 Inventory", ocr.inventory[0].page, M("OCR ไม่พบวันที่-เวลาบน screenshot (template กำหนดให้ถ่ายพร้อม Date & Time ของ PC)", "OCR found no date/time on the screenshot (template requires PC Date & Time visible)"));
  }

  // O02 Power screenshots: ค่าแรงดันในรูป vs ตาราง 1.5
  if (ocr.power.length && S?.power) {
    const txt = clean(ocr.power.map((x) => x.text).join(" "));
    const vals = [...txt.matchAll(VOLT_RE)].map((m) => parseFloat(m[1].replace(",", "."))).filter((v) => v >= 30 && v <= 300);
    const want = [S.power.main, S.power.standby].filter((v) => v != null).map(Math.abs);
    if (!vals.length) add("O02", "info", "Attachment 1.5 Power", ocr.power[0].page, M("OCR อ่านค่าแรงดันจาก screenshot ไม่ได้", "OCR could not read a voltage from the screenshot"), "คนตรวจ");
    else {
      const miss = want.filter((w) => !vals.some((v) => Math.abs(v - w) <= 1.0));
      if (miss.length) add("O02", "info", "Attachment 1.5 Power", ocr.power[0].page, M(`ค่าในตาราง 1.5 (${want.join(", ")} V) ไม่พบใน screenshot — OCR อ่านตัวเลขบนรูปมิเตอร์/LCT ได้จำกัด ให้คนดู (อ่านได้: ${[...new Set(vals)].slice(0, 6).join(", ")})`, `Table 1.5 values (${want.join(", ")} V) not found on screenshot — OCR reads meter/LCT digits poorly, please check (read: ${[...new Set(vals)].slice(0, 6).join(", ")})`));
      else add("O02", "info", "Attachment 1.5 Power", ocr.power[0].page, M(`screenshot แสดงค่าตรงกับตาราง 1.5 (${want.join(", ")} V)`, `Screenshot shows values matching table 1.5 (${want.join(", ")} V)`), "ระบบ");
    }
  }

  // O03 NE setup: IP และชื่อ NE
  if (ocr.neSetup.length) {
    const txt = clean(ocr.neSetup.map((x) => x.text).join(" "));
    const ips = [...txt.matchAll(IP_RE)].map((m) => m[0]);
    const hip = S?.header.ip;
    if (hip && ips.length && !ips.includes(hip)) add("O03", "warn", "Attachment 1.9 NE Setup", ocr.neSetup[0].page, M(`IP ใน screenshot (${[...new Set(ips)].slice(0, 4).join(", ")}) ไม่มี ${hip} ตามหน้า 1`, `IPs on screenshot (${[...new Set(ips)].slice(0, 4).join(", ")}) do not include ${hip} from page 1`));
    else if (hip && ips.includes(hip)) add("O03", "info", "Attachment 1.9 NE Setup", ocr.neSetup[0].page, M(`screenshot มี IP ${hip} ตรงหน้า 1`, `Screenshot shows IP ${hip} matching page 1`), "ระบบ");
    if (code && !fuzzyHas(txt, code)) add("O03", "warn", "Attachment 1.9 NE Setup", ocr.neSetup[0].page, M(`OCR ไม่พบชื่อ NE '${code}' ใน screenshot`, `OCR did not find NE name '${code}' on the screenshot`));
    if (!DATE_RE.test(txt) || !TIME_RE.test(txt)) add("O07", "warn", "Attachment 1.9 NE Setup", ocr.neSetup[0].page, M("OCR ไม่พบวันที่-เวลาบน screenshot", "OCR found no date/time on the screenshot"));
  }

  // O04 ป้าย NE ID
  if (ocr.neLabel.length) {
    const txt = clean(ocr.neLabel.map((x) => x.text).join(" "));
    if (code && !fuzzyHas(txt, code)) add("O04", "warn", "Attachment 1.8 (b) NE ID", ocr.neLabel[0].page, M(`OCR ไม่พบรหัส '${code}' บนป้าย NE ID (อ่านได้: "${txt.trim().slice(0, 60)}")`, `OCR did not find code '${code}' on the NE ID label (read: "${txt.trim().slice(0, 60)}")`));
    else if (code) add("O04", "info", "Attachment 1.8 (b) NE ID", ocr.neLabel[0].page, M(`ป้าย NE ID มีรหัส ${code}`, `NE ID label shows code ${code}`), "ระบบ");
  }

  // O05 Fiber scope: PASS/FAIL ในรูป
  let fsPass = 0, fsFail = 0, fsNone = 0;
  for (const x of ocr.fiberScope) {
    const t = x.text.toUpperCase();
    if (/\bFAIL/.test(t)) { fsFail++; add("O05", "warn", "Attachment 1.15 Fiber Scope", x.page, M(`รูป fiber scope หน้า ${x.page} มีคำว่า FAIL`, `Fiber scope image on page ${x.page} shows FAIL`)); }
    else if (/\bPASS/.test(t)) fsPass++;
    else fsNone++;
  }
  if (ocr.fiberScope.length) {
    add("O05", fsFail ? "warn" : "info", "Attachment 1.15 Fiber Scope", ocr.fiberScope[0].page, M(`Fiber scope ${ocr.fiberScope.length} รูป: PASS ${fsPass}, FAIL ${fsFail}, อ่านไม่ได้ ${fsNone}`, `Fiber scope ${ocr.fiberScope.length} images: PASS ${fsPass}, FAIL ${fsFail}, unreadable ${fsNone}`), "ระบบ");
    // ชื่อรายงานในรูป เช่น "9R25M - 4D13M_LINE OUT" → ต้องมี LINE IN + LINE OUT ของทุกไซต์ปลายทางใน Span Loss
    if (S) {
      const all = clean(ocr.fiberScope.map((x) => x.text).join(" ")).toUpperCase();
      const far = new Set();
      for (const r of S.span) for (const s of [r.siteA, r.siteB]) if (!normCard(s).startsWith(normCard(code).slice(0, 4))) far.add(s.replace(/DCAG$/, ""));
      const missing = [];
      for (const f of far) for (const dir of ["IN", "OUT"]) {
        const re = new RegExp(f.slice(0, 4) + "[A-Z0-9]?\\s*[_ -]?\\s*L[I1]NE\\s*[_ ]?" + dir + "\\b");
        if (!re.test(all)) missing.push(`${f} LINE ${dir}`);
      }
      if (far.size && missing.length) add("O05", "warn", "Attachment 1.15 Fiber Scope", ocr.fiberScope[0].page, M(`ชื่อรายงาน fiber scope ไม่ครบทุกทิศ: ไม่พบ ${missing.join(", ")} (OCR อาจอ่านชื่อผิด ให้คนดู)`, `Fiber scope report names do not cover every direction: missing ${missing.join(", ")} (OCR may misread names; please check)`));
      else if (far.size) add("O05", "info", "Attachment 1.15 Fiber Scope", ocr.fiberScope[0].page, M(`Fiber scope มี LINE IN/OUT ครบทุกไซต์ปลายทาง (${[...far].join(", ")})`, `Fiber scope has LINE IN/OUT for every far-end site (${[...far].join(", ")})`), "ระบบ");
    }
  }

  // O06 Block diagram: ไซต์ปลายทาง + การ์ด
  if (ocr.blockDiagram.length && S) {
    const txt = clean(ocr.blockDiagram.map((x) => x.text).join(" "));
    const far = new Set();
    for (const r of S.span) for (const s of [r.siteA, r.siteB]) if (!normCard(s).startsWith(normCard(code).slice(0, 4))) far.add(s.replace(/DCAG$/, ""));
    const missing = [...far].filter((f) => !fuzzyHas(txt, f.slice(0, 5)));
    if (missing.length) add("O06", "warn", "1.1 Block Diagram", ocr.blockDiagram[0].page, M(`ไซต์ปลายทางใน Span Loss (${missing.join(", ")}) ไม่พบใน Block Diagram`, `Far-end sites in Span Loss (${missing.join(", ")}) not found in Block Diagram`));
    else if (far.size) add("O06", "info", "1.1 Block Diagram", ocr.blockDiagram[0].page, M(`Block Diagram มีไซต์ปลายทางครบ: ${[...far].join(", ")}`, `Block Diagram includes all far-end sites: ${[...far].join(", ")}`), "ระบบ");
    const cards = findCards(txt);
    const pc = PROFILE_CARDS[facts.profile];
    if (pc) { const m = pc.need.filter((c) => !cards.includes(c) && c !== "OTDR"); if (m.length) add("O06", "info", "1.1 Block Diagram", ocr.blockDiagram[0].page, M(`OCR ไม่พบการ์ด ${m.join(", ")} ใน Block Diagram (อาจอ่านไม่ออกเพราะตัวเล็ก)`, `OCR did not find cards ${m.join(", ")} in Block Diagram (text may be too small)`)); }
    if (code && !fuzzyHas(txt, code)) add("O06", "warn", "1.1 Block Diagram", ocr.blockDiagram[0].page, M(`ชื่อ NE ใน Block Diagram ไม่มีรหัส ${code}`, `NE name in Block Diagram lacks code ${code}`));
  }
  return issues;
}
