// แปลงข้อความจาก extract.js เป็นข้อมูลโครงสร้างของ SATP และ Attachment Report
// ทุกค่าเก็บ page ไว้ด้วยเพื่ออ้างอิงในรายงาน

const NUM = "-?\\d+(?:[.,]\\d+)?";
const num = (s) => (s == null ? null : parseFloat(String(s).replace(",", ".").replace("--", "-")));
const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4,5})/;

export function docKind(fileName, pages) {
  const n = fileName.toUpperCase();
  if (/ATTACHMENT/.test(n)) return "ATT";
  if (/SATP/.test(n)) return "SATP";
  const p1 = pages[0]?.text.toUpperCase() || "";
  return /ATTACHMENT REPORT/.test(p1) ? "ATT" : "SATP";
}

export function parseFileName(fileName) {
  const base = fileName.replace(/\.pdf$/i, "");
  // รหัสไซต์ = token ก่อน _ILA/_RDM (เช่น 392MR_ILA_501, PSI-8L AKRHM_RDM_501, 37GWWDCAG_RDM_501)
  const m = base.match(/([A-Z0-9]{4,9})[ _](E?ILA)1?[ _-](\d01)/i) || base.match(/([A-Z0-9]{4,9})[ _](RDM)[ _-](\d01)/i);
  return {
    code: (m?.[1] || "").toUpperCase().replace(/DCAG$/, ""),
    nodeType: (m?.[2] || "").toUpperCase(),
    suffix: m?.[3] || "",
    signed: /signed/i.test(base),
    project: /DC2DC/i.test(base) ? "DC2DC" : /AGRID/i.test(base) ? "AGRID" : "",
  };
}

function findPage(pages, re, from = 0) {
  for (let i = from; i < pages.length; i++) if (re.test(pages[i].text)) return pages[i];
  return null;
}

function lineAfter(page, re) {
  const L = page.lines;
  for (let i = 0; i < L.length; i++) if (re.test(L[i])) return L[i + 1] || "";
  return "";
}

function grab(page, re) {
  const m = page?.text.match(re);
  return m ? m[1].trim() : "";
}

function parseHeader(p1) {
  const t = p1.text;
  const station = grab(p1, /Station Name\s*\|?\s*([^|]+?)\s*\|\s*Project/);
  const m = station.match(/\(([A-Z0-9]+?)(?:DCAG)?_(E?ILA)1?[_-](\d01)\)|\(([A-Z0-9]+?)(?:DCAG)?_(RDM)[_-](\d01)\)|\(PSI-8L ([A-Z0-9]+)_(RDM)_(\d01)\)/);
  const neCode = (m?.[1] || m?.[4] || m?.[7] || "").toUpperCase();
  const neType = (m?.[2] || m?.[5] || m?.[8] || "").toUpperCase();
  const neSuffix = m?.[3] || m?.[6] || m?.[9] || "";
  const inst = t.match(/Installation Date\s*\|?\s*Start:?\s*([\d/ ]+?)\s*\|?\s*End:?\s*([\d/ ]+?)(?:\s*\||$)/i);
  const accM = t.match(/Acceptance Date\s*\|?\s*(\d{1,2}\/\d{1,2}\/\d{4,5})?/);
  return {
    station,
    neCode,
    neType,
    neSuffix,
    project: grab(p1, /Link\s*\|?\s*Name\s*\|?\s*([^|]+)/) || grab(p1, /Project \/ Link\s*\|\s*Name\s*\|\s*([^|]+)/),
    ip: grab(p1, /IP Address\s*\|?\s*([\d. ]+)/).replace(/\s/g, ""),
    model: grab(p1, /DWDM Model\s*\|?\s*([^|]+?)\s*\|\s*Installation/),
    installStart: inst?.[1]?.replace(/\s/g, "") || "",
    installEnd: inst?.[2]?.replace(/\s/g, "") || "",
    acceptanceDate: accM?.[1] || "",
    page: 1,
  };
}

