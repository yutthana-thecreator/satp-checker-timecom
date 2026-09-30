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

// ขยายรูปให้ตัวอักษรสูงพอ (Tesseract อ่านดีที่ ≥ ~20px ต่อบรรทัด) — screenshot จอเต็ม 1380 px ตัวอักษรในตารางสูง ~8 px ต้องขยาย 2 เท่า
// ทดสอบกับ Inventory ของ AHTMJ: ไม่ขยาย → conf 47 อ่าน OTDR/8EC2 ไม่ได้ · ขยาย 2 เท่า → conf 78 อ่านครบ (~5 วินาที/รูป)
function prep(canvas) {
  const scale = Math.min(3, Math.max(1, 2800 / canvas.width));
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

// ---------- OCR ป้ายในรูปถ่าย ----------
// ป้ายของโปรเจกต์เป็นเทปสีเหลืองตัวอักษรดำ (NIIMBOT/Brother) → หาบริเวณสีเหลืองในรูป ตัดออกมาขยายแล้ว OCR ทีละป้าย
// แม่นกว่า OCR ทั้งรูปมาก (ตัวอักษรบนป้ายเล็กและมีข้อความอื่นรบกวน) · ถ้าไม่พบบริเวณสีเหลืองจะ OCR ทั้งรูปแบบ sparse text
export function findYellowBoxes(canvas) {
  const W = 320, s = W / canvas.width, H = Math.max(1, Math.round(canvas.height * s));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d"); ctx.drawImage(canvas, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 140 && g > 120 && b < 120 && r - b > 70 && g - b > 50 && Math.abs(r - g) < 90) mask[p] = 1; }
  // flood fill หา component
  const seen = new Uint8Array(W * H); const boxes = [];
  const stack = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!mask[p0] || seen[p0]) continue;
    let minx = W, miny = H, maxx = 0, maxy = 0, n = 0; stack.push(p0); seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop(); const x = p % W, y = (p / W) | 0; n++;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= W * H) continue; if (Math.abs((q % W) - x) > 1) continue; if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (n >= 40 && bw >= 12 && bh >= 5 && n / (bw * bh) > 0.35) boxes.push({ x: minx / s, y: miny / s, w: bw / s, h: bh / s, n });
  }
  // รวมกล่องที่ซ้อน/ติดกัน
  boxes.sort((a, b) => b.n - a.n);
  const out = [];
  for (const b of boxes) {
    const hit = out.find((o) => !(b.x > o.x + o.w + 8 / s || b.x + b.w < o.x - 8 / s || b.y > o.y + o.h + 8 / s || b.y + b.h < o.y - 8 / s));
    if (hit) { const x0 = Math.min(hit.x, b.x), y0 = Math.min(hit.y, b.y); hit.w = Math.max(hit.x + hit.w, b.x + b.w) - x0; hit.h = Math.max(hit.y + hit.h, b.y + b.h) - y0; hit.x = x0; hit.y = y0; }
    else out.push({ ...b });
  }
  return out.slice(0, 8);
}

function cropScale(canvas, box, pad = 0.15) {
  const px = box.w * pad, py = box.h * pad;
  const x = Math.max(0, box.x - px), y = Math.max(0, box.y - py);
  const w = Math.min(canvas.width - x, box.w + 2 * px), h = Math.min(canvas.height - y, box.h + 2 * py);
  const scale = Math.min(4, Math.max(1, 900 / w));
  const c = document.createElement("canvas"); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext("2d"); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  // เพิ่ม contrast: เทา + ยืดช่วง
  const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
  let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0; d[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const rng = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / rng)); d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(id, 0, 0);
  return c;
}

export async function ocrLabels(canvas, onStatus) {
  const w = await getWorker(onStatus);
  const boxes = findYellowBoxes(canvas);
  const texts = []; let confSum = 0, confN = 0;
  if (boxes.length) {
    await w.setParameters({ tessedit_pageseg_mode: "6" });
    for (const b of boxes) {
      const { data } = await w.recognize(cropScale(canvas, b));
      const t = (data.text || "").trim();
      if (t) { texts.push(t); confSum += data.confidence || 0; confN++; }
    }
  }
  if (!texts.length) {
    await w.setParameters({ tessedit_pageseg_mode: "11" });
    const { data } = await w.recognize(prep(canvas));
    texts.push((data.text || "").trim()); confSum += data.confidence || 0; confN++;
  }
  await w.setParameters({ tessedit_pageseg_mode: "3" });
  return { text: texts.join("\n"), confidence: confN ? confSum / confN : 0, boxes: boxes.length };
}
