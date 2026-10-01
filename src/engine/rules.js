// กฎตรวจ R01–R26 (ตรงกับชีท "2_กฎตรวจ" ใน AI_Acceptance_Check_Reference.xlsx)
// ระดับ 1 ครบถ้วน · 2 สอดคล้อง · 3 ค่าทางเทคนิค
// ผลแต่ละข้อ: { rule, level, severity: 'fail'|'warn'|'info', section, page, msg, who }

import { parseDate } from "./parse.js";
import { DEFAULT_CRITERIA, matchProfile, powerSystem } from "./profiles.js";
import { SITES } from "../data/sites.js";
import { M, isPair } from "../i18n.js";

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const fmt = (n) => (n == null ? "-" : Number(n).toFixed(2));

export function lookupSite(code, neType, suffix) {
  const c = norm(code).replace(/DCAG$/, "");
  const cands = SITES.filter((s) => norm(s.code) === c);
  if (!cands.length) return null;
  return cands.find((s) => s.nodeType === neType && s.suffix === suffix) || cands.find((s) => s.nodeType === neType) || cands[0];
}

// ชนิดโหนดแบบอ่านง่าย จาก NE type + shelf + จำนวนทิศ (+ Add/Drop เมื่อเป็น DC2DC ROADM)
export function nodeKind(f) {
  const sh = f.shelves || {};
  if (f.nodeType === "EILA") return "EILA";
  if (f.nodeType === "ILA") return (sh["PSS-8"] || 0) >= 2 ? "ILA + OTDR" : "ILA";
  if (f.nodeType === "RDM") {
    const ad = f.project === "DC2DC" || (sh["PSI-M"] || 0) > 0 ? " + Add/Drop" : "";
    return `ROADM ${f.degrees || "?"}D${ad}`;
  }
  return f.nodeType || "?";
}

