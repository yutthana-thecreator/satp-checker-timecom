// ลายเซ็นภาพ (image embedding) ด้วย CLIP ViT-B/32 รันในเบราว์เซอร์ผ่าน transformers.js — โหลดโมเดลครั้งแรก ~90 MB แล้ว cache ในเบราว์เซอร์
// ใช้เทียบรูปใหม่กับรูปอ้างอิงของหัวข้อเดียวกันโดยไม่ต้องดาวน์โหลดรูปย่อ: เก็บเฉพาะเวกเตอร์ 512 ค่า (int8 + base64 ≈ 700 ตัวอักษร) ใน Supabase
const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/+esm";
const MODEL = "Xenova/clip-vit-base-patch32";
let T = null, pipe = null, loading = null;

export const embedder = { get ready() { return !!pipe; }, get loading() { return !!loading && !pipe; } };

export function loadEmbedder(onProgress = () => {}) {
  if (pipe) return Promise.resolve(pipe);
  if (loading) return loading;
  loading = (async () => {
    onProgress("กำลังโหลดไลบรารีเปรียบเทียบรูป…");
    T = await import(LIB);
    T.env.allowLocalModels = false;
    let last = "";
    pipe = await T.pipeline("image-feature-extraction", MODEL, { dtype: "q8", progress_callback: (p) => {
      const t = p.status === "progress" ? `กำลังโหลดโมเดลเปรียบเทียบรูป ${p.file || ""} ${(p.progress || 0).toFixed(0)}%` : p.status === "ready" ? "โมเดลเปรียบเทียบรูปพร้อม" : "กำลังเตรียมโมเดลเปรียบเทียบรูป…";
      if (t !== last) { last = t; onProgress(t); }
    } });
    return pipe;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

// canvas | dataURL → Float32Array(512) normalized
export async function embedImage(src) {
  if (!pipe) await loadEmbedder();
  const img = typeof src === "string" ? await T.RawImage.read(src) : await T.RawImage.fromBlob(await new Promise((res) => src.toBlob(res, "image/jpeg", 0.85)));
  const out = await pipe(img);
  const v = Float32Array.from(out.data);
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

// ---------- เข้ารหัส int8 + base64 (ขนาด ~700 ตัวอักษร) ----------
export function encodeEmb(v) {
  let m = 0; for (const x of v) m = Math.max(m, Math.abs(x));
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round((v[i] / (m || 1)) * 127);
  let s = ""; const u = new Uint8Array(q.buffer); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return `${m.toFixed(6)}:${btoa(s)}`;
}
export function decodeEmb(str) {
  if (!str) return null;
  const i = str.indexOf(":"); const m = parseFloat(str.slice(0, i)); const b = atob(str.slice(i + 1));
  const u = new Uint8Array(b.length); for (let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k);
  const q = new Int8Array(u.buffer); const v = new Float32Array(q.length);
  let n = 0; for (let k = 0; k < q.length; k++) { v[k] = (q[k] / 127) * m; n += v[k] * v[k]; }
  n = Math.sqrt(n) || 1; for (let k = 0; k < v.length; k++) v[k] /= n;
  return v;
}
export function cosine(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// เทียบเวกเตอร์กับชุดอ้างอิง → เรียงจากคล้ายมากไปน้อย [{ref, sim}]
export function rank(v, refs, k = 3) {
  const out = [];
  for (const r of refs) if (r.vec) out.push({ ref: r, sim: cosine(v, r.vec) });
  out.sort((a, b) => b.sim - a.sim);
  return out.slice(0, k);
}
