// ดึงข้อความและรูปจาก PDF ด้วย pdf.js — ทำงานทั้งในเบราว์เซอร์และ Node (ส่ง pdfjs lib เข้ามา)
// ผลลัพธ์ต่อหน้า: { lines: [...], text: "line | line | ...", imageCount, images: [{id, width, height}] }

const SKIP = /^(_+|Rev:0\s+Effective Date:.*|Page \d+ of \d+|Performed by:|NOKIA|Verified by:|TIME)$/;

export async function extractPdf(pdfjs, data, { wantImages = true } = {}) {
  // ส่งสำเนาให้ pdf.js เพราะ worker จะ transfer (detach) buffer ที่ได้รับ — ต้องเก็บ bytes เดิมไว้ใช้ตอนตรวจรูป
  const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const lines = await pageLines(page);
    const imgs = await pageImages(page, wantImages);
    // รูปถ่าย/screenshot = ไม่ใช่ object ใช้ร่วมทุกหน้า (โลโก้ g_*) และมีขนาดพอ
    const photos = imgs.filter((i) => !i.id.startsWith("g_") && i.width >= 150 && i.height >= 100);
    pages.push({
      no: p,
      lines,
      text: lines.filter((l) => l && !SKIP.test(l)).join(" | "),
      imageCount: imgs.length,
      photoCount: photos.length,
      images: imgs,
      photos,
    });
    page.cleanup();
  }
  const out = { numPages: doc.numPages, pages };
  await doc.destroy();
  return out;
}

// จัดกลุ่ม text item เป็นบรรทัดตามตำแหน่ง y (ใกล้เคียง PyMuPDF get_text)
async function pageLines(page) {
  const tc = await page.getTextContent();
  const items = tc.items.filter((it) => "str" in it);
  const lines = [];
  let cur = [];
  let curY = null;
  for (const it of items) {
    const y = it.transform[5];
    const x = it.transform[4];
    const fs = Math.hypot(it.transform[0], it.transform[1]) || 10;
    if (curY !== null && Math.abs(y - curY) > 2.5) {
      lines.push(joinLine(cur));
      cur = [];
    }
    if (it.str.length) cur.push({ x, end: x + (it.width || 0), fs, s: it.str });
    curY = y;
    if (it.hasEOL) {
      lines.push(joinLine(cur));
      cur = [];
      curY = null;
    }
  }
  if (cur.length) lines.push(joinLine(cur));
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function joinLine(parts) {
  parts.sort((a, b) => a.x - b.x);
  let s = "";
  let lastEnd = null;
  for (const p of parts) {
    if (s && lastEnd !== null) {
      const gap = p.x - lastEnd;
      // ช่องว่างจริง = ระยะห่าง ≥ ~25% ของขนาดตัวอักษร (คอลัมน์ตารางห่างกันมากกว่านี้อยู่แล้ว)
      if (gap > p.fs * 0.25 && !s.endsWith(" ") && !p.s.startsWith(" ")) s += gap > p.fs * 1.5 ? " | " : " ";
    }
    s += p.s;
    lastEnd = Math.max(lastEnd ?? -Infinity, p.end);
  }
  return s;
}

async function pageImages(page, want) {
  const ops = await page.getOperatorList();
  const OPS = page.objs ? page._pdfjsOPS || null : null;
  const list = [];
  // pdf.js OPS codes: paintImageXObject = 85, paintInlineImageXObject = 86, paintImageXObjectRepeat = 88
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === 85 || fn === 88) {
      const name = ops.argsArray[i][0];
      let meta = { id: name, width: 0, height: 0, data: null };
      try {
        const img = await getObj(page, name);
        if (img) {
          meta.width = img.width;
          meta.height = img.height;
          if (want) meta.data = img; // {width,height,data(Uint8ClampedArray), kind} หรือ bitmap
        }
      } catch {}
      list.push(meta);
    } else if (fn === 86) {
      list.push({ id: `inline_${i}`, width: 0, height: 0, data: null });
    }
  }
  return list;
}

function getObj(page, name) {
  return new Promise((resolve) => {
    try {
      const store = name.startsWith("g_") ? page.commonObjs : page.objs;
      if (store.has(name)) return resolve(store.get(name));
      store.get(name, (v) => resolve(v));
    } catch {
      resolve(null);
    }
  });
}
