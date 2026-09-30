// รูปแบบป้าย (labelling) ตามเอกสาร "TIME_AGRID2.0_DWDM_NOKIA_LABELLING FORMAT ON SITE" Rev 0 (19/11/2025) 30 หน้า
// ใช้ตรวจข้อความที่ OCR อ่านได้จากรูปถ่ายในแท็บตรวจรูป (หัวข้อ 1.8 a/b/d/e/f/g และ 1.6 Ground)
//
// สรุปรูปแบบจากเอกสาร (หน้า):
//  3  Rack overview        RACK03_BDW8R_ILA-501 · LOOPBACK IP: 10.204.89.146
//  4  Rack overview DC2DC  RACK ID: MA2-5F-E-010 · INSTALLATION DATE: 19 NOV 25 · KCHBWDCAG_RDM-501 · AGRID 2.0 · LOOPBACK IP: 10.204.88.146
//  5  Front cover          PSS-8_BDW8R_ILA-501 · LOOPBACK IP · A-GRID 2.0
//  6  Installation date    A-GRID 2.0 · INSTALLATION DATE: 13 NOVEMBER 2025
//  7-8 Shelf number        SHELF 01 / SHELF 02
//  9  Right bracket        TMLMA_ILA_501 · IP: 10.204.89.131
// 10  Card (AWBILA/EILA/RAMAN)  TX: 392MR_ILA_501 · RX: JM2WK_ILA_501   (รหัสไซต์ปลายทาง)
// 11  FDF side             PAGHJ_RACK03_FDF004_C18_(RX) · PAGHJ-AHTMJ · PAGHJ_ILA_501_SH01_SL04_LINE_OUT
// 12  Equipment side       FR: BDW8R_ILA_501 · SH01/SL02/LINE_IN|LINE_OUT
// 13  ES1/ES2              SH01_SL12_ES1 · SH02_SL12_ES2
// 14-16 Grounding          PAGHJ_ILA_501 GND A-GRID 2.0 · RACK03/BDW8R_ILA_501 SHELF 01 GROUND · 7IJRJ_ILA_501 SHELF 01 GND
// 17  PDU                  TKGLM_ILA_501 SH01 A1 / SH02 A2 / SH01 B1 / SH02 B2
// 18-19 DPCDB power cable  RACK03_KLIAB_ILA_501 · SHELF 01 · NOKIA POWER A · A-GRID 2.0
// 20  Power card           POWER B1
// 21  2 NE ใน rack เดียว   SPTIK_ILA1_501 / LB IP: 10.204.89.136 · SPTIK_ILA2_501 / LB IP: 10.204.89.137
// 22-23 Power cable→card   SHELF 02 POWER A2 · SHELF 01_ILA2 POWER A3
// 24-25 Patchcord          FR: SPTIK_ILA2_501 SH01/SL04/LINE_IN · TO: R02/FDF003/C:42 RX Fr CLSPP_RDM_501 · TX To TTDCK_ILA_501
// 26-27 DCPDB→PDU          RACK05/SPTIK_ILA2_501 · NOKIA POWER A1 (+) · AGRID 2.0
// 28-30 เครื่องพิมพ์ป้าย   NIIMBOT D110 12.5×109 mm / Brother 12 mm · เหลือง/ดำ

export const LABEL_FORMAT_DOC = "TIME_AGRID2.0_DWDM_NOKIA_LABELLING FORMAT ON SITE Rev 0 (19/11/2025)";

