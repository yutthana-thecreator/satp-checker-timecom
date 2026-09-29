// สร้าง Excel รายงาน (SheetJS โหลดจาก CDN เป็น global XLSX)
const LV = { 0: "-", 1: "1 ครบถ้วน", 2: "2 สอดคล้อง", 3: "3 ค่าทางเทคนิค" };
const SEV = { fail: "ไม่ผ่าน", warn: "เตือน", info: "ข้อมูล" };

export function buildWorkbook(results, reviews, meta) {
  const wb = XLSX.utils.book_new();
  const sum = [["ไซต์", "โฟลเดอร์", "ชนิดโหนด", "รหัส", "โปรไฟล์", "ทิศ", "ระบบไฟ", "สถานะ", "ไม่ผ่าน", "เตือน", "รูป Accept", "รูป Reject", "รูปยังไม่ตรวจ", "ผู้ตรวจรูป", "SATP", "Attachment"]];
  for (const r of results) {
    const rv = reviewStats(reviews[r.site.key]);
    sum.push([r.facts.code, r.site.folder, r.facts.nodeKind || "", `${r.facts.nodeType || ""}_${r.facts.suffix || ""}`, r.facts.profile || `ไม่มี (ใกล้ ${r.facts.nearestProfile})`, r.facts.degrees, r.facts.power, r.summary.status, r.summary.fail, r.summary.warn, rv.accept, rv.reject, rv.pending, rv.reviewer, r.site.satpFile, r.site.attFile]);
  }
  sum.push([], ["ตรวจเมื่อ", meta.when], ["ผู้ตรวจ", meta.reviewer || ""], ["เวอร์ชัน", meta.version]);
  XLSX.utils.book_append_sheet(wb, aoa(sum, [10, 26, 18, 10, 22, 5, 8, 16, 7, 7, 9, 9, 11, 12, 40, 40]), "สรุป");

  const iss = [["ไซต์", "ระดับ", "ผล", "กฎ", "Section", "หน้า", "ประเด็น", "ใครตรวจต่อ"]];
  for (const r of results) for (const i of r.issues) iss.push([r.facts.code, LV[i.level] || "-", SEV[i.severity], i.rule, i.section, i.page ?? "", i.msg, i.who]);
  XLSX.utils.book_append_sheet(wb, aoa(iss, [10, 14, 8, 6, 20, 5, 90, 10]), "ประเด็น");

  const rv = [["ไซต์", "หัวข้อ", "หน้า", "รูปที่", "ผล", "เหตุผล", "ผู้ตรวจ", "เวลา", "ระบบตรวจพบ"]];
  for (const r of results) for (const it of reviews[r.site.key]?.items || []) rv.push([r.facts.code, it.section, it.page, it.idx + 1, it.verdict === "accept" ? "Accept" : it.verdict === "reject" ? "Reject" : "", it.reason || "", it.by || "", it.at || "", it.auto || ""]);
  XLSX.utils.book_append_sheet(wb, aoa(rv, [10, 30, 5, 6, 8, 30, 12, 18, 40]), "ตรวจรูป");

  const facts = [["ไซต์", "Station Name", "Model", "SW", "IP", "ติดตั้ง", "Acceptance", "Power (V)", "Ground (Ω)", "ทิศ", "โมดูล", "Shelf", "โปรไฟล์", "ไม่ตรงโปรไฟล์"]];
  for (const r of results) {
    const S = r.site.satp; if (!S) continue;
    facts.push([r.facts.code, S.header.station, S.header.model, S.software?.release || "", S.header.ip, `${S.header.installStart} – ${S.header.installEnd}`, S.header.acceptanceDate, `${S.power?.main ?? ""} / ${S.power?.standby ?? ""}`, `${S.ground?.rackToBusbar.raw ?? ""} / ${S.ground?.shelfToRack.raw ?? ""}`, r.facts.degrees, [...(r.facts.modules || [])].join(", "), JSON.stringify(r.facts.shelves || {}), r.facts.profile || "", (r.facts.profileMismatches || []).join("; ")]);
  }
  XLSX.utils.book_append_sheet(wb, aoa(facts, [10, 32, 12, 20, 14, 24, 11, 14, 14, 5, 18, 16, 8, 40]), "ข้อมูลไซต์");
  return wb;
}

function aoa(rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  return ws;
}

export function reviewStats(rv) {
  const s = { accept: 0, reject: 0, pending: 0, reviewer: "" };
  for (const it of rv?.items || []) { if (it.verdict === "accept") s.accept++; else if (it.verdict === "reject") s.reject++; else s.pending++; if (it.by) s.reviewer = it.by; }
  return s;
}
