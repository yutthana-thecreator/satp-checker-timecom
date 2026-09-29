// โปรไฟล์อ้างอิง P1–P5 สร้างจากเอกสารตัวอย่าง 46 ไซต์ (AGRID 34 + DC2DC 12) วันที่ 29/09/2026
// ไซต์ใหม่ต้องตรงทุกเงื่อนไขของโปรไฟล์จึงจะใช้เกณฑ์ของโปรไฟล์นั้น
// ค่าเกณฑ์ที่มาจากสถิติตัวอย่าง (ไม่ใช่ template) ตั้งเป็น "warn" ให้คนดู ไม่ใช่ "fail"

export const DEFAULT_CRITERIA = {
  // ที่มา: template SATP 1.5 (-40.5 ~ -57.0 V)
  dc48: { min: 40.5, max: 57.0, source: "template 1.5" },
  // ที่มา: ตัวอย่าง DC2DC 20 ค่า 231–247 V; ตั้ง 240 V ±10%
  hvdc: { min: 216, max: 264, source: "ตัวอย่าง DC2DC + เผื่อ 10%" },
  // ไฟ AC (PSI-M) — ไม่มีตัวอย่าง: ว่าง = รายงานค่าอย่างเดียว
  ac: { min: null, max: null, source: "ยังไม่มีตัวอย่าง" },
  // ที่มา: template 1.6 (< 1 Ohm)
  groundMax: { value: 1.0, source: "template 1.6" },
  // ค่ากราวด์ที่ไม่ใช่ตัวเลข (OL, N/A) — template บอกให้วัดจริง
  groundAllowNonNumeric: { value: false, source: "template 1.6" },
  // loss/km สำหรับ span ยาว: median 0.29, p95 0.42, max 0.66 จากตัวอย่าง 170 ค่า
  lossPerKmWarn: { value: 0.45, minDistanceKm: 10, source: "p95 ตัวอย่าง span ≥10 km" },
  // span สั้น (<10 km) ใช้ total loss: median 4.3, p95 6.9 จากตัวอย่าง 24 ค่า
  shortSpanTotalLossWarn: { value: 7.0, source: "p95 ตัวอย่าง span <10 km" },
  // ความคลาดเคลื่อนที่ยอมได้ระหว่าง Total Loss กับ TX−RX
  lossTolerance: { value: 0.06, source: "ปัดทศนิยม 2 ตำแหน่ง" },
  // ระยะ span สั้น/ยาว
  shortSpanKm: { value: 10, source: "ตัวอย่าง DC2DC 0.6–6 km vs AGRID 18–86 km" },
  // ใบ calibration ต้องไม่หมดอายุ ณ วันติดตั้ง
  calibrationCheck: { value: true, source: "template 1.3" },

};

export const PROFILES = [
  {
    id: "P1",
    name: "AGRID ILA — PSS-8 ×1, AWBILA ×2, 2 ทิศ, -48 V",
    match: { nodeType: "ILA", shelves: { "PSS-8": 1 }, power: "dc48", modules: ["SWR-1.2O", "SWR-1.20", "SWU12O", "SWU120"], degrees: [2, 2] },
    samples: 11,
    expect: { spanRows: 4, txRows: 2, rxRows: 2, shelfCount: 1, fiberScopeMin: 4 },
  },
  {
    id: "P2",
    name: "AGRID ILA + OTDR — PSS-8 ×2, AWBILA ×2 + OTDR, 2 ทิศ, -48 V",
    match: { nodeType: "ILA", shelves: { "PSS-8": 2 }, power: "dc48", modules: ["SWR-1.2O", "SWR-1.20", "SWU12O", "SWU120"], degrees: [2, 2] },
    samples: 11,
    expect: { spanRows: 4, txRows: 2, rxRows: 2, shelfCount: 2, fiberScopeMin: 4 },
  },
  {
    id: "P3",
    name: "AGRID ROADM — PSI-8L, OMDCL+IRDM32 ต่อทิศ, MSH4-FSB, 2–5 ทิศ, -48 V",
    match: { nodeType: "RDM", shelves: { "PSI-8L": [1, 3] }, power: "dc48", modules: ["SWR-1.2O", "SWR-1.20", "SWU12O", "SWU120"], degrees: [2, 5] },
    samples: 10,
    expect: { spanRowsPerDegree: 2, txRowsPerDegree: 1, rxRowsPerDegree: 1, fiberScopePerDegree: 2 },
  },
  {
    id: "P4",
    name: "DC2DC ROADM + Add/Drop — PSI-8L ×2, AAR-8A/MCS8-16/OPSUM, 2–3 ทิศ, HVDC 240 V",
    match: { nodeType: "RDM", shelves: { "PSI-8L": [2, 3] }, power: "hvdc", modules: ["SWR-1.2O", "SWR-1.20"], degrees: [2, 3] },
    samples: 10,
    expect: { spanRowsPerDegree: 2, txRowsPerDegree: 1, rxRowsPerDegree: 1, fiberScopePerDegree: 2, shortSpan: true },
  },
  {
    id: "P5",
    name: "DC2DC ILA — PSS-8 ×1, AWBILA ×2, 2 ทิศ, -48 V (ใช้เกณฑ์ P1)",
    match: { nodeType: "ILA", shelves: { "PSS-8": 1 }, power: "dc48", modules: ["SWR-1.2O", "SWR-1.20"], degrees: [2, 2], project: "DC2DC" },
    samples: 1,
    expect: { spanRows: 4, txRows: 2, rxRows: 2, shelfCount: 1, fiberScopeMin: 4 },
  },
];