export function parseSatp(pages) {
  const out = { kind: "SATP", numPages: pages.length, header: parseHeader(pages[0]) };
  // ข้ามหน้า 1–2 (ปก + สารบัญ) เพราะสารบัญมีชื่อทุก section
  const P = (re) => findPage(pages, re, 2);

  // 1.2 checklist
  const pChk = P(/1\.2\s*\|?\s*CHECKLIST/);
  out.checklist = pChk ? { page: pChk.no, ticks: (pChk.text.match(/√/g) || []).length } : null;

  // 1.3 test equipment
  const pEq = P(/1\.3\s*\|?\s*LIST OF TEST EQUIPMENT/);
  out.testEquipment = [];
  if (pEq) {
    const L = pEq.lines;
    for (let i = 0; i < L.length; i++) {
      const m = L[i].match(/^(\d+)\s+([A-Z][A-Z ]+?)\s+(\d{5,})\s*$/);
      if (m) {
        const dates = (L[i + 1] + " " + (L[i + 2] || "")).match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
        out.testEquipment.push({ no: m[1], desc: m[2].trim(), serial: m[3], calFrom: dates[0] || "", calTo: dates[1] || "", page: pEq.no });
      }
    }
  }

  // 1.5 power
  const pPw = P(/1\.5\s*\|?\s*POWER SUPPLY CHECK/);
  out.power = null;
  if (pPw) {
    const l = lineAfter(pPw, /MAIN \(V\)/);
    const v = l.match(new RegExp(NUM, "g")) || [];
    const brk = pPw.text.match(/\(STAND-BY\)\s*\|\s*(PASS|FAIL|N\/A)\s+(PASS|FAIL|N\/A)/);
    out.power = { main: num(v[0]), standby: num(v[1]), raw: l, breakerMain: brk?.[1] || "", breakerStandby: brk?.[2] || "", page: pPw.no };
  }

  // 1.6 ground
  const pG = P(/1\.6\s*\|?\s*GROUND RESISTANCE TEST/);
  out.ground = null;
  if (pG) {
    const r = pG.text.match(/Rack to Buss bar cabin\s+([^|]+?)\s*\|/i);
    const s = pG.text.match(/Shelf to body Rack\s+([^|]+?)\s*\|/i);
    const val = (x) => (!x ? { raw: "", value: null } : /^-?\d/.test(x) ? { raw: x, value: num(x) } : { raw: x, value: null });
    out.ground = { rackToBusbar: val(r?.[1]?.trim()), shelfToRack: val(s?.[1]?.trim()), page: pG.no };
  }

  // 1.7 software + 1.8 visual
  const pSw = P(/SOFTWARE VERSION NUMBER/);
  out.software = pSw ? { release: grab(pSw, /SOFTWARE VERSION NUMBER\s*\|?\s*(REL\.[^|]+)/), page: pSw.no } : null;
  const pVis = P(/1\.8\s*\|?\s*VISUAL INSPECTION/);
  out.visual = [];
  if (pVis) {
    for (const l of pVis.lines) {
      const m = l.match(/^(Mounted Correctly|Undamaged|Grounded \(Earthed\)|Connected to DC Power \d|Connection for [A-Za-z\-\/ ()]+?)\s+(PASS|FAIL|N\/A)$/);
      if (m) out.visual.push({ item: m[1], result: m[2], page: pVis.no });
    }
  }

  // 1.9 NE setup
  const pNe = P(/1\.9\s*\|?\s*LOCAL NE SETUP/);
  out.neSetup = null;
  if (pNe) {
    const rel = grab(pNe, /SOFTWARE RELEASE\s*\|?\s*([^|]+)/);
    const mode = grab(pNe, /NE ADMIN MODE \(SONET\/SDH\)\s*\|?\s*([^|]+)/);
    const lb = pNe.text.match(/LOOPBACK IP\s*\|?\s*(\d+)\s*\|?\s*(\d+)\s*\|?\s*(\d+)\s*\|?\s*(\d+)/);
    out.neSetup = { release: rel, mode, loopback: lb ? lb.slice(1, 5).join(".") : "", page: pNe.no };
  }

  // 1.10 discovery
  const pDisc = P(/1\.10 VERIFICATION OF SHELF/);
  out.discovery = pDisc ? { result: grab(pDisc, /DISCOVERY\s*\(PASS\/FAIL\)\s*\|?\s*(PASS|FAIL|N\/A)/), page: pDisc.no } : null;

  // 1.11 span loss
  // หน้าผลลัพธ์ Span Loss: หัวตารางอาจแตกเป็น "Loss per | KM" หรือ "Loss | per KM"
  const pSpan = P(/Loss\s*\|?\s*per\s*\|?\s*KM/i);
  out.span = [];
  if (pSpan) {
    // ชื่อไซต์อาจมีช่องว่าง + ตัวเลขต่อท้าย (เช่น "SPTIK 1")
    const SITE = "([A-Z0-9][A-Z0-9-]*(?: \\d)?)";
    const re = new RegExp(`^(\\d+)\\s+(${NUM})\\s+${SITE}\\s+(TX|RX)\\s+(${NUM})\\s+${SITE}\\s+(TX|RX)\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})\\s*(\\S*)`);
    for (const l of pSpan.lines) {
      const m = l.match(re);
      if (m) out.span.push({ core: m[1], distance: num(m[2]), siteA: m[3].replace(" ", ""), dirA: m[4], valA: num(m[5]), siteB: m[6].replace(" ", ""), dirB: m[7], valB: num(m[8]), totalLoss: num(m[9]), lossPerKm: num(m[10]), module: m[11], raw: l, page: pSpan.no });
    }
  }

  // 1.12 TX / 1.13 RX
  const cardRows = (page) => {
    const rows = [];
    if (!page) return rows;
    const re = new RegExp(`^(SH\\d+/SL\\d+)\\s+(\\S+)\\s+(WDM|Client)\\s+(${NUM})\\s*~\\s*(${NUM})\\s+(${NUM})\\s*$`);
    for (const l of page.lines) {
      const m = l.match(re);
      if (m) rows.push({ slot: m[1], module: m[2], side: m[3], specLo: num(m[4]), specHi: num(m[5]), value: num(m[6]), page: page.no });
    }
    return rows;
  };
  out.tx = cardRows(P(/TX Power \(dBm\)\s*\|?\s*LCT\/MS/));
  out.rx = cardRows(P(/Rx Power \(dBm\)/));

  // 1.14 LCT
  const pLct = P(/1\.14 LOCAL CONTROLLER/);
  out.lct = [];
  if (pLct) for (const l of pLct.lines) {
    const m = l.match(/^(.+?)\s+(PASS|FAIL|N\/A|DONE BY NMS)$/);
    if (m && !/^\(?PASS/.test(m[1])) out.lct.push({ item: m[1], result: m[2], page: pLct.no });
  }

  // section 2 network tests — บันทึกว่าเป็น N/A หรือมีค่า
  const sec2 = {};
  for (const [key, re] of [["osnr", /2\.2\s*\|?\s*OSNR/], ["latency", /2\.3\s*\|?\s*LATENCY/], ["ber", /2\.4\s*\|?\s*LINK BER/], ["protection", /2\.5\s*\|?\s*PROTECTION/], ["otdr", /2\.1\s*\|?\s*OTDR TEST/]]) {
    const pg = P(re);
    if (!pg) { sec2[key] = null; continue; }
    const results = pg.text.split(/Results?/).slice(1).join(" ");
    const na = (results.match(/N\/A/g) || []).length;
    const nums = (results.match(/-?\d+\.\d+/g) || []).length;
    sec2[key] = { page: pg.no, na, values: nums, filled: nums > 0 };
  }
  out.network = sec2;

  // ลายเซ็น/วันที่ท้ายหน้า: token วันที่สุดท้ายของแต่ละหน้า
  out.pageDates = pages.map((p) => {
    const last = p.lines[p.lines.length - 1] || "";
    const d = last.match(/\d{1,2}\/\d{1,2}\/\d{4,5}|\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2} \w{3} \d{4}/);
    return { page: p.no, date: d ? d[0] : "" };
  });
  out.placeholders = pages.filter((p) => /Type text here/i.test(p.text)).map((p) => p.no);
  out.placeholderList = placeholderList(pages);
  out.blockDiagram = pages.slice(2).find((p) => /1\.1\s*\|?\s*BLOCK DIAGRAM/.test(p.text)) || null;
  return out;
}

