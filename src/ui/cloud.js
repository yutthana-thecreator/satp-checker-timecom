// ฐานความรู้ร่วมของทีมบน Supabase — เปิดใช้เมื่อกรอก src/config.js
// ขึ้นคลาวด์เฉพาะสิ่งที่ระบบเรียนรู้: การตัดสินใจประเด็น, ผล Accept/Reject (hash), โปรไฟล์ที่เรียนรู้, รูปย่ออ้างอิง, สถิติจำนวนรูป — ไฟล์ PDF ไม่ออกจากเครื่อง
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

const SB_ESM = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const BUCKET = "ref-thumbs";
let sb = null, user = null;
const listeners = [];

export const cloud = {
  get enabled() { return !!(SUPABASE_URL && SUPABASE_ANON_KEY); },
  get user() { return user; },
  get ready() { return !!(sb && user); },
  onAuth(fn) { listeners.push(fn); },
};

export async function initCloud() {
  if (!cloud.enabled) return false;
  try {
    const { createClient } = await import(SB_ESM);
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await sb.auth.getSession();
    user = data.session?.user || null;
    sb.auth.onAuthStateChange((_ev, session) => {
      const u = session?.user || null;
      const changed = (u?.id || null) !== (user?.id || null);
      user = u;
      if (changed) for (const f of listeners) f(user);
    });
    return true;
  } catch (e) { console.warn("cloud init", e); sb = null; return false; }
}

export async function signIn(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function signOut() { if (sb) await sb.auth.signOut(); }

const stamp = () => ({ updated_by: user?.email || "", updated_at: new Date().toISOString() });
const check = ({ data, error }) => { if (error) throw error; return data; };
const warn = (where) => (e) => { console.warn("cloud " + where + ":", e?.message || e); return null; };

// ---------- แถวข้อมูล (ทุกตารางเก็บ key + data jsonb) ----------
export function pushRow(table, key, data) {
  if (!cloud.ready) return Promise.resolve(null);
  return sb.from(table).upsert({ key, data, ...stamp() }).then(check).catch(warn("upsert " + table));
}
export function deleteRow(table, key) {
  if (!cloud.ready) return Promise.resolve(null);
  return sb.from(table).delete().eq("key", key).then(check).catch(warn("delete " + table));
}
export async function pullAll() {
  if (!cloud.ready) return null;
  const tables = ["issue_decisions", "image_decisions", "learned_profiles", "ref_images", "section_stats"];
  const res = await Promise.all(tables.map((t) => sb.from(t).select("key,data").then(check)));
  return Object.fromEntries(tables.map((t, i) => [t, res[i].map((r) => ({ key: r.key, ...r.data }))]));
}

// ---------- รูปย่ออ้างอิง (Storage) ----------
function refPath(rec) { return `${rec.profile}/${rec.hash}.jpg`.replace(/[^A-Za-z0-9_./-]/g, "_"); }
export async function pushRefImage(rec) {
  if (!cloud.ready) return null;
  try {
    const path = refPath(rec);
    const blob = await (await fetch(rec.thumb)).blob();
    check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true }));
    const { thumb, ...meta } = rec;
    return await sb.from("ref_images").upsert({ key: rec.id, data: { ...meta, thumb_path: path }, ...stamp() }).then(check);
  } catch (e) { return warn("ref upload")(e); }
}
export async function deleteRefImage(rec) {
  if (!cloud.ready) return null;
  try {
    if (rec.thumb_path) await sb.storage.from(BUCKET).remove([rec.thumb_path]);
    return await sb.from("ref_images").delete().eq("key", rec.id).then(check);
  } catch (e) { return warn("ref delete")(e); }
}
export async function downloadThumb(path) {
  const blob = check(await sb.storage.from(BUCKET).download(path));
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
}
