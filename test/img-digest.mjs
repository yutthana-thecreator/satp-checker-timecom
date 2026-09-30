// พิมพ์ md5 ของข้อมูลพิกเซลรูปในหน้า: node test/img-digest.mjs "<pdf>" <page> ["<pdf>" <page> ...]
import fs from "node:fs"; import crypto from "node:crypto";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i += 2) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(a[i])), verbosity: 0 }).promise;
  const page = await doc.getPage(+a[i + 1]);
  const ops = await page.getOperatorList(); const out = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    if (ops.fnArray[k] !== 85 && ops.fnArray[k] !== 88) continue;
    const name = ops.argsArray[k][0]; if (name.startsWith("g_")) continue;
    const img = await new Promise((res) => { try { page.objs.has(name) ? res(page.objs.get(name)) : page.objs.get(name, res); } catch { res(null); } });
    if (!img || !img.data || img.width < 150) continue;
    out.push(`${img.width}x${img.height}:${crypto.createHash("md5").update(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)).digest("hex").slice(0, 10)}`);
  }
  console.log(a[i].split(/[\/]/).slice(-2, -1)[0].padEnd(28), "p" + a[i + 1], out.join("  "));
  await doc.destroy();
}