export function checkSite(site, criteria = DEFAULT_CRITERIA, today = new Date()) {
  // site: { code, folder, satp: parsedSatp|null, att: parsedAtt|null, satpFile, attFile, pagesSatp, pagesAtt }
  const issues = [];
  const add = (rule, level, severity, section, page, msg, who = "ระบบ") => issues.push({ rule, level, severity, section, page, ...(isPair(msg) ? { msg: msg.th, msg_en: msg.en } : { msg }), who });
  const S = site.satp, A = site.att;
  const facts = { code: site.code };

  // ---------- R01 มีครบ 2 ไฟล์ และเป็นของไซต์เดียวกัน ----------
  if (!S) add("R01", 1, "fail", "เอกสาร", null, M("ไม่พบไฟล์ SATP", "SATP file not found"));
  if (!A) add("R01", 1, "fail", "เอกสาร", null, M("ไม่พบไฟล์ Attachment Report", "Attachment Report file not found"));
  if (!S) return { issues, facts };

  const H = S.header;
  const fileInfo = S.file || {};
  const code = norm(H.neCode || fileInfo.code || site.code);
  facts.code = H.neCode || fileInfo.code || site.code;
  facts.nodeType = H.neType || fileInfo.nodeType;
  facts.suffix = H.neSuffix || fileInfo.suffix;
  facts.project = /DC2DC/i.test(H.project) ? "DC2DC" : /AGRID/i.test(H.project) ? "AGRID" : fileInfo.project;
  if (fileInfo.code && norm(fileInfo.code) !== code) add("R01", 2, "fail", "ชื่อไฟล์", 1, M(`ชื่อไฟล์ SATP ระบุไซต์ ${fileInfo.code} แต่ Station Name เป็น ${H.neCode}`, `SATP file name says site ${fileInfo.code} but Station Name is ${H.neCode}`));
  if (A?.file?.code && norm(A.file.code) !== code) add("R01", 2, "fail", "ชื่อไฟล์", 1, M(`ไฟล์ Attachment เป็นของไซต์ ${A.file.code} ไม่ใช่ ${facts.code}`, `Attachment file belongs to site ${A.file.code}, not ${facts.code}`));
  if (site.folderCode && norm(site.folderCode) !== code) add("R01", 2, "warn", "ชื่อไฟล์", 1, M(`โฟลเดอร์ ${site.folderCode} แต่เอกสารเป็นของไซต์ ${facts.code}`, `Folder ${site.folderCode} but the documents belong to site ${facts.code}`));

  // ---------- R02 จำนวนหน้า/section ----------
  if (S.numPages !== 35) add("R02", 1, "fail", "SATP", null, M(`SATP มี ${S.numPages} หน้า (template 35 หน้า)`, `SATP has ${S.numPages} pages (template: 35)`));
  for (const [k, label, pg] of [["power", "1.5 Power Supply", S.power], ["ground", "1.6 Ground", S.ground], ["software", "1.7 Equipment Config", S.software], ["neSetup", "1.9 NE Setup", S.neSetup], ["discovery", "1.10 Discovery", S.discovery]])
    if (!S[k]) add("R02", 1, "fail", label, null, M(`ไม่พบ section ${label}`, `Section ${label} not found`));
  if (!S.span.length) add("R02", 1, "fail", "1.11 Span Loss", null, M("ไม่พบตาราง Span Loss หรืออ่านไม่ได้", "Span Loss table missing or unreadable"));
  if (!S.tx.length) add("R02", 1, "fail", "1.12 TX", null, M("ไม่พบตาราง TX Power", "TX Power table not found"));
  if (!S.rx.length) add("R02", 1, "fail", "1.13 RX", null, M("ไม่พบตาราง RX Power", "RX Power table not found"));
  if (!S.visual.length) add("R02", 1, "fail", "1.8 Visual", null, M("ไม่พบตาราง Visual Inspection", "Visual Inspection table not found"));

  // ---------- R03 หน้า 1 ----------
  for (const [f, label] of [["station", "Station Name"], ["ip", "IP Address"], ["model", "DWDM Model"], ["installStart", "Installation Start"], ["installEnd", "Installation End"]])
    if (!H[f]) add("R03", 1, "fail", "SATP หน้า 1", 1, M(`ไม่ได้กรอก ${label}`, `${label} not filled in`));
  // ขั้น "ก่อนส่งลูกค้า": Acceptance Date และลายเซ็น TIME ยังไม่ต้องมี → รายงานเป็นข้อมูล
  // ระบบตรวจเฉพาะเอกสารที่ subcon ส่งมาก่อน submit — Acceptance Date/ลายเซ็นลูกค้าไม่ใช่เงื่อนไข
  // ถ้าลูกค้าเซ็น/กรอก Acceptance Date มาแล้ว = ผ่านการ acceptance แล้ว ไม่ต้องตรวจซ้ำ (ตัดสินท้ายฟังก์ชัน)
  facts.customerAccepted = !!H.acceptanceDate || !!(fileInfo.signed || A?.file?.signed);
  if (S.checklist && S.checklist.ticks < 5) add("R03", 1, "fail", "1.2 Checklist", S.checklist.page, M(`Checklist ติ๊ก ${S.checklist.ticks}/5 ข้อ`, `Checklist ticked ${S.checklist.ticks}/5 items`));

  // ---------- R04 Block diagram ----------
  if (!S.blockDiagram) add("R04", 1, "fail", "1.1 Block Diagram", 5, M("ไม่พบหน้า Block Diagram", "Block Diagram page not found"));
  else if (S.blockDiagram.photoCount === 0) add("R04", 1, "fail", "1.1 Block Diagram", S.blockDiagram.no, M("หน้า Block Diagram ไม่มีรูป", "Block Diagram page has no picture"));

  // ---------- R05 ลายเซ็น/วันที่ ----------
  const signPages = S.pageDates.filter((d) => d.page >= 6 && d.page <= 27);
  const withDate = signPages.filter((d) => d.date).length;
  // วันที่ในช่องลายเซ็นแยกไม่ได้ว่าเป็นของ NOKIA หรือ TIME → ไม่ใช้ตัดสินว่าลูกค้ารับแล้ว (ใช้ Acceptance Date / ไฟล์ _Signed เท่านั้น)
  facts.signatureDates = withDate;

  // ---------- R06 placeholder ----------
  if (S.placeholders.length) add("R06", 1, "fail", "SATP", S.placeholders[0], M(`มีข้อความ template ค้าง 'Type text here' หน้า ${S.placeholders.join(", ")}`, `Template placeholder 'Type text here' left on page ${S.placeholders.join(", ")}`));
  if (A?.placeholders?.length) add("R06", 1, "fail", "Attachment", A.placeholders[0], M(`มีข้อความ template ค้าง 'Type text here' หน้า ${A.placeholders.join(", ")}`, `Template placeholder 'Type text here' left on page ${A.placeholders.join(", ")}`));

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
  facts.nodeKind = nodeKind(facts);
  const pm = matchProfile(facts);
  facts.profile = pm.profile ? pm.profile.id : null;
  facts.profileName = pm.profile ? pm.profile.name : null;
  facts.nearestProfile = pm.nearest?.id || null;
  facts.profileMismatches = pm.mismatches;
  if (!pm.profile) add("P00", 0, "info", "โปรไฟล์", null, M(`ไม่ตรงโปรไฟล์อ้างอิงใด (ใกล้ ${pm.nearest?.id}: ${pm.mismatches.join("; ")}) → ใช้กฎทั่วไป, ROM ตรวจเอง`, `Matches no reference profile (nearest ${pm.nearest?.id}: ${pm.mismatches.join("; ")}) → general rules only, ROM reviews`), "ROM");
  else add("P00", 0, "info", "โปรไฟล์", null, M(`เทียบกับโปรไฟล์ ${pm.profile.id} (${pm.profile.name}) ตัวอย่าง ${pm.profile.samples} ไซต์`, `Compared with profile ${pm.profile.id} (${pm.profile.name}), ${pm.profile.samples} sample sites`));
  if (facts.nodeType === "EILA") add("P00", 0, "info", "โปรไฟล์", null, M("EILA — ยังไม่มีตัวอย่าง ตรวจเฉพาะกฎทั่วไป", "EILA — no samples yet, general rules only"), "ROM");

  // ---------- R07 Attachment รูปครบ ----------
  if (A) {
    const need = ["1.4", "1.5", "1.6", "1.8", "1.9", "1.15"];
    for (const s of need) if (!A.sections[s]) add("R07", 1, "fail", `Attachment ${s}`, null, M(`ไม่พบ section ${s} ใน Attachment`, `Section ${s} not found in Attachment`));
    const caps = ["a", "b", "c", "d", "e", "f", "g"];
    for (const c of caps) if (!A.captions[c]) add("R07", 1, "fail", "Attachment 1.8", A.sections["1.8"], M(`ไม่พบรูปหัวข้อ 1.8 (${c})`, `Photo for 1.8 (${c}) not found`));
    const shelfCount = Object.values(facts.shelves || {}).reduce((a, b) => a + b, 0);
    const shelfViews = (A.captions.c || []).filter((x) => /Shelf View/i.test(x.label)).length;
    const remarks = new Set(A.shelfRemarks.map((r) => +r.shelf)).size;
    if (shelfCount >= 2 && remarks < shelfCount) add("R07", 1, "warn", "Attachment 1.8 (c)/(f)", A.sections["1.8"], M(`ต้องมี remark Shelf # ครบ ${shelfCount} shelf แต่พบ ${remarks}`, `Shelf # remark required for all ${shelfCount} shelves, found ${remarks}`), "คนตรวจ");
    const fsNeed = facts.degrees * 2;
    if (A.fiberScope.length < fsNeed) add("R07", 1, "fail", "Attachment 1.15", A.sections["1.15"], M(`Fiber scope มี ${A.fiberScope.length} รูป ต้องมีอย่างน้อย ${fsNeed} (Line In/Out × ${facts.degrees} ทิศ)`, `Fiber scope has ${A.fiberScope.length} images, needs at least ${fsNeed} (Line In/Out × ${facts.degrees} directions)`));
    // photo counts per section from page list
    if (site.pagesAtt) {
      const secPages = Object.entries(A.sections).sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < secPages.length; i++) {
        const [sec, from] = secPages[i];
        const to = i + 1 < secPages.length ? secPages[i + 1][1] - 1 : site.pagesAtt.length;
        const photos = site.pagesAtt.slice(from - 1, to).reduce((n, p) => n + (p.photoCount || 0), 0);
        if (photos === 0) add("R07", 1, "fail", `Attachment ${sec}`, from, M(`section ${sec} ไม่มีรูปแนบ`, `Section ${sec} has no attached photo`));
      }
    }
  }

  // ---------- R08 SATP vs ATT หน้า 1 ----------
  if (A) {
    const AH = A.header;
    if (norm(AH.station) !== norm(H.station)) add("R08", 2, "fail", "ATT หน้า 1", 1, M(`Station Name ไม่ตรง: SATP '${H.station}' vs ATT '${AH.station}'`, `Station Name mismatch: SATP '${H.station}' vs ATT '${AH.station}'`));
    if (norm(AH.model).replace(/^1830/, "") !== norm(H.model).replace(/^1830/, "")) add("R08", 2, "fail", "ATT หน้า 1", 1, M(`DWDM Model ไม่ตรง: SATP '${H.model}' vs ATT '${AH.model}'`, `DWDM Model mismatch: SATP '${H.model}' vs ATT '${AH.model}'`));
    if (AH.ip && H.ip && AH.ip !== H.ip) add("R08", 2, "fail", "ATT หน้า 1", 1, M(`IP ไม่ตรง: SATP ${H.ip} vs ATT ${AH.ip}`, `IP mismatch: SATP ${H.ip} vs ATT ${AH.ip}`));
    if (AH.installStart && H.installStart && AH.installStart !== H.installStart) add("R08", 2, "warn", "ATT หน้า 1", 1, M(`วันติดตั้งไม่ตรง: SATP ${H.installStart} vs ATT ${AH.installStart}`, `Installation date mismatch: SATP ${H.installStart} vs ATT ${AH.installStart}`));
    if (A.file?.nodeType && S.file?.nodeType && (A.file.nodeType !== S.file.nodeType || A.file.suffix !== S.file.suffix)) add("R08", 2, "fail", "ชื่อไฟล์", 1, M(`ประเภทในชื่อไฟล์ไม่ตรง: SATP ${S.file.nodeType}_${S.file.suffix} vs ATT ${A.file.nodeType}_${A.file.suffix}`, `Type in file names differs: SATP ${S.file.nodeType}_${S.file.suffix} vs ATT ${A.file.nodeType}_${A.file.suffix}`));
  }
  if (fileInfo.nodeType && facts.nodeType && (fileInfo.nodeType !== facts.nodeType || fileInfo.suffix !== facts.suffix)) add("R08", 2, "fail", "SATP หน้า 1", 1, M(`ประเภทใน Station Name (${facts.nodeType}_${facts.suffix}) ≠ ชื่อไฟล์ (${fileInfo.nodeType}_${fileInfo.suffix})`, `Type in Station Name (${facts.nodeType}_${facts.suffix}) ≠ file name (${fileInfo.nodeType}_${fileInfo.suffix})`));

  // ---------- R09 model ตรงประเภท ----------
  const model = norm(H.model);
  if (/ILA/.test(facts.nodeType) && !/PSS8/.test(model)) add("R09", 2, "fail", "SATP หน้า 1", 1, M(`ILA ควรเป็น 1830 PSS-8 แต่ระบุ '${H.model}'`, `ILA should be 1830 PSS-8 but document says '${H.model}'`));
  if (facts.nodeType === "RDM" && !/PSI8L/.test(model)) add("R09", 2, "fail", "SATP หน้า 1", 1, M(`ROADM ควรเป็น 1830 PSI-8L แต่ระบุ '${H.model}'`, `ROADM should be 1830 PSI-8L but document says '${H.model}'`));
  if (siteRef) {
    const want = Object.keys(siteRef.shelves);
    const have = /PSI8L/.test(model) ? "PSI-8L" : /PSS8/.test(model) ? "PSS-8" : H.model;
    if (!want.includes(have)) add("R09", 2, "fail", "SATP หน้า 1", 1, M(`Model '${H.model}' ไม่ตรงรายชื่อไซต์ (${siteRef.shelfType})`, `Model '${H.model}' does not match the site list (${siteRef.shelfType})`));
  }

  // ---------- R10 Station Name มีรหัสไซต์ / ตรงรายชื่อไซต์ ----------
  if (!H.neCode) add("R10", 2, "fail", "SATP หน้า 1", 1, M(`อ่านรหัสไซต์จาก Station Name ไม่ได้: '${H.station}'`, `Cannot read site code from Station Name: '${H.station}'`));
  if (site.folderCode && H.neCode && norm(H.neCode) !== norm(site.folderCode)) add("R10", 2, "fail", "SATP หน้า 1", 1, M(`Station Name ระบุ ${H.neCode} แต่โฟลเดอร์/ชื่อไฟล์เป็น ${site.folderCode} (พิมพ์ผิด?)`, `Station Name says ${H.neCode} but folder/file name is ${site.folderCode} (typo?)`));
  if (siteRef) {
    if (siteRef.nodeType !== facts.nodeType || siteRef.suffix !== facts.suffix) add("R10", 2, "fail", "SATP หน้า 1", 1, M(`รายชื่อไซต์ระบุ ${siteRef.neName} แต่เอกสารเป็น ${facts.nodeType}_${facts.suffix}`, `Site list says ${siteRef.neName} but the document is ${facts.nodeType}_${facts.suffix}`));
    if (S.neSetup?.loopback && H.ip && S.neSetup.loopback !== H.ip) add("R10", 2, "fail", "1.9 NE Setup", S.neSetup.page, M(`Loopback IP ${S.neSetup.loopback} ≠ IP หน้า 1 ${H.ip}`, `Loopback IP ${S.neSetup.loopback} ≠ page 1 IP ${H.ip}`));
  } else if (S.neSetup?.loopback && H.ip && S.neSetup.loopback !== H.ip) add("R10", 2, "fail", "1.9 NE Setup", S.neSetup.page, M(`Loopback IP ${S.neSetup.loopback} ≠ IP หน้า 1 ${H.ip}`, `Loopback IP ${S.neSetup.loopback} ≠ page 1 IP ${H.ip}`));
  if (!siteRef) add("R10", 2, "info", "รายชื่อไซต์", 1, M(`ไซต์ ${facts.code} ไม่อยู่ในรายชื่อ 56 ไซต์ของโปรเจกต์ไทย (ตัวอย่าง/ไซต์นอกรายการ)`, `Site ${facts.code} is not in the 56-site Thai project list (sample / out-of-list site)`));

  // ---------- R11 วันที่ ----------
  const ds = parseDate(H.installStart), de = parseDate(H.installEnd);
  if (H.installStart && !ds) add("R11", 2, "fail", "SATP หน้า 1", 1, M(`วันที่ติดตั้ง Start รูปแบบผิด: '${H.installStart}'`, `Installation Start date format invalid: '${H.installStart}'`));
  if (H.installEnd && !de) add("R11", 2, "fail", "SATP หน้า 1", 1, M(`วันที่ติดตั้ง End รูปแบบผิด: '${H.installEnd}'`, `Installation End date format invalid: '${H.installEnd}'`));
  if (ds && de && de < ds) add("R11", 2, "fail", "SATP หน้า 1", 1, M(`End (${H.installEnd}) ก่อน Start (${H.installStart})`, `End (${H.installEnd}) is before Start (${H.installStart})`));
  if (ds && ds > today) add("R11", 2, "fail", "SATP หน้า 1", 1, M(`วันที่ติดตั้งอยู่ในอนาคต: ${H.installStart}`, `Installation date is in the future: ${H.installStart}`));


  // ---------- R12 / R13 span consistency ----------
  const self = code;
  const spanPairs = [];
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const a = spans[i], b = spans[i + 1];
    const pa = [norm(a.siteA), norm(a.siteB)].sort(), pb = [norm(b.siteA), norm(b.siteB)].sort();
    if (pa.join() !== pb.join()) add("R12", 2, "fail", "1.11 Span", a.page, M(`core1/core2 คู่ไซต์ไม่ตรงกัน: ${a.siteA}-${a.siteB} vs ${b.siteA}-${b.siteB} (พิมพ์รหัสไซต์ผิด?)`, `core1/core2 site pairs differ: ${a.siteA}-${a.siteB} vs ${b.siteA}-${b.siteB} (site code typo?)`));
    if (a.distance !== b.distance) add("R12", 2, "fail", "1.11 Span", a.page, M(`core1/core2 ระยะไม่เท่ากัน: ${a.distance} vs ${b.distance} km`, `core1/core2 distances differ: ${a.distance} vs ${b.distance} km`));
    spanPairs.push({ a, b, far: pa.find((x) => !x.startsWith(self.slice(0, 4))) || pa[0] });
  }
  if (spans.length % 2) add("R12", 2, "warn", "1.11 Span", spans[0].page, M(`จำนวนแถว Span เป็นเลขคี่ (${spans.length}) — ควรมี core1+core2 ต่อทิศ`, `Odd number of Span rows (${spans.length}) — expected core1+core2 per direction`));
  for (const r of spans) {
    const hasSelf = [norm(r.siteA), norm(r.siteB)].some((x) => x.startsWith(self.slice(0, 4)) || self.startsWith(x.slice(0, 4)));
    if (!hasSelf) add("R12", 2, "fail", "1.11 Span", r.page, M(`แถว core${r.core} ${r.siteA}-${r.siteB} ไม่มีไซต์ตัวเอง (${facts.code})`, `Row core${r.core} ${r.siteA}-${r.siteB} does not include this site (${facts.code})`));
    if (r.dirA === r.dirB) add("R13", 2, "fail", "1.11 Span", r.page, M(`core${r.core} ${r.siteA}-${r.siteB}: ทั้งสองฝั่งเป็น ${r.dirA} (ต้อง TX คู่ RX)`, `core${r.core} ${r.siteA}-${r.siteB}: both ends are ${r.dirA} (must be TX with RX)`));
  }
  if (/ILA/.test(facts.nodeType) && facts.degrees !== 2 && spans.length) add("R12", 1, "fail", "1.11 Span", spans[0].page, M(`ILA ต้องมี 2 ทิศ (4 แถว) แต่มี ${facts.degrees} ทิศ (${spans.length} แถว)`, `ILA must have 2 directions (4 rows) but has ${facts.degrees} (${spans.length} rows)`));

  // ---------- R15 TX/RX rows vs degrees, slot ซ้ำ ----------
  // ทิศของแถว TX/RX ไม่มีในตาราง 1.12/1.13 — อนุมานจากค่า dBm ที่ตรงกับฝั่งไซต์ตัวเองใน 1.11 Span Loss → ไซต์ปลายทาง
  const dirOf = (key, value) => {
    for (const r of spans) for (const [s, d, v, other] of [[r.siteA, r.dirA, r.valA, r.siteB], [r.siteB, r.dirB, r.valB, r.siteA]])
      if (d === key && norm(s).startsWith(self.slice(0, 4)) && value != null && Math.abs(v - value) < 0.005) return other;
    return null;
  };
  for (const [sec, rows, key] of [["1.12 TX", S.tx, "TX"], ["1.13 RX", S.rx, "RX"]]) {
    const slots = rows.map((r) => r.slot);
    const dup = [...new Set(slots.filter((s, i) => slots.indexOf(s) !== i))];
    if (dup.length) {
      const detail = (lang) => dup.map((slot) => {
        const hits = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.slot === slot).map(({ r, i }) => {
          const d = dirOf(key, r.value);
          return lang === "th" ? `แถว ${i + 1} ${r.value} dBm${d ? ` → ทิศ ${d}` : ""}` : `row ${i + 1} ${r.value} dBm${d ? ` → ${d}` : ""}`;
        });
        return `${slot} (${hits.join(" · ")})`;
      }).join(", ");
      add("R15", 2, "fail", sec, rows[0].page, M(`Slot ซ้ำ: ${detail("th")}`, `Duplicate slot: ${detail("en")}`));
    }
    if (rows.length && facts.degrees && rows.length !== facts.degrees) add("R15", 2, "fail", sec, rows[0].page, M(`จำนวนแถว ${rows.length} ≠ จำนวนทิศ ${facts.degrees}`, `${rows.length} rows ≠ ${facts.degrees} directions`));
  }
  if (S.tx.length && S.rx.length) {
    const ts = S.tx.map((r) => r.slot).sort().join(), rs = S.rx.map((r) => r.slot).sort().join();
    if (ts !== rs) add("R15", 2, "fail", "1.12/1.13", S.rx[0].page, M(`Slot ใน TX (${S.tx.map((r) => r.slot).join(", ")}) ≠ RX (${S.rx.map((r) => r.slot).join(", ")})`, `Slots in TX (${S.tx.map((r) => r.slot).join(", ")}) ≠ RX (${S.rx.map((r) => r.slot).join(", ")})`));
  }

  // ---------- R16 ค่า TX/RX ตรงกับ 1.11 ----------
  const selfVals = { TX: [], RX: [] };
  for (const r of spans) {
    for (const [s, d, v] of [[r.siteA, r.dirA, r.valA], [r.siteB, r.dirB, r.valB]]) if (norm(s).startsWith(self.slice(0, 4))) selfVals[d].push(v);
  }
  for (const [sec, rows, key] of [["1.12 TX", S.tx, "TX"], ["1.13 RX", S.rx, "RX"]])
    for (const r of rows) if (selfVals[key].length && !selfVals[key].some((v) => Math.abs(v - r.value) < 0.005)) add("R16", 2, "warn", sec, r.page, M(`${r.slot} ค่า ${r.value} dBm ไม่พบใน 1.11 Span Loss ฝั่ง ${key} ของไซต์ตัวเอง`, `${r.slot} value ${r.value} dBm not found on the ${key} side of this site in 1.11 Span Loss`));

  // ---------- R19/R20 power ----------
  if (S.power) {
    const c = criteria;
    for (const [k, v] of [["Main", S.power.main], ["Stand-by", S.power.standby]]) {
      if (v == null) { add("R19", 1, "fail", "1.5 Power", S.power.page, M(`ไม่มีค่าแรงดัน ${k}`, `No voltage value for ${k}`)); continue; }
      const av = Math.abs(v);
      if (facts.power === "dc48") { if (av < c.dc48.min || av > c.dc48.max) add("R19", 3, "fail", "1.5 Power", S.power.page, M(`${k} ${v} V นอกช่วง -${c.dc48.min} ~ -${c.dc48.max} V`, `${k} ${v} V outside -${c.dc48.min} ~ -${c.dc48.max} V`)); }
      else if (facts.power === "hvdc") { if (c.hvdc.min != null && (av < c.hvdc.min || av > c.hvdc.max)) add("R20", 3, "warn", "1.5 Power", S.power.page, M(`${k} ${v} V นอกช่วง HVDC ${c.hvdc.min}–${c.hvdc.max} V (เกณฑ์จากตัวอย่าง)`, `${k} ${v} V outside HVDC range ${c.hvdc.min}–${c.hvdc.max} V (threshold from samples)`), "คนตรวจ"); }
      else add("R20", 3, "info", "1.5 Power", S.power.page, M(`${k} ${v} V — ระบบไฟไม่ตรง -48V/HVDC ยังไม่มีเกณฑ์`, `${k} ${v} V — power system is neither -48V nor HVDC, no threshold yet`), "คนตรวจ");
    }
    if (facts.power === "hvdc") add("R20", 3, "info", "1.5 Power", S.power.page, M(`ไซต์ไฟ ~240 V — template ระบุช่วง -40.5~-57 V ไม่ตรงกับไซต์นี้ ต้องยืนยันเกณฑ์กับลูกค้า`, `~240 V site — template range -40.5~-57 V does not apply; confirm threshold with customer`), "CPM");
    for (const [k, v] of [["Main", S.power.breakerMain], ["Stand-by", S.power.breakerStandby]]) if (v !== "PASS") add("R19", 3, "fail", "1.5 Power", S.power.page, M(`Breaker ${k} = '${v || "ว่าง"}'`, `Breaker ${k} = '${v || "blank"}'`));
  }

  // ---------- R21 ground ----------
  if (S.ground) {
    for (const [k, g] of [["Rack–Busbar", S.ground.rackToBusbar], ["Shelf–Rack", S.ground.shelfToRack]]) {
      if (!g.raw) add("R21", 1, "fail", "1.6 Ground", S.ground.page, M(`ไม่มีค่ากราวด์ ${k}`, `No ground value for ${k}`));
      else if (g.value == null) add("R21", 3, criteria.groundAllowNonNumeric.value ? "info" : "fail", "1.6 Ground", S.ground.page, M(`ค่ากราวด์ ${k} = '${g.raw}' ไม่ใช่ตัวเลข (template ให้วัดค่า < 1 Ω)`, `Ground ${k} = '${g.raw}' is not a number (template requires a measured value < 1 Ω)`));
      else if (g.value >= criteria.groundMax.value) add("R21", 3, "fail", "1.6 Ground", S.ground.page, M(`ค่ากราวด์ ${k} ${g.value} Ω ≥ ${criteria.groundMax.value} Ω`, `Ground ${k} ${g.value} Ω ≥ ${criteria.groundMax.value} Ω`));
    }
  }

  // ---------- R22 / R23 span values ----------
  const tol = criteria.lossTolerance.value;
  for (const r of spans) {
    const tag = `core${r.core} ${r.siteA}-${r.siteB}`;
    if (r.dirA === r.dirB) continue;
    const tx = r.dirA === "TX" ? r.valA : r.valB, rx = r.dirA === "RX" ? r.valA : r.valB;
    if (rx > 0) add("R22", 3, "fail", "1.11 Span", r.page, M(`${tag}: RX เป็นค่าบวก (${rx}) น่าจะพิมพ์ผิด`, `${tag}: RX is positive (${rx}), probably a typo`));
    const loss = tx - rx;
    if (Math.abs(Math.abs(r.totalLoss) - Math.abs(loss)) > tol) add("R22", 3, "fail", "1.11 Span", r.page, M(`${tag}: Total Loss ${r.totalLoss} ≠ TX−RX = ${fmt(loss)}`, `${tag}: Total Loss ${r.totalLoss} ≠ TX−RX = ${fmt(loss)}`));
    if (r.distance > 0) {
      const pk = Math.abs(r.totalLoss) / r.distance;
      if (Math.abs(Math.abs(r.lossPerKm) - pk) > 0.011) add("R22", 3, "fail", "1.11 Span", r.page, M(`${tag}: Loss/km ${r.lossPerKm} ≠ ${fmt(pk)} (${fmt(Math.abs(r.totalLoss))} ÷ ${r.distance})`, `${tag}: Loss/km ${r.lossPerKm} ≠ ${fmt(pk)} (${fmt(Math.abs(r.totalLoss))} ÷ ${r.distance})`));
      const shortKm = criteria.shortSpanKm.value;
      if (r.distance >= shortKm && pk > criteria.lossPerKmWarn.value) add("R23", 3, "warn", "1.11 Span", r.page, M(`${tag}: ${fmt(pk)} dB/km สูงกว่าตัวอย่าง (เกณฑ์เตือน ${criteria.lossPerKmWarn.value} dB/km, ระยะ ${r.distance} km)`, `${tag}: ${fmt(pk)} dB/km higher than samples (warning threshold ${criteria.lossPerKmWarn.value} dB/km, distance ${r.distance} km)`), "คนตรวจ");
      if (r.distance < shortKm && Math.abs(r.totalLoss) > criteria.shortSpanTotalLossWarn.value) add("R23", 3, "warn", "1.11 Span", r.page, M(`${tag}: span สั้น ${r.distance} km total loss ${fmt(Math.abs(r.totalLoss))} dB สูงกว่าตัวอย่าง (เกณฑ์เตือน ${criteria.shortSpanTotalLossWarn.value} dB)`, `${tag}: short span ${r.distance} km, total loss ${fmt(Math.abs(r.totalLoss))} dB higher than samples (warning threshold ${criteria.shortSpanTotalLossWarn.value} dB)`), "คนตรวจ");
    }
  }

  // ---------- R24 TX/RX ในช่วง spec ----------
  for (const [sec, rows] of [["1.12 TX", S.tx], ["1.13 RX", S.rx]])
    for (const r of rows) {
      const lo = Math.min(r.specLo, r.specHi), hi = Math.max(r.specLo, r.specHi);
      if (r.value < lo || r.value > hi) add("R24", 3, "fail", sec, r.page, M(`${r.slot} ${r.module} = ${r.value} dBm นอกช่วง ${r.specLo} ~ ${r.specHi}`, `${r.slot} ${r.module} = ${r.value} dBm outside ${r.specLo} ~ ${r.specHi}`));
    }

  // ---------- R25 visual / LCT / discovery ----------
  for (const v of S.visual) if (v.result === "FAIL") add("R25", 3, "fail", "1.8 Visual", v.page, M(`${v.item} = FAIL`, `${v.item} = FAIL`));
  if (S.discovery && S.discovery.result !== "PASS") add("R25", 3, "fail", "1.10 Discovery", S.discovery.page, M(`Shelf/Pack discovery = '${S.discovery.result || "ว่าง"}'`, `Shelf/Pack discovery = '${S.discovery.result || "blank"}'`));
  for (const l of S.lct) if (l.result === "FAIL") add("R25", 3, "fail", "1.14 LCT", l.page, M(`${l.item} = FAIL`, `${l.item} = FAIL`));

  // ---------- R26 calibration ----------
  if (criteria.calibrationCheck.value) {
    if (!S.testEquipment.length) add("R26", 1, "fail", "1.3 Test Equipment", 7, M("ไม่มีรายการเครื่องมือทดสอบ", "No test equipment listed"));
    for (const e of S.testEquipment) {
      const exp = parseDate(e.calTo);
      if (!exp) add("R26", 1, "fail", "1.3 Test Equipment", e.page, M(`${e.desc} S/N ${e.serial}: ไม่มีวันหมดอายุ calibration`, `${e.desc} S/N ${e.serial}: no calibration expiry date`));
      else if (de && exp < de) add("R26", 3, "fail", "1.3 Test Equipment", e.page, M(`${e.desc} S/N ${e.serial}: calibration หมดอายุ ${e.calTo} ก่อนวันติดตั้ง ${H.installEnd}`, `${e.desc} S/N ${e.serial}: calibration expired ${e.calTo}, before installation ${H.installEnd}`));
      else if (exp < today) add("R26", 3, "info", "1.3 Test Equipment", e.page, M(`${e.desc} S/N ${e.serial}: calibration ใช้ได้ ณ วันติดตั้ง แต่หมดอายุแล้ว (${e.calTo}) — งานใหม่หลังวันนี้ต้องใช้ใบใหม่`, `${e.desc} S/N ${e.serial}: calibration valid at installation but expired now (${e.calTo}) — new work needs a new certificate`), "ระบบ");
    }
  }

  // ---------- section 2 ----------
  const net = S.network || {};
  const filled = Object.entries(net).filter(([, v]) => v && v.filled).map(([k]) => k);
  add("R02", 1, "info", "Section 2", null, filled.length ? M(`Network test ที่มีค่า: ${filled.join(", ")}`, `Network tests with values: ${filled.join(", ")}`) : M("Section 2 Network test เป็น N/A ทั้งหมด (ทำระดับ link)", "Section 2 Network test is all N/A (done at link level)"));

  facts.spanPairs = spanPairs.map((p) => ({ far: p.far, distance: p.a.distance, rows: [p.a, p.b] }));
  if (facts.customerAccepted) {
    // ลูกค้าเซ็น/กรอก Acceptance Date แล้ว → ถือว่าผ่านทั้งหมด ประเด็นที่พบเก็บไว้เป็นข้อมูลอ้างอิงเท่านั้น
    for (const i of issues) if (i.severity !== "info") { i.origSeverity = i.severity; i.severity = "info"; }
    issues.unshift({ rule: "A00", level: 0, severity: "info", section: "SATP หน้า 1", page: 1, msg: `ลูกค้าตรวจรับแล้ว (Acceptance Date ${H.acceptanceDate || "-"}${fileInfo.signed || A?.file?.signed ? ", ไฟล์ _Signed" : ""}) → ผ่านทั้งหมด ไม่ต้องตรวจก่อน submit`, who: "ระบบ", accepted: true });
  }
  return { issues, facts };
}

// R14/R17: ตรวจข้ามไซต์ในชุดเดียวกัน — span เดียวกันในเอกสาร 2 ไซต์ต้องมีค่าเท่ากัน
export function crossSiteChecks(results) {
  const byCode = new Map(results.map((r) => [norm(r.facts.code), r]));
  for (const r of results) {
    if (r.facts.customerAccepted) continue;
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
  s.status = issues.some((i) => i.accepted) ? "ผ่าน (ลูกค้าเซ็นแล้ว)" : s.fail ? "ไม่ผ่าน" : s.warn ? "ผ่านมีข้อสังเกต" : "ผ่าน";
  return s;
}