export function powerSystem(volts) {
  const v = Math.abs(volts ?? NaN);
  if (!isFinite(v)) return "unknown";
  if (v >= 100) return "hvdc";
  if (v >= 30) return "dc48";
  return "ac";
}

// โปรไฟล์ที่เรียนรู้จากการยืนยันของ ROM (ตั้งค่าจาก UI ตอนโหลด/เมื่อมีการบันทึกใหม่)
export const LEARNED_PROFILES = [];
export function setLearnedProfiles(list) { LEARNED_PROFILES.splice(0, LEARNED_PROFILES.length, ...list); }

// จับคู่โปรไฟล์: คืน {profile, mismatches[]} — mismatches ว่าง = ตรงทุกข้อ
export function matchProfile(facts) {
  // facts: { nodeType, project, shelves:{type:count}|null, power:'dc48'|'hvdc'|'ac'|'unknown', modules:Set, degrees:number }
  const results = [];
  for (const p of [...PROFILES, ...LEARNED_PROFILES]) {
    const mm = [];
    const M = p.match;
    if (facts.nodeType !== M.nodeType) mm.push(`ประเภท ${facts.nodeType || "?"} ≠ ${M.nodeType}`);
    if (M.project && facts.project !== M.project) mm.push(`โปรเจกต์ ${facts.project} ≠ ${M.project}`);
    if (facts.shelves) {
      for (const [t, want] of Object.entries(M.shelves)) {
        const have = facts.shelves[t] || 0;
        const ok = Array.isArray(want) ? have >= want[0] && have <= want[1] : have === want;
        if (!ok) mm.push(`shelf ${t} ×${have} (โปรไฟล์ ${Array.isArray(want) ? want.join("–") : want})`);
      }
      for (const t of Object.keys(facts.shelves)) if (!(t in M.shelves) && facts.shelves[t] > 0) mm.push(`มี shelf ${t} ที่โปรไฟล์ไม่มี`);
    }
    if (facts.power !== "unknown" && facts.power !== M.power) mm.push(`ระบบไฟ ${facts.power} ≠ ${M.power}`);
    for (const m of facts.modules) if (!M.modules.includes(m)) mm.push(`โมดูล ${m} ไม่อยู่ในโปรไฟล์`);
    if (facts.degrees < M.degrees[0] || facts.degrees > M.degrees[1]) mm.push(`${facts.degrees} ทิศ (โปรไฟล์ ${M.degrees[0]}–${M.degrees[1]})`);
    results.push({ profile: p, mismatches: mm });
  }
  // P5 ซ้อนกับ P1 — เลือกที่ตรงและมี project ตรงก่อน
  const exact = results.filter((r) => r.mismatches.length === 0).sort((a, b) => (b.profile.match.project ? 1 : 0) - (a.profile.match.project ? 1 : 0));
  if (exact.length) return exact[0];
  results.sort((a, b) => a.mismatches.length - b.mismatches.length);
  return { profile: null, nearest: results[0].profile, mismatches: results[0].mismatches };
}
