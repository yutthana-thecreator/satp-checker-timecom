// กฎตรวจ R01–R26 (ตรงกับชีท "2_กฎตรวจ" ใน AI_Acceptance_Check_Reference.xlsx)
// ระดับ 1 ครบถ้วน · 2 สอดคล้อง · 3 ค่าทางเทคนิค
// ผลแต่ละข้อ: { rule, level, severity: 'fail'|'warn'|'info', section, page, msg, who }

import { parseDate } from "./parse.js";
import { DEFAULT_CRITERIA, matchProfile, powerSystem } from "./profiles.js";
import { SITES } from "../data/sites.js";

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const fmt = (n) => (n == null ? "-" : Number(n).toFixed(2));

export function lookupSite(code, neType, suffix) {
  const c = norm(code).replace(/DCAG$/, "");
  const cands = SITES.filter((s) => norm(s.code) === c);
  if (!cands.length) return null;
  return cands.find((s) => s.nodeType === neType && s.suffix === suffix) || cands.find((s) => s.nodeType === neType) || cands[0];
}

export function checkSite(site, criteria = DEFAULT_CRITERIA, today = new Date()) {
  // site: { code, folder, satp: parsedSatp|null, att: parsedAtt|null, satpFile, attFile, pagesSatp, pagesAtt }
  const issues = [];
  const add = (rule, level, severity, section, page, msg, who = "ระบบ") => issues.push({ rule, level, severity, section, page, msg, who });
  const S = site.satp, A = site.att;
  const facts = { code: site.code };

  // ---------- R01 มีครบ 2 ไฟล์ และเป็นของไซต์เดียวกัน ----------
  if (!S) add("R01", 1, "fail", "เอกสาร", null, "ไม่พบไฟล์ SATP");
  if (!A) add("R01", 1, "fail", "เอกสาร", null, "ไม่พบไฟล์ Attachment Report");
  if (!S) return { issues, facts };

  const H = S.header;
  const fileInfo = S.file || {};
  const code = norm(H.neCode || fileInfo.code || site.code);
  facts.code = H.neCode || fileInfo.code || site.code;
  facts.nodeType = H.neType || fileInfo.nodeType;
  facts.suffix = H.neSuffix || fileInfo.suffix;
  facts.project = /DC2DC/i.test(H.project) ? "DC2DC" : /AGRID/i.test(H.project) ? "AGRID" : fileInfo.project;
  if (fileInfo.code && norm(fileInfo.code) !== code) add("R01", 2, "fail", "ชื่อไฟล์", 1, `ชื่อไฟล์ SATP ระบุไซต์ ${fileInfo.code} แต่ Station Name เป็น ${H.neCode}`);
  if (A?.file?.code && norm(A.file.code) !== code) add("R01", 2, "fail", "ชื่อไฟล์", 1, `ไฟล์ Attachment เป็นของไซต์ ${A.file.code} ไม่ใช่ ${facts.code}`);
  if (site.folderCode && norm(site.folderCode) !== code) add("R01", 2, "warn", "ชื่อไฟล์", 1, `โฟลเดอร์ ${site.folderCode} แต่เอกสารเป็นของไซต์ ${facts.code}`);

  // ---------- R02 จำนวนหน้า/section ----------
  if (S.numPages !== 35) add("R02", 1, "fail", "SATP", null, `SATP มี ${S.numPages} หน้า (template 35 หน้า)`);
  for (const [k, label, pg] of [["power", "1.5 Power Supply", S.power], ["ground", "1.6 Ground", S.ground], ["software", "1.7 Equipment Config", S.software], ["neSetup", "1.9 NE Setup", S.neSetup], ["discovery", "1.10 Discovery", S.discovery]])
    if (!S[k]) add("R02", 1, "fail", label, null, `ไม่พบ section ${label}`);
  if (!S.span.length) add("R02", 1, "fail", "1.11 Span Loss", null, "ไม่พบตาราง Span Loss หรืออ่านไม่ได้");
  if (!S.tx.length) add("R02", 1, "fail", "1.12 TX", null, "ไม่พบตาราง TX Power");
  if (!S.rx.length) add("R02", 1, "fail", "1.13 RX", null, "ไม่พบตาราง RX Power");
  if (!S.visual.length) add("R02", 1, "fail", "1.8 Visual", null, "ไม่พบตาราง Visual Inspection");

  // ---------- R03 หน้า 1 ----------
  for (const [f, label] of [["station", "Station Name"], ["ip", "IP Address"], ["model", "DWDM Model"], ["installStart", "Installation Start"], ["installEnd", "Installation End"]])
    if (!H[f]) add("R03", 1, "fail", "SATP หน้า 1", 1, `ไม่ได้กรอก ${label}`);
  if (!H.acceptanceDate) add("R03", 1, "fail", "SATP หน้า 1", 1, "ไม่มี Acceptance Date");
  if (S.checklist && S.checklist.ticks < 5) add("R03", 1, "fail", "1.2 Checklist", S.checklist.page, `Checklist ติ๊ก ${S.checklist.ticks}/5 ข้อ`);

  // ---------- R04 Block diagram ----------
  if (!S.blockDiagram) add("R04", 1, "fail", "1.1 Block Diagram", 5, "ไม่พบหน้า Block Diagram");
  else if (S.blockDiagram.photoCount === 0) add("R04", 1, "fail", "1.1 Block Diagram", S.blockDiagram.no, "หน้า Block Diagram ไม่มีรูป");

  // ---------- R05 ลายเซ็น/วันที่ ----------
  const signPages = S.pageDates.filter((d) => d.page >= 6 && d.page <= 27);
  const withDate = signPages.filter((d) => d.date).length;
  if (withDate === 0) add("R05", 1, "fail", "ทุกหน้า", null, `ไม่มีวันที่ในช่อง Performed/Verified by (หน้า 6–27)${fileInfo.signed || A?.file?.signed ? "" : " และชื่อไฟล์ไม่มี _Signed"}`, "คนตรวจ");
  else if (withDate < signPages.length - 4) add("R05", 1, "warn", "ทุกหน้า", null, `มีวันที่ในช่องลายเซ็น ${withDate}/${signPages.length} หน้า — ตรวจหน้าที่ไม่มี`, "คนตรวจ");

  // ---------- R06 placeholder ----------
  if (S.placeholders.length) add("R06", 1, "fail", "SATP", S.placeholders[0], `มีข้อความ template ค้าง 'Type text here' หน้า ${S.placeholders.join(", ")}`);
  if (A?.placeholders?.length) add("R06", 1, "fail", "Attachment", A.placeholders[0], `มีข้อความ template ค้าง 'Type text here' หน้า ${A.placeholders.join(", ")}`);

  // ---------- facts: degrees, modules, power, shelves ----------
  const spans = S.span;
  facts.degrees = Math.floor(spans.length / 2);
  facts.modules = new Set([...S.tx, ...S.rx].map((r) => r.module));
  facts.power = powerSystem(S.power?.main ?? S.power?.standby);
  const siteRef = lookupSite(facts.code, facts.nodeType, facts.suffix);
  facts.siteRef = siteRef;
  // shelves: จากรายชื่อไซต์ไทย ถ้าไม่มีให้อนุมานจาก TX/RX slot + Attachment shelf remark
  if (siteRef) facts.shelves = siteRef.shelves;
  else {
    const shelfNos = new Set([...S.tx, ...S.rx].map((r) => r.slot.match(/SH(\d+)/)?.[1]).filter(Boolean).map((x) => String(+x)));
    for (const r of A?.shelfRemarks || []) shelfNos.add(String(+r.shelf));
    const model = norm(H.model);
    const t = /PSI8L/.test(model) ? "PSI-8L" : "PSS-8";
    facts.shelves = { [t]: Math.max(1, shelfNos.size) };
    facts.shelvesInferred = true;
  }
  const pm = matchProfile(facts);
  facts.profile = pm.profile ? pm.profile.id : null;
  facts.profileName = pm.profile ? pm.profile.name : null;
  facts.nearestProfile = pm.nearest?.id || null;
  facts.profileMismatches = pm.mismatches;
  if (!pm.profile) add("P00", 0, "info", "โปรไฟล์", null, `ไม่ตรงโปรไฟล์อ้างอิงใด (ใกล้ ${pm.nearest?.id}: ${pm.mismatches.join("; ")}) → ใช้กฎทั่วไป, ROM ตรวจเอง`, "ROM");
  else add("P00", 0, "info", "โปรไฟล์", null, `เทียบกับโปรไฟล์ ${pm.profile.id} (${pm.profile.name}) ตัวอย่าง ${pm.profile.samples} ไซต์`);
  if (facts.nodeType === "EILA") add("P00", 0, "info", "โปรไฟล์", null, "EILA — ยังไม่มีตัวอย่าง ตรวจเฉพาะกฎทั่วไป", "ROM");

  // ---------- R07 Attachment รูปครบ ----------
  if (A) {
    const need = ["1.4", "1.5", "1.6", "1.8", "1.9", "1.15"];
    for (const s of need) if (!A.sections[s]) add("R07", 1, "fail", `Attachment ${s}`, null, `ไม่พบ section ${s} ใน Attachment`);
    const caps = ["a", "b", "c", "d", "e", "f", "g"];
    for (const c of caps) if (!A.captions[c]) add("R07", 1, "fail", "Attachment 1.8", A.sections["1.8"], `ไม่พบรูปหัวข้อ 1.8 (${c})`);
    const shelfCount = Object.values(facts.shelves || {}).reduce((a, b) => a + b, 0);
    const shelfViews = (A.captions.c || []).filter((x) => /Shelf View/i.test(x.label)).length;
    const remarks = new Set(A.shelfRemarks.map((r) => +r.shelf)).size;
    if (shelfCount >= 2 && remarks < shelfCount) add("R07", 1, "warn", "Attachment 1.8 (c)/(f)", A.sections["1.8"], `ต้องมี remark Shelf # ครบ ${shelfCount} shelf แต่พบ ${remarks}`, "คนตรวจ");
    const fsNeed = facts.degrees * 2;
    if (A.fiberScope.length < fsNeed) add("R07", 1, "fail", "Attachment 1.15", A.sections["1.15"], `Fiber scope มี ${A.fiberScope.length} รูป ต้องมีอย่างน้อย ${fsNeed} (Line In/Out × ${facts.degrees} ทิศ)`);
    // photo counts per section from page list
    if (site.pagesAtt) {
      const secPages = Object.entries(A.sections).sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < secPages.length; i++) {
        const [sec, from] = secPages[i];
        const to = i + 1 < secPages.length ? secPages[i + 1][1] - 1 : site.pagesAtt.length;
        const photos = site.pagesAtt.slice(from - 1, to).reduce((n, p) => n + (p.photoCount || 0), 0);
        if (photos === 0) add("R07", 1, "fail", `Attachment ${sec}`, from, `section ${sec} ไม่มีรูปแนบ`);
      }
    }
  }

  // ---------- R08 SATP vs ATT หน้า 1 ----------
  if (A) {
    const AH = A.header;
    if (norm(AH.station) !== norm(H.station)) add("R08", 2, "fail", "ATT หน้า 1", 1, `Station Name ไม่ตรง: SATP '${H.station}' vs ATT '${AH.station}'`);
    if (norm(AH.model).replace(/^1830/, "") !== norm(H.model).replace(/^1830/, "")) add("R08", 2, "fail", "ATT หน้า 1", 1, `DWDM Model ไม่ตรง: SATP '${H.model}' vs ATT '${AH.model}'`);
    if (AH.ip && H.ip && AH.ip !== H.ip) add("R08", 2, "fail", "ATT หน้า 1", 1, `IP ไม่ตรง: SATP ${H.ip} vs ATT ${AH.ip}`);
    if (AH.installStart && H.installStart && AH.installStart !== H.installStart) add("R08", 2, "warn", "ATT หน้า 1", 1, `วันติดตั้งไม่ตรง: SATP ${H.installStart} vs ATT ${AH.installStart}`);
    if (A.file?.nodeType && S.file?.nodeType && (A.file.nodeType !== S.file.nodeType || A.file.suffix !== S.file.suffix)) add("R08", 2, "fail", "ชื่อไฟล์", 1, `ประเภทในชื่อไฟล์ไม่ตรง: SATP ${S.file.nodeType}_${S.file.suffix} vs ATT ${A.file.nodeType}_${A.file.suffix}`);
  }
  if (fileInfo.nodeType && facts.nodeType && (fileInfo.nodeType !== facts.nodeType || fileInfo.suffix !== facts.suffix)) add("R08", 2, "fail", "SATP หน้า 1", 1, `ประเภทใน Station Name (${facts.nodeType}_${facts.suffix}) ≠ ชื่อไฟล์ (${fileInfo.nodeType}_${fileInfo.suffix})`);

  // ---------- R09 model ตรงประเภท ----------
  const model = norm(H.model);
  if (/ILA/.test(facts.nodeType) && !/PSS8/.test(model)) add("R09", 2, "fail", "SATP หน้า 1", 1, `ILA ควรเป็น 1830 PSS-8 แต่ระบุ '${H.model}'`);
  if (facts.nodeType === "RDM" && !/PSI8L/.test(model)) add("R09", 2, "fail", "SATP หน้า 1", 1, `ROADM ควรเป็น 1830 PSI-8L แต่ระบุ '${H.model}'`);
  if (siteRef) {
    const want = Object.keys(siteRef.shelves);
    const have = /PSI8L/.test(model) ? "PSI-8L" : /PSS8/.test(model) ? "PSS-8" : H.model;
    if (!want.includes(have)) add("R09", 2, "fail", "SATP หน้า 1", 1, `Model '${H.model}' ไม่ตรงรายชื่อไซต์ (${siteRef.shelfType})`);
  }

  // ---------- R10 Station Name มีรหัสไซต์ / ตรงรายชื่อไซต์ ----------
  if (!H.neCode) add("R10", 2, "fail", "SATP หน้า 1", 1, `อ่านรหัสไซต์จาก Station Name ไม่ได้: '${H.station}'`);
  if (site.folderCode && H.neCode && norm(H.neCode) !== norm(site.folderCode)) add("R10", 2, "fail", "SATP หน้า 1", 1, `Station Name ระบุ ${H.neCode} แต่โฟลเดอร์/ชื่อไฟล์เป็น ${site.folderCode} (พิมพ์ผิด?)`);
  if (siteRef) {
    if (siteRef.nodeType !== facts.nodeType || siteRef.suffix !== facts.suffix) add("R10", 2, "fail", "SATP หน้า 1", 1, `รายชื่อไซต์ระบุ ${siteRef.neName} แต่เอกสารเป็น ${facts.nodeType}_${facts.suffix}`);
    if (S.neSetup?.loopback && H.ip && S.neSetup.loopback !== H.ip) add("R10", 2, "fail", "1.9 NE Setup", S.neSetup.page, `Loopback IP ${S.neSetup.loopback} ≠ IP หน้า 1 ${H.ip}`);
  } else if (S.neSetup?.loopback && H.ip && S.neSetup.loopback !== H.ip) add("R10", 2, "fail", "1.9 NE Setup", S.neSetup.page, `Loopback IP ${S.neSetup.loopback} ≠ IP หน้า 1 ${H.ip}`);
  if (!siteRef) add("R10", 2, "info", "รายชื่อไซต์", 1, `ไซต์ ${facts.code} ไม่อยู่ในรายชื่อ 56 ไซต์ของโปรเจกต์ไทย (ตัวอย่าง/ไซต์นอกรายการ)`);

  // ---------- R11 วันที่ ----------
  const ds = parseDate(H.installStart), de = parseDate(H.installEnd), da = parseDate(H.acceptanceDate);
  if (H.installStart && !ds) add("R11", 2, "fail", "SATP หน้า 1", 1, `วันที่ติดตั้ง Start รูปแบบผิด: '${H.installStart}'`);
  if (H.installEnd && !de) add("R11", 2, "fail", "SATP หน้า 1", 1, `วันที่ติดตั้ง End รูปแบบผิด: '${H.installEnd}'`);
  if (ds && de && de < ds) add("R11", 2, "fail", "SATP หน้า 1", 1, `End (${H.installEnd}) ก่อน Start (${H.installStart})`);
  if (ds && ds > today) add("R11", 2, "fail", "SATP หน้า 1", 1, `วันที่ติดตั้งอยู่ในอนาคต: ${H.installStart}`);
  if (H.acceptanceDate && !da) add("R11", 2, "fail", "SATP หน้า 1", 1, `Acceptance Date รูปแบบผิด: '${H.acceptanceDate}'`);
  if (da && de && da < de) add("R11", 2, "fail", "SATP หน้า 1", 1, `Acceptance Date (${H.acceptanceDate}) ก่อนวันติดตั้งเสร็จ (${H.installEnd})`);

  // ---------- R12 / R13 span consistency ----------
  const self = code;
  const spanPairs = [];
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const a = spans[i], b = spans[i + 1];
    const pa = [norm(a.siteA), norm(a.siteB)].sort(), pb = [norm(b.siteA), norm(b.siteB)].sort();
    if (pa.join() !== pb.join()) add("R12", 2, "fail", "1.11 Span", a.page, `core1/core2 คู่ไซต์ไม่ตรงกัน: ${a.siteA}-${a.siteB} vs ${b.siteA}-${b.siteB} (พิมพ์รหัสไซต์ผิด?)`);
    if (a.distance !== b.distance) add("R12", 2, "fail", "1.11 Span", a.page, `core1/core2 ระยะไม่เท่ากัน: ${a.distance} vs ${b.distance} km`);
    spanPairs.push({ a, b, far: pa.find((x) => !x.startsWith(self.slice(0, 4))) || pa[0] });
  }
  if (spans.length % 2) add("R12", 2, "warn", "1.11 Span", spans[0].page, `จำนวนแถว Span เป็นเลขคี่ (${spans.length}) — ควรมี core1+core2 ต่อทิศ`);
  for (const r of spans) {
    const hasSelf = [norm(r.siteA), norm(r.siteB)].some((x) => x.startsWith(self.slice(0, 4)) || self.startsWith(x.slice(0, 4)));
    if (!hasSelf) add("R12", 2, "fail", "1.11 Span", r.page, `แถว core${r.core} ${r.siteA}-${r.siteB} ไม่มีไซต์ตัวเอง (${facts.code})`);
    if (r.dirA === r.dirB) add("R13", 2, "fail", "1.11 Span", r.page, `core${r.core} ${r.siteA}-${r.siteB}: ทั้งสองฝั่งเป็น ${r.dirA} (ต้อง TX คู่ RX)`);
  }
  if (/ILA/.test(facts.nodeType) && facts.degrees !== 2 && spans.length) add("R12", 1, "fail", "1.11 Span", spans[0].page, `ILA ต้องมี 2 ทิศ (4 แถว) แต่มี ${facts.degrees} ทิศ (${spans.length} แถว)`);

  // ---------- R15 TX/RX rows vs degrees, slot ซ้ำ ----------
  for (const [sec, rows] of [["1.12 TX", S.tx], ["1.13 RX", S.rx]]) {
    const slots = rows.map((r) => r.slot);
    const dup = [...new Set(slots.filter((s, i) => slots.indexOf(s) !== i))];
    if (dup.length) add("R15", 2, "fail", sec, rows[0].page, `Slot ซ้ำ: ${dup.join(", ")}`);
    if (rows.length && facts.degrees && rows.length !== facts.degrees) add("R15", 2, "fail", sec, rows[0].page, `จำนวนแถว ${rows.length} ≠ จำนวนทิศ ${facts.degrees}`);
  }
  if (S.tx.length && S.rx.length) {
    const ts = S.tx.map((r) => r.slot).sort().join(), rs = S.rx.map((r) => r.slot).sort().join();
    if (ts !== rs) add("R15", 2, "fail", "1.12/1.13", S.rx[0].page, `Slot ใน TX (${S.tx.map((r) => r.slot).join(", ")}) ≠ RX (${S.rx.map((r) => r.slot).join(", ")})`);
  }

  // ---------- R16 ค่า TX/RX ตรงกับ 1.11 ----------
  const selfVals = { TX: [], RX: [] };
  for (const r of spans) {
    for (const [s, d, v] of [[r.siteA, r.dirA, r.valA], [r.siteB, r.dirB, r.valB]]) if (norm(s).startsWith(self.slice(0, 4))) selfVals[d].push(v);
  }
  for (const [sec, rows, key] of [["1.12 TX", S.tx, "TX"], ["1.13 RX", S.rx, "RX"]])
    for (const r of rows) if (selfVals[key].length && !selfVals[key].some((v) => Math.abs(v - r.value) < 0.005)) add("R16", 2, "warn", sec, r.page, `${r.slot} ค่า ${r.value} dBm ไม่พบใน 1.11 Span Loss ฝั่ง ${key} ของไซต์ตัวเอง`);

  // ---------- R19/R20 power ----------
  if (S.power) {
    const c = criteria;
    for (const [k, v] of [["Main", S.power.main], ["Stand-by", S.power.standby]]) {
      if (v == null) { add("R19", 1, "fail", "1.5 Power", S.power.page, `ไม่มีค่าแรงดัน ${k}`); continue; }
      const av = Math.abs(v);
      if (facts.power === "dc48") { if (av < c.dc48.min || av > c.dc48.max) add("R19", 3, "fail", "1.5 Power", S.power.page, `${k} ${v} V นอกช่วง -${c.dc48.min} ~ -${c.dc48.max} V`); }
      else if (facts.power === "hvdc") { if (c.hvdc.min != null && (av < c.hvdc.min || av > c.hvdc.max)) add("R20", 3, "warn", "1.5 Power", S.power.page, `${k} ${v} V นอกช่วง HVDC ${c.hvdc.min}–${c.hvdc.max} V (เกณฑ์จากตัวอย่าง)`, "คนตรวจ"); }
      else add("R20", 3, "info", "1.5 Power", S.power.page, `${k} ${v} V — ระบบไฟไม่ตรง -48V/HVDC ยังไม่มีเกณฑ์`, "คนตรวจ");
    }
    if (facts.power === "hvdc") add("R20", 3, "info", "1.5 Power", S.power.page, `ไซต์ไฟ ~240 V — template ระบุช่วง -40.5~-57 V ไม่ตรงกับไซต์นี้ ต้องยืนยันเกณฑ์กับลูกค้า`, "CPM");
    for (const [k, v] of [["Main", S.power.breakerMain], ["Stand-by", S.power.breakerStandby]]) if (v !== "PASS") add("R19", 3, "fail", "1.5 Power", S.power.page, `Breaker ${k} = '${v || "ว่าง"}'`);
  }

  // ---------- R21 ground ----------
  if (S.ground) {
    for (const [k, g] of [["Rack–Busbar", S.ground.rackToBusbar], ["Shelf–Rack", S.ground.shelfToRack]]) {
      if (!g.raw) add("R21", 1, "fail", "1.6 Ground", S.ground.page, `ไม่มีค่ากราวด์ ${k}`);
      else if (g.value == null) add("R21", 3, criteria.groundAllowNonNumeric.value ? "info" : "fail", "1.6 Ground", S.ground.page, `ค่ากราวด์ ${k} = '${g.raw}' ไม่ใช่ตัวเลข (template ให้วัดค่า < 1 Ω)`);
      else if (g.value >= criteria.groundMax.value) add("R21", 3, "fail", "1.6 Ground", S.ground.page, `ค่ากราวด์ ${k} ${g.value} Ω ≥ ${criteria.groundMax.value} Ω`);
    }
  }

  // ---------- R22 / R23 span values ----------
  const tol = criteria.lossTolerance.value;
  for (const r of spans) {
    const tag = `core${r.core} ${r.siteA}-${r.siteB}`;
    if (r.dirA === r.dirB) continue;
    const tx = r.dirA === "TX" ? r.valA : r.valB, rx = r.dirA === "RX" ? r.valA : r.valB;
    if (rx > 0) add("R22", 3, "fail", "1.11 Span", r.page, `${tag}: RX เป็นค่าบวก (${rx}) น่าจะพิมพ์ผิด`);
    const loss = tx - rx;
    if (Math.abs(Math.abs(r.totalLoss) - Math.abs(loss)) > tol) add("R22", 3, "fail", "1.11 Span", r.page, `${tag}: Total Loss ${r.totalLoss} ≠ TX−RX = ${fmt(loss)}`);
    if (r.distance > 0) {
      const pk = Math.abs(r.totalLoss) / r.distance;
      if (Math.abs(Math.abs(r.lossPerKm) - pk) > 0.011) add("R22", 3, "fail", "1.11 Span", r.page, `${tag}: Loss/km ${r.lossPerKm} ≠ ${fmt(pk)} (${fmt(Math.abs(r.totalLoss))} ÷ ${r.distance})`);
      const shortKm = criteria.shortSpanKm.value;
      if (r.distance >= shortKm && pk > criteria.lossPerKmWarn.value) add("R23", 3, "warn", "1.11 Span", r.page, `${tag}: ${fmt(pk)} dB/km สูงกว่าตัวอย่าง (เกณฑ์เตือน ${criteria.lossPerKmWarn.value} dB/km, ระยะ ${r.distance} km)`, "คนตรวจ");
      if (r.distance < shortKm && Math.abs(r.totalLoss) > criteria.shortSpanTotalLossWarn.value) add("R23", 3, "warn", "1.11 Span", r.page, `${tag}: span สั้น ${r.distance} km total loss ${fmt(Math.abs(r.totalLoss))} dB สูงกว่าตัวอย่าง (เกณฑ์เตือน ${criteria.shortSpanTotalLossWarn.value} dB)`, "คนตรวจ");
    }
  }

  // ---------- R24 TX/RX ในช่วง spec ----------
  for (const [sec, rows] of [["1.12 TX", S.tx], ["1.13 RX", S.rx]])
    for (const r of rows) {
      const lo = Math.min(r.specLo, r.specHi), hi = Math.max(r.specLo, r.specHi);
      if (r.value < lo || r.value > hi) add("R24", 3, "fail", sec, r.page, `${r.slot} ${r.module} = ${r.value} dBm นอกช่วง ${r.specLo} ~ ${r.specHi}`);
    }

  // ---------- R25 visual / LCT / discovery ----------
  for (const v of S.visual) if (v.result === "FAIL") add("R25", 3, "fail", "1.8 Visual", v.page, `${v.item} = FAIL`);
  if (S.discovery && S.discovery.result !== "PASS") add("R25", 3, "fail", "1.10 Discovery", S.discovery.page, `Shelf/Pack discovery = '${S.discovery.result || "ว่าง"}'`);
  for (const l of S.lct) if (l.result === "FAIL") add("R25", 3, "fail", "1.14 LCT", l.page, `${l.item} = FAIL`);

  // ---------- R26 calibration ----------
  if (criteria.calibrationCheck.value) {
    if (!S.testEquipment.length) add("R26", 1, "fail", "1.3 Test Equipment", 7, "ไม่มีรายการเครื่องมือทดสอบ");
    for (const e of S.testEquipment) {
      const exp = parseDate(e.calTo);
      if (!exp) add("R26", 1, "fail", "1.3 Test Equipment", e.page, `${e.desc} S/N ${e.serial}: ไม่มีวันหมดอายุ calibration`);
      else if (de && exp < de) add("R26", 3, "fail", "1.3 Test Equipment", e.page, `${e.desc} S/N ${e.serial}: calibration หมดอายุ ${e.calTo} ก่อนวันติดตั้ง ${H.installEnd}`);
      else if (exp < today) add("R26", 3, "info", "1.3 Test Equipment", e.page, `${e.desc} S/N ${e.serial}: calibration ใช้ได้ ณ วันติดตั้ง แต่หมดอายุแล้ว (${e.calTo}) — งานใหม่หลังวันนี้ต้องใช้ใบใหม่`, "ระบบ");
    }
  }

  // ---------- section 2 ----------
  const net = S.network || {};
  const filled = Object.entries(net).filter(([, v]) => v && v.filled).map(([k]) => k);
  add("R02", 1, "info", "Section 2", null, filled.length ? `Network test ที่มีค่า: ${filled.join(", ")}` : "Section 2 Network test เป็น N/A ทั้งหมด (ทำระดับ link)");

  facts.spanPairs = spanPairs.map((p) => ({ far: p.far, distance: p.a.distance, rows: [p.a, p.b] }));
  return { issues, facts };
}

