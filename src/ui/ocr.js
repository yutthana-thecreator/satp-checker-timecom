// OCR ในเบราว์เซอร์ด้วย Tesseract.js (โหลดโค้ด+ภาษาจาก CDN ครั้งแรก แล้ว cache) — รูปไม่ออกจากเครื่อง
import { pageImageCanvases } from "./images.js";

const TESS_URL = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";
let workerPromise = null;

async function getWorker(onStatus) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    if (!window.Tesseract) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = TESS_URL; s.onload = res; s.onerror = rej; document.head.append(s); });
    onStatus?.("กำลังโหลดโมเดล OCR (ครั้งแรกเท่านั้น)…");
    const w = await window.Tesseract.createWorker("eng", 1, { logger: () => {} });
    await w.setParameters({ preserve_interword_spaces: "1" });
    return w;
  })();
  return workerPromise;
}

// ขยายรูปเล็กให้ตัวอักษรสูงพอ (Tesseract อ่านดีที่ ≥ ~20px ต่อบรรทัด)
function prep(canvas) {
  const scale = canvas.width < 1400 ? Math.min(3, 1400 / canvas.width) : 1;
  if (scale === 1) return canvas;
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * scale); c.height = Math.round(canvas.height * scale);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

export async function ocrCanvas(canvas, onStatus) {
  const w = await getWorker(onStatus);
  const { data } = await w.recognize(prep(canvas));
  return { text: data.text || "", confidence: data.confidence ?? 0 };
}

// รวบรวมข้อความ OCR ตาม section ของไซต์ → โครงสร้างที่ ocrChecks ต้องการ
export async function ocrSite(pdfjs, r, attBytes, satpBytes, onStatus) {
  const A = r.site.att;
  const out = { inventory: [], power: [], neSetup: [], neLabel: [], fiberScope: [], blockDiagram: [], raw: [] };
  const secs = Object.entries(A?.sections || {}).sort((a, b) => a[1] - b[1]);
  const rangeOf = (sec, numPages) => { const i = secs.findIndex((s) => s[0] === sec); if (i < 0) return null; return [secs[i][1], i + 1 < secs.length ? secs[i + 1][1] - 1 : numPages]; };
  let done = 0;
  const jobs = [];
  if (A && attBytes) {
    const doc = await pdfjs.getDocument({ data: attBytes.slice(), verbosity: 0 }).promise;
    const plan = [["1.4", "inventory"], ["1.5", "power"], ["1.9", "neSetup"], ["1.15", "fiberScope"]];
    for (const [sec, bucket] of plan) {
      const rg = rangeOf(sec, doc.numPages);
      if (!rg) continue;
      for (let p = rg[0]; p <= rg[1]; p++) jobs.push({ doc, page: p, bucket });
    }
    // ป้าย NE ID = หน้าที่มี caption (b)
    const labelPage = (A.captions?.b || [])[0]?.page;
    if (labelPage) jobs.push({ doc, page: labelPage, bucket: "neLabel", onlyFirst: false });
    for (const j of jobs) {
      onStatus?.(`OCR ${++done}/${jobs.length + 1}: Attachment หน้า ${j.page}`);
      const page = await j.doc.getPage(j.page);
      const imgs = await pageImageCanvases(page);
      for (const im of imgs) {
        const res = await ocrCanvas(im.canvas, onStatus);
        out[j.bucket].push({ page: j.page, idx: imgs.indexOf(im), text: res.text, confidence: res.confidence });
        out.raw.push({ doc: "ATT", section: j.bucket, page: j.page, text: res.text.trim().slice(0, 400), confidence: res.confidence });
      }
      page.cleanup();
    }
    await doc.destroy();
  }
  if (satpBytes && r.site.satp?.blockDiagram) {
    onStatus?.(`OCR: SATP Block Diagram`);
    const doc = await pdfjs.getDocument({ data: satpBytes.slice(), verbosity: 0 }).promise;
    const pno = r.site.satp.blockDiagram.no;
    const page = await doc.getPage(pno);
    // หากรอบของรูปที่ฝังในหน้า (จาก CTM ของ operator list) แล้ว render เฉพาะบริเวณนั้นที่ scale 4 ให้ตัวอักษรเล็กอ่านออก
    const bbox = await imageBBox(page);
    const vp1 = page.getViewport({ scale: 1 });
    let c;
    if (bbox) {
      const S = 2.5, pad = 6;
      const x0 = Math.max(0, bbox.x0 - pad), y0 = Math.max(0, vp1.height - bbox.y1 - pad), w = Math.min(vp1.width, bbox.x1 + pad) - x0, h = Math.min(vp1.height, vp1.height - bbox.y0 + pad) - y0;
      c = document.createElement("canvas"); c.width = Math.ceil(w * S); c.height = Math.ceil(h * S);
      const vp = page.getViewport({ scale: S, offsetX: -x0 * S, offsetY: -y0 * S });
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp, intent: "print" }).promise;
    } else {
      const vp = page.getViewport({ scale: 1.5 });
      c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp, intent: "print" }).promise;
    }
    const res = await ocrCanvas(c, onStatus);
    out.blockDiagram.push({ page: pno, idx: 0, text: res.text, confidence: res.confidence });
    out.raw.push({ doc: "SATP", section: "blockDiagram", page: pno, text: res.text.trim().slice(0, 400), confidence: res.confidence });
    page.cleanup();
    await doc.destroy();
  }
  return out;
}

// กรอบ (หน่วย PDF point, origin ล่างซ้าย) ของรูปที่ใหญ่ที่สุดในหน้า โดยไล่ CTM จาก operator list
export async function imageBBox(page) {
  const ops = await page.getOperatorList();
  const OPS = window.pdfjsLib?.OPS || (await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs")).OPS;
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = []; let best = null;
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      if (String(a[0]).startsWith("g_")) continue;
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const box = { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
      const area = (box.x1 - box.x0) * (box.y1 - box.y0);
      if (area > 10000 && (!best || area > best.area)) best = { ...box, area };
    }
  }
  return best;
}