// สิ่งที่คาดว่าจะอ่านได้ในรูปแต่ละหัวข้อ (ใช้ตัดสินว่า "ไม่พบ" เป็นข้อผิดหรือแค่หมายเหตุ)
// requireCode = ป้ายในหัวข้อนี้ต้องมีรหัสไซต์ชัดเจน (เป็นเนื้อหาหลักของรูป) → ไม่พบ = ต้องให้ ROM ดู
export const TOPIC_RULES = {
  "(a) Rack Installation": { requireCode: false, tokens: ["RACK", "LOOPBACK", "IP", "INSTALLATION"], desc: "ป้ายหน้าตู้: RACKnn_<ไซต์>_<ชนิด>-<เลข>, LOOPBACK IP, INSTALLATION DATE" },
  "(b) NE ID Labeling": { requireCode: true, tokens: ["IP", "LOOPBACK", "LB"], desc: "ป้าย NE ID: <ไซต์>_<ชนิด>_<เลข> และ IP" },
  "(c) Shelf View": { requireCode: false, tokens: ["SHELF"], desc: "ป้าย SHELF 01/02" },
  "(d) Power Breaker Cabling and Tagging": { requireCode: false, tokens: ["POWER", "A1", "A2", "B1", "B2", "SH01", "SH02"], desc: "ป้ายสายไฟ: <ไซต์>_<ชนิด>_<เลข> SH01 A1/B1, NOKIA POWER A/B" },
  "(e) Inter-Card and Inter-Shelf Cabling and Labeling": { requireCode: false, tokens: ["LINE_IN", "LINE_OUT", "LINE IN", "LINE OUT", "TX", "RX", "ES1", "ES2", "SH01", "SH02", "FR:"], desc: "ป้ายสาย: FR: <ไซต์>_<ชนิด>_<เลข> SHxx/SLyy/LINE_IN|OUT, TX:/RX: <ไซต์ปลายทาง>, SHxx_SLyy_ES1/ES2" },
  "(f) Shelf and Rack Grounding": { requireCode: false, tokens: ["GND", "GROUND", "GROUNDING"], desc: "ป้ายกราวด์: <ไซต์>_<ชนิด>_<เลข> SHELF 01 GND/GROUND" },
  "(g) ODF View": { requireCode: false, tokens: ["FDF", "ODF", "LINE_IN", "LINE_OUT", "RX", "TX"], desc: "ป้าย FDF: <ไซต์>_RACKnn_FDFnnn_Cnn_(RX|TX), <ไซต์>-<ปลายทาง>" },
  "1.6 Ground": { requireCode: false, tokens: ["GND", "GROUND"], desc: "ป้ายกราวด์" },
};