// R14/R17: ตรวจข้ามไซต์ในชุดเดียวกัน — span เดียวกันในเอกสาร 2 ไซต์ต้องมีค่าเท่ากัน
export function crossSiteChecks(results) {
  const byCode = new Map(results.map((r) => [norm(r.facts.code), r]));
  for (const r of results) {
    const self = norm(r.facts.code);
    for (const p of r.facts.spanPairs || []) {
      const other = [...byCode.keys()].find((k) => k !== self && (k.startsWith(p.far.slice(0, 4)) || p.far.startsWith(k.slice(0, 4))));
      if (!other) continue;
      const o = byCode.get(other);
      const theirs = (o.facts.spanPairs || []).find((q) => self.startsWith(q.far.slice(0, 4)) || q.far.startsWith(self.slice(0, 4)));
      if (!theirs) { r.issues.push({ rule: "R17", level: 2, severity: "warn", section: "1.11 Span", page: p.rows[0].page, msg: `span ไป ${p.far} ไม่พบในเอกสารของ ${o.facts.code}`, who: "ระบบ" }); continue; }
      if (theirs.distance !== p.distance) r.issues.push({ rule: "R17", level: 2, severity: "fail", section: "1.11 Span", page: p.rows[0].page, msg: `ระยะไป ${p.far} = ${p.distance} km แต่เอกสาร ${o.facts.code} ระบุ ${theirs.distance} km`, who: "ระบบ" });
      const mine = p.rows.map((x) => [x.valA, x.valB].sort().join("/")).sort().join(";");
      const yours = theirs.rows.map((x) => [x.valA, x.valB].sort().join("/")).sort().join(";");
      if (mine !== yours) r.issues.push({ rule: "R17", level: 2, severity: "warn", section: "1.11 Span", page: p.rows[0].page, msg: `ค่า TX/RX ของ span ไป ${p.far} ไม่ตรงกับเอกสาร ${o.facts.code}`, who: "คนตรวจ" });
    }
  }
}

export function summarize(issues) {
  const s = { fail: 0, warn: 0, info: 0, byLevel: { 1: 0, 2: 0, 3: 0 } };
  for (const i of issues) { s[i.severity]++; if (i.level && i.severity !== "info") s.byLevel[i.level]++; }
  s.status = s.fail ? "ไม่ผ่าน" : s.warn ? "ผ่านมีข้อสังเกต" : "ผ่าน";
  return s;
}
