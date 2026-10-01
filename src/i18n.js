// ภาษาของหน้าเว็บ: ไทย (ค่าเริ่มต้น) / English — เก็บใน localStorage "satp:lang"
// L(th, en) → ข้อความตามภาษาปัจจุบัน (ใช้ตอน render) · M(th, en) → คู่ข้อความสำหรับประเด็นที่ engine สร้าง (เก็บทั้งสองภาษา แสดงตามภาษาตอนดู)
export const i18n = { lang: "th" };
export function initLang() { try { const l = localStorage.getItem("satp:lang"); if (l === "en" || l === "th") i18n.lang = l; } catch {} return i18n.lang; }
export function setLang(l) { i18n.lang = l === "en" ? "en" : "th"; try { localStorage.setItem("satp:lang", i18n.lang); } catch {} }
export const L = (th, en) => (i18n.lang === "en" ? en : th);
export const M = (th, en) => ({ th, en });
export const isPair = (m) => m && typeof m === "object" && "th" in m;
// ข้อความของประเด็น/หมายเหตุที่เก็บทั้งสองภาษา: {msg, msg_en} หรือ {th, en}
export const msgOf = (i) => (i18n.lang === "en" && (i.msg_en || i.en) ? i.msg_en || i.en : i.msg ?? i.th ?? "");

// ชื่อ section / ผู้ตรวจ / สถานะ ที่ engine ใช้เป็นภาษาไทย (เป็น key ภายใน) → แสดงเป็นอังกฤษ
const SECTION_EN = { "เอกสาร": "Documents", "ชื่อไฟล์": "File name", "SATP หน้า 1": "SATP page 1", "ATT หน้า 1": "ATT page 1", "โปรไฟล์": "Profile", "รายชื่อไซต์": "Site list", "1.8 Visual": "1.8 Visual", "1.11 Span Loss": "1.11 Span Loss" };
export const sectionText = (s) => (i18n.lang === "en" ? (SECTION_EN[s] || s).replace(/หน้า/g, "page") : s);
const WHO_EN = { "ระบบ": "System", "คนตรวจ": "Reviewer", "ROM": "ROM", "CPM": "CPM" };
export const whoText = (w) => (i18n.lang === "en" ? WHO_EN[w] || w : w);
export const SEV_TEXT = { fail: ["ไม่ผ่าน", "Fail"], warn: ["เตือน", "Warning"], info: ["ข้อมูล", "Info"] };
export const sevText = (s) => { const p = SEV_TEXT[s] || [s, s]; return L(p[0], p[1]); };
export const LEVEL_TEXT = { 0: ["-", "-"], 1: ["1 ครบถ้วน", "1 Completeness"], 2: ["2 สอดคล้อง", "2 Consistency"], 3: ["3 ค่าเทคนิค", "3 Technical values"] };
export const levelText = (l) => { const p = LEVEL_TEXT[l] || ["-", "-"]; return L(p[0], p[1]); };

// สถานะรวม (ค่าภายในเป็นไทย) → อังกฤษ
export function statusText(s) {
  if (i18n.lang !== "en" || !s) return s;
  return s
    .replace(/^ผ่าน \(ลูกค้าเซ็นแล้ว\)/, "Pass (customer signed)")
    .replace(/^ผ่านมีข้อสังเกต/, "Pass with remarks")
    .replace(/^ไม่ผ่าน/, "Fail")
    .replace(/^รอ ROM ตรวจรูป (\d+)/, "Awaiting ROM photo review ($1)")
    .replace(/^ผ่าน/, "Pass")
    .replace(/\(ยังไม่ตรวจ OCR\/รูป\)/, "(OCR/photos pending)")
    .replace(/\(ยังไม่ตรวจรูป\)/, "(photos pending)")
    .replace(/\(รูป Reject (\d+)\)/, "(photos: Reject $1)")
    .replace(/\(รูป Reject (\d+) รอ ROM (\d+)\)/, "(photos: Reject $1, awaiting ROM $2)")
    .replace(/\(รูป รอ ROM (\d+)\)/, "(photos: awaiting ROM $1)");
}
export const REJECT_REASONS_TH = ["รูปไม่ชัด/เบลอ", "รูปไม่ครบตามที่กำหนด", "ถ่ายผิดสิ่ง/ผิดมุม", "ป้าย/label ไม่ครบหรืออ่านไม่ได้", "การจัดสายไม่เรียบร้อย", "การ์ด/อุปกรณ์ไม่ตรง config", "กราวด์/สายไฟไม่ถูกต้อง", "รูปซ้ำจากไซต์อื่น", "อื่นๆ (ระบุ)"];
export const REJECT_REASONS_EN = ["Blurry / unclear", "Required photos missing", "Wrong subject / angle", "Labels missing or unreadable", "Untidy cabling", "Card / equipment not per config", "Grounding / power cabling wrong", "Photo reused from another site", "Other (specify)"];
export const reasonText = (th) => { const i = REJECT_REASONS_TH.indexOf(th); return i >= 0 ? L(th, REJECT_REASONS_EN[i]) : th; };