const norm = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hamming5 = (a, b) => { if (a.length !== b.length) return 9; let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

// ค่าที่คาดหวังของไซต์จากผลตรวจ: รหัส, ชื่อ NE, IP, ไซต์ปลายทาง (จากตาราง Span Loss), โปรเจกต์
export function labelExpectations(r) {
  const S = r.site.satp, H = S?.header || {}, f = r.facts;
  const code = norm(f.code);
  const neighbours = new Set();
  for (const row of S?.span || []) for (const s of [row.siteA, row.siteB]) { const n = norm(s).slice(0, 5); if (n && n !== code.slice(0, 5)) neighbours.add(n); }
  return { code, code5: code.slice(0, 5), nodeType: f.nodeType || "", suffix: f.suffix || "", ip: H.ip || "", neighbours: [...neighbours], project: f.project || "" };
}

// ตรวจข้อความ OCR ของรูปหนึ่งรูปตามหัวข้อ → { flags: [ต้องให้ ROM ดู], notes: [หมายเหตุ], found: {code, ip, otherCodes} }
// fromLabels = ข้อความมาจากบริเวณป้ายสีเหลืองโดยตรง (ถ้า false = OCR ทั้งรูป ซึ่งอาจอ่านข้อความกล้อง Timemark ที่มีรหัสไซต์อยู่แล้ว → ไม่นับว่าป้ายมีรหัส)
export function checkLabelText(topic, text, exp, fromLabels = true) {
  const out = { flags: [], notes: [], found: { code: false, ip: "", otherCodes: [], tokens: [], fromLabels } };
  const rule = TOPIC_RULES[topic];
  if (!rule) return out;
  const raw = (text || "").toUpperCase().replace(/TIME\s*[:：]\s*[A-Z0-9]{5}/g, " "); // ตัดบรรทัด "TIME:<ไซต์>" ของแอปกล้องออก
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  if (compact.length < 3) { out.notes.push("OCR อ่านตัวอักษรบนป้ายไม่ได้ (ตัวเล็กหรือไกล)"); if (rule.requireCode) out.flags.push(`ป้ายในรูปอ่านไม่ได้ — ต้องเห็นรหัสไซต์ ${exp.code5} ชัด (${rule.desc})`); return out; }

  // รหัสไซต์ของตัวเอง (ยอมให้ OCR ผิด 1 ตัวอักษรใน 5)
  let best = 9;
  for (let i = 0; i + 5 <= compact.length; i++) best = Math.min(best, hamming5(compact.slice(i, i + 5), exp.code5));
  out.found.code = best <= 1;

  // ชื่อ NE ในป้าย: <5 ตัว>_<ILA|RDM|EILA>[n]_<3 หลัก> → รหัสไซต์ที่ป้ายอ้างถึง
  const neRe = /([A-Z0-9]{5})(?:DCAG)?[ _\-\/]{0,2}(EILA|ILA|RDM)\d?[ _\-\/]{0,2}(\d{3})/g;
  const codes = new Set();
  for (const m of raw.replace(/\s+/g, " ").matchAll(neRe)) codes.add(m[1]);
  const isSelf = (c) => hamming5(c, exp.code5) <= 1;
  const isNeighbour = (c) => exp.neighbours.some((n) => hamming5(c, n) <= 1);
  out.found.otherCodes = [...codes].filter((c) => !isSelf(c));
  for (const c of out.found.otherCodes) {
    if (isNeighbour(c) && /\(e\)|\(g\)|Inter-Card|ODF/.test(topic)) out.notes.push(`ป้ายอ้างถึงไซต์ปลายทาง ${c} (ตรงตาราง Span Loss)`);
    else if (isNeighbour(c)) out.notes.push(`ป้ายมีรหัสไซต์ปลายทาง ${c}`);
    else out.flags.push(`ป้ายระบุไซต์ ${c} ไม่ใช่ ${exp.code5} และไม่ใช่ไซต์ปลายทาง — ป้ายผิดไซต์หรือรูปจากไซต์อื่น?`);
  }

  // IP บนป้าย vs หน้า 1
  const ipm = raw.match(/\b\d{1,3}[.,]\d{1,3}[.,]\d{1,3}[.,]\d{1,3}\b/);
  if (ipm && exp.ip) {
    const got = ipm[0].replace(/,/g, "."), want = exp.ip.trim();
    out.found.ip = got;
    const a = got.split("."), b = want.split(".");
    const diff = a.filter((x, i) => x !== b[i]).length;
    if (diff === 0) out.notes.push(`IP บนป้าย ${got} ตรงหน้า 1`);
    else if (diff === 1 && a[3] !== b[3]) out.flags.push(`IP บนป้าย ${got} ≠ หน้า 1 ${want}`);
    else if (diff >= 2) out.flags.push(`IP บนป้าย ${got} ≠ หน้า 1 ${want}`);
    else out.notes.push(`IP บนป้าย ${got} ใกล้เคียงหน้า 1 ${want} (OCR อาจอ่านผิด)`);
  }

  // คำสำคัญของหัวข้อ
  out.found.tokens = rule.tokens.filter((t) => raw.includes(t));
  if (out.found.code && !fromLabels) { out.found.code = false; out.notes.push(`พบรหัสไซต์ ${exp.code5} ในรูป (ไม่พบป้ายสีเหลือง อาจเป็นข้อความอื่น)`); }
  else if (out.found.code) out.notes.push(`ป้ายมีรหัสไซต์ ${exp.code5}`);
  else if (rule.requireCode && fromLabels) out.flags.push(`OCR ไม่พบรหัสไซต์ ${exp.code5} บนป้าย (อ่านได้: "${raw.replace(/\s+/g, " ").trim().slice(0, 50)}") — ${rule.desc}`);
  else if (rule.requireCode) out.flags.push(`ไม่พบป้ายสีเหลืองในรูป — ${rule.desc}`);
  else if (!out.found.tokens.length) out.notes.push(`OCR ไม่พบรหัสไซต์หรือคำสำคัญของหัวข้อ (อ่านได้: "${raw.replace(/\s+/g, " ").trim().slice(0, 40)}")`);
  if (/DC2DC/.test(raw) && exp.project === "AGRID") out.flags.push("ป้ายระบุโปรเจกต์ DC2DC แต่เอกสารเป็น AGRID");
  if (/A-?GRID/.test(raw) && exp.project === "DC2DC") out.notes.push("ป้ายระบุ AGRID 2.0 (ไซต์ DC2DC ใช้ป้ายรูปแบบเดียวกัน)");
  return out;
}

// หัวข้อที่ต้อง OCR ป้าย
export const LABEL_TOPICS = Object.keys(TOPIC_RULES);
export function labelTopicOf(section, topic) { return TOPIC_RULES[topic] ? topic : TOPIC_RULES[section] ? section : null; }
