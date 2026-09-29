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

// ocr: { inventory:[{page,text}], power:[...], neSetup:[...], neLabel:[...], fiberScope:[...], blockDiagram:[...] }
export function ocrChecks(ocr, site, facts) {
  const issues = [];
  const add = (rule, severity, section, page, msg, who = "คนตรวจ") => issues.push({ rule, level: 2, severity, section, page, msg, who, ocr: true });
  const S = site.satp;
  const code = facts.code || "";

  // O01 Inventory: การ์ดตามโปรไฟล์ + shelf + วันที่-เวลา PC
  const invText = clean(ocr.inventory.map((x) => x.text).join("\n"));
  if (ocr.inventory.length) {
    const cards = findCards(invText);
    const pc = PROFILE_CARDS[facts.profile];
    if (pc) {
      const missing = pc.need.filter((c) => !cards.includes(c));
      const extra = pc.forbid.filter((c) => cards.includes(c));
      if (missing.length) add("O01", "warn", "Attachment 1.4 Inventory", ocr.inventory[0].page, `OCR ไม่พบการ์ด ${missing.join(", ")} ที่โปรไฟล์ ${facts.profile} ควรมี (พบ: ${cards.join(", ") || "-"})`);
      if (extra.length) add("O01", "warn", "Attachment 1.4 Inventory", ocr.inventory[0].page, `OCR พบการ์ด ${extra.join(", ")} ซึ่งโปรไฟล์ ${facts.profile} ไม่ควรมี`);
      if (!missing.length && !extra.length) add("O01", "info", "Attachment 1.4 Inventory", ocr.inventory[0].page, `OCR พบการ์ดครบตามโปรไฟล์: ${cards.join(", ")}`, "ระบบ");
    } else add("O01", "info", "Attachment 1.4 Inventory", ocr.inventory[0].page, `OCR พบการ์ด: ${cards.join(", ") || "อ่านไม่ได้"}`, "ระบบ");
    const shelfNos = new Set([...invText.matchAll(/(?:shelf|sh)\s*[#:]?\s*0?(\d)\b/gi)].map((m) => m[1]));
    const want = Object.values(facts.shelves || {}).reduce((a, b) => a + b, 0);
    if (want >= 2 && shelfNos.size && shelfNos.size < want) add("O01", "warn", "Attachment 1.4 Inventory", ocr.inventory[0].page, `OCR พบ shelf ${[...shelfNos].join(", ")} แต่ไซต์นี้ควรมี ${want} shelf`);
    if (!DATE_RE.test(invText) || !TIME_RE.test(invText)) add("O07", "warn", "Attachment 1.4 Inventory", ocr.inventory[0].page, "OCR ไม่พบวันที่-เวลาบน screenshot (template กำหนดให้ถ่ายพร้อม Date & Time ของ PC)");
  }

  // O02 Power screenshots: ค่าแรงดันในรูป vs ตาราง 1.5
  if (ocr.power.length && S?.power) {
    const txt = clean(ocr.power.map((x) => x.text).join(" "));
    const vals = [...txt.matchAll(VOLT_RE)].map((m) => parseFloat(m[1].replace(",", "."))).filter((v) => v >= 30 && v <= 300);
    const want = [S.power.main, S.power.standby].filter((v) => v != null).map(Math.abs);
    if (!vals.length) add("O02", "info", "Attachment 1.5 Power", ocr.power[0].page, "OCR อ่านค่าแรงดันจาก screenshot ไม่ได้", "คนตรวจ");
    else {
      const miss = want.filter((w) => !vals.some((v) => Math.abs(v - w) <= 1.0));
      if (miss.length) add("O02", "info", "Attachment 1.5 Power", ocr.power[0].page, `ค่าในตาราง 1.5 (${want.join(", ")} V) ไม่พบใน screenshot — OCR อ่านตัวเลขบนรูปมิเตอร์/LCT ได้จำกัด ให้คนดู (อ่านได้: ${[...new Set(vals)].slice(0, 6).join(", ")})`);
      else add("O02", "info", "Attachment 1.5 Power", ocr.power[0].page, `screenshot แสดงค่าตรงกับตาราง 1.5 (${want.join(", ")} V)`, "ระบบ");
    }
  }

  // O03 NE setup: IP และชื่อ NE
  if (ocr.neSetup.length) {
    const txt = clean(ocr.neSetup.map((x) => x.text).join(" "));
    const ips = [...txt.matchAll(IP_RE)].map((m) => m[0]);
    const hip = S?.header.ip;
    if (hip && ips.length && !ips.includes(hip)) add("O03", "warn", "Attachment 1.9 NE Setup", ocr.neSetup[0].page, `IP ใน screenshot (${[...new Set(ips)].slice(0, 4).join(", ")}) ไม่มี ${hip} ตามหน้า 1`);
    else if (hip && ips.includes(hip)) add("O03", "info", "Attachment 1.9 NE Setup", ocr.neSetup[0].page, `screenshot มี IP ${hip} ตรงหน้า 1`, "ระบบ");
    if (code && !fuzzyHas(txt, code)) add("O03", "warn", "Attachment 1.9 NE Setup", ocr.neSetup[0].page, `OCR ไม่พบชื่อ NE '${code}' ใน screenshot`);
    if (!DATE_RE.test(txt) || !TIME_RE.test(txt)) add("O07", "warn", "Attachment 1.9 NE Setup", ocr.neSetup[0].page, "OCR ไม่พบวันที่-เวลาบน screenshot");
  }

  // O04 ป้าย NE ID
  if (ocr.neLabel.length) {
    const txt = clean(ocr.neLabel.map((x) => x.text).join(" "));
    if (code && !fuzzyHas(txt, code)) add("O04", "warn", "Attachment 1.8 (b) NE ID", ocr.neLabel[0].page, `OCR ไม่พบรหัส '${code}' บนป้าย NE ID (อ่านได้: "${txt.trim().slice(0, 60)}")`);
    else if (code) add("O04", "info", "Attachment 1.8 (b) NE ID", ocr.neLabel[0].page, `ป้าย NE ID มีรหัส ${code}`, "ระบบ");
  }

  // O05 Fiber scope: PASS/FAIL ในรูป
  let fsPass = 0, fsFail = 0, fsNone = 0;
  for (const x of ocr.fiberScope) {
    const t = x.text.toUpperCase();
    if (/\bFAIL/.test(t)) { fsFail++; add("O05", "warn", "Attachment 1.15 Fiber Scope", x.page, `รูป fiber scope หน้า ${x.page} มีคำว่า FAIL`); }
    else if (/\bPASS/.test(t)) fsPass++;
    else fsNone++;
  }
  if (ocr.fiberScope.length) {
    add("O05", fsFail ? "warn" : "info", "Attachment 1.15 Fiber Scope", ocr.fiberScope[0].page, `Fiber scope ${ocr.fiberScope.length} รูป: PASS ${fsPass}, FAIL ${fsFail}, อ่านไม่ได้ ${fsNone}`, "ระบบ");
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
      if (far.size && missing.length) add("O05", "warn", "Attachment 1.15 Fiber Scope", ocr.fiberScope[0].page, `ชื่อรายงาน fiber scope ไม่ครบทุกทิศ: ไม่พบ ${missing.join(", ")} (OCR อาจอ่านชื่อผิด ให้คนดู)`);
      else if (far.size) add("O05", "info", "Attachment 1.15 Fiber Scope", ocr.fiberScope[0].page, `Fiber scope มี LINE IN/OUT ครบทุกไซต์ปลายทาง (${[...far].join(", ")})`, "ระบบ");
    }
  }

  // O06 Block diagram: ไซต์ปลายทาง + การ์ด
  if (ocr.blockDiagram.length && S) {
    const txt = clean(ocr.blockDiagram.map((x) => x.text).join(" "));
    const far = new Set();
    for (const r of S.span) for (const s of [r.siteA, r.siteB]) if (!normCard(s).startsWith(normCard(code).slice(0, 4))) far.add(s.replace(/DCAG$/, ""));
    const missing = [...far].filter((f) => !fuzzyHas(txt, f.slice(0, 5)));
    if (missing.length) add("O06", "warn", "1.1 Block Diagram", ocr.blockDiagram[0].page, `ไซต์ปลายทางใน Span Loss (${missing.join(", ")}) ไม่พบใน Block Diagram`);
    else if (far.size) add("O06", "info", "1.1 Block Diagram", ocr.blockDiagram[0].page, `Block Diagram มีไซต์ปลายทางครบ: ${[...far].join(", ")}`, "ระบบ");
    const cards = findCards(txt);
    const pc = PROFILE_CARDS[facts.profile];
    if (pc) { const m = pc.need.filter((c) => !cards.includes(c) && c !== "OTDR"); if (m.length) add("O06", "info", "1.1 Block Diagram", ocr.blockDiagram[0].page, `OCR ไม่พบการ์ด ${m.join(", ")} ใน Block Diagram (อาจอ่านไม่ออกเพราะตัวเล็ก)`); }
    if (code && !fuzzyHas(txt, code)) add("O06", "warn", "1.1 Block Diagram", ocr.blockDiagram[0].page, `ชื่อ NE ใน Block Diagram ไม่มีรหัส ${code}`);
  }
  return issues;
}