// หัวข้อที่ช่อง 'Type text here' สังกัด = บรรทัดหัวข้อ (เช่น "1.4 INVENTORY LIST") ล่าสุดก่อนช่องนั้น (หัวข้อหนึ่งอาจยาวหลายหน้า จึงจำข้ามหน้า)
const ACRONYMS = /\b(ber|gmre|nms|lct|otdr|osc|dwdm|ila|roadm|pss|psi|fdf|odf|gnd|ip|ne|id|sw|ac|dc|vdc|hvdc|lan|wan|ems|rfc|bert|e2e)\b/gi;
function placeholderList(pages) {
  const out = [];
  let head = "";
  for (const p of pages) {
    for (const l of p.lines) {
      const h = l.match(/^(\d\.\d+)\s+([A-Z][A-Z0-9 &()\/\-]{3,})$/);
      if (h) head = h[1] + " " + h[2].trim().split(/\s+/).map((w) => (/\d/.test(w) ? w : w.toLowerCase().replace(/(^|[(\/])([a-z])/g, (m, sp, c) => sp + c.toUpperCase()))).join(" ").replace(ACRONYMS, (m) => m.toUpperCase());
      if (/Type text here/i.test(l) && !out.some((x) => x.page === p.no && x.section === head)) out.push({ page: p.no, section: head });
    }
  }
  return out;
}

export function parseAttachment(pages) {
  const out = { kind: "ATT", numPages: pages.length, header: parseHeader(pages[0]) };
  const toc = pages[1];
  out.toc = [];
  if (toc) for (const l of toc.lines) {
    const m = l.match(/^(\d+)\s+ITEM\s+(1\.\d+)\s+(.+?)\s*[√]?\s*$/);
    if (m) out.toc.push({ page: +m[1], item: m[2], title: m[3].trim(), page2: 2 });
  }
  // section ตามหัวข้อ
  const secStart = {};
  for (const p of pages.slice(2)) {
    const m = p.text.match(/ITEM (1\.\d+)\s+[A-Z ]+/);
    if (m && !secStart[m[1]]) secStart[m[1]] = p.no;
  }
  out.sections = secStart;
  out.captions = {};
  for (const p of pages) {
    for (const m of p.text.matchAll(/\(([a-g])\)\s*([A-Za-z][A-Za-z &\-\/]+?)(?:\s*\*|\s*\||$)/g)) {
      const k = m[1];
      (out.captions[k] ||= []).push({ label: m[2].trim(), page: p.no });
    }
  }
  out.shelfRemarks = [];
  out.fiberScope = [];
  for (const p of pages) {
    for (const m of p.text.matchAll(/SHELF\s?0?(\d)\s+(PSS-?8|PSI[_-]?8L|PSI[_-]?M)|(PSS-?8|PSI[_-]?8L)\s+SHELF\s?0?(\d)/g)) out.shelfRemarks.push({ shelf: m[1] || m[4], type: m[2] || m[3], page: p.no });
    for (const m of p.text.matchAll(/Name:\s*([^|]+)/g)) out.fiberScope.push({ name: m[1].trim(), page: p.no });
  }
  out.placeholders = pages.filter((p) => /Type text here/i.test(p.text)).map((p) => p.no);
  out.placeholderList = placeholderList(pages);
  return out;
}

export function parseDate(s) {
  const m = String(s || "").match(DATE_RE);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  if (y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? dt : null;
}
