// งานรูปในเบราว์เซอร์ (กล่อง 10): render หน้า Attachment เป็นรูปย่อ, hash หารูปซ้ำ, วัดความเบลอ
// ไม่ส่งข้อมูลออกไปไหน — ใช้ canvas ในเครื่องเท่านั้น

export async function renderPage(pdfjs, doc, pageNo, scale = 0.9) {
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  // intent print = ไม่ใช้ requestAnimationFrame → render ได้แม้แท็บถูกซ่อน
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, intent: "print" }).promise;
  page.cleanup();
  return canvas;
}

// average hash 16×16 (256 bit) จาก canvas — ใช้หารูปที่คัดลอกมาใช้ซ้ำ (ต้องขนาดเท่ากันด้วย)
export function aHash(canvas) {
  const N = 16;
  const c = document.createElement("canvas");
  c.width = N; c.height = N;
  const ctx = c.getContext("2d");
  ctx.drawImage(canvas, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const g = [];
  for (let i = 0; i < N * N; i++) g.push((d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000);
  const avg = g.reduce((a, b) => a + b, 0) / (N * N);
  return g.map((v) => (v > avg ? "1" : "0")).join("");
}

export function hamming(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

// ความคมชัด: variance ของ Laplacian บนภาพย่อ 128px — ค่าต่ำ = เบลอ
export function blurScore(canvas) {
  const w = 128, h = Math.max(8, Math.round((canvas.height / canvas.width) * 128));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const v = -4 * g[i] + g[i - 1] + g[i + 1] + g[i - w] + g[i + w];
    sum += v; sum2 += v * v; n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

// ดึงรูปแต่ละรูปในหน้า (จาก image objects ของ pdf.js) เป็น canvas
export async function pageImageCanvases(page) {
  const ops = await page.getOperatorList();
  const out = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn !== 85 && fn !== 88) continue;
    const name = ops.argsArray[i][0];
    if (name.startsWith("g_")) continue; // โลโก้ที่ใช้ร่วมทุกหน้า
    const img = await new Promise((res) => { try { page.objs.has(name) ? res(page.objs.get(name)) : page.objs.get(name, res); } catch { res(null); } });
    if (!img || img.width < 150 || img.height < 100) continue;
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
    else if (img.data) {
      const id = ctx.createImageData(img.width, img.height);
      const src = img.data, dst = id.data;
      if (img.kind === 1) { // grayscale 1 byte
        for (let p = 0, q = 0; p < src.length; p++, q += 4) { dst[q] = dst[q + 1] = dst[q + 2] = src[p]; dst[q + 3] = 255; }
      } else if (src.length === img.width * img.height * 3) {
        for (let p = 0, q = 0; p < src.length; p += 3, q += 4) { dst[q] = src[p]; dst[q + 1] = src[p + 1]; dst[q + 2] = src[p + 2]; dst[q + 3] = 255; }
      } else dst.set(src.subarray(0, dst.length));
      ctx.putImageData(id, 0, 0);
    } else continue;
    out.push({ id: name, canvas: c, width: img.width, height: img.height });
  }
  return out;
}

// ลายนิ้วมือพิกเซลทั้งรูป (FNV-1a 32 บิต 2 ชุด) — รูปที่ copy มาใช้ซ้ำจะตรงกันทุกไบต์ ต่างจาก aHash ที่ screenshot ต่างค่าแต่ template เดียวกันจะเหมือนกัน
export function pixelDigest(canvas) {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < d.length; i += 4) { h1 = Math.imul(h1 ^ d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16), 16777619) >>> 0; h2 = Math.imul(h2 ^ d[i + 2] ^ (d[i] << 8) ^ (d[i + 1] << 16), 2246822519) >>> 0; }
  return `${canvas.width}x${canvas.height}:${h1.toString(16)}${h2.toString(16)}`;
}

export function thumb(canvas, maxW = 520) {
  const s = Math.min(1, maxW / canvas.width);
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
