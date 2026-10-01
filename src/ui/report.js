// สร้าง Excel รายงาน (SheetJS โหลดจาก CDN เป็น global XLSX)
import { L, msgOf, statusText, sectionText, whoText, sevText, levelText, reasonText } from "../i18n.js";
const LV = (l) => levelText(l);
const SEV = { get fail() { return sevText("fail"); }, get warn() { return sevText("warn"); }, get info() { return sevText("info"); } };

export function buildWorkbook(results, reviews, meta) {
  const wb = XLSX.utils.book_new();
  const sum = [[L("ไซต์", "Site"), L("โฟลเดอร์", "Folder"), "Project / Link", "DWDM Model", L("ชนิดโหนด", "Node type"), L("รหัส", "Code"), L("โปรไฟล์", "Profile"), L("ทิศ", "Degrees"), L("ระบบไฟ", "Power"), L("สถานะ", "Status"), L("ไม่ผ่าน", "Fail"), L("เตือน", "Warnings"), L("รูป Accept", "Photos Accept"), L("รูป Reject", "Photos Reject"), L("รูปยังไม่ตรวจ", "Photos pending"), L("ผู้ตรวจรูป", "Photo reviewer"), "SATP", "Attachment"]];
  for (const r of results) {
    const rv = reviewStats(reviews[r.site.key]);
    sum.push([r.facts.code, r.site.folder, r.site.satp?.header.project || "", r.site.satp?.header.model || "", r.facts.nodeKind || "", `${r.facts.nodeType || ""}_${r.facts.suffix || ""}`, r.facts.profile || L(`ไม่มี (ใกล้ ${r.facts.nearestProfile})`, `none (nearest ${r.facts.nearestProfile})`), r.facts.degrees, r.facts.power, statusText(r.summary.status), r.summary.fail, r.summary.warn, ...(r.facts.customerAccepted ? ["–", "–", "–", L("ลูกค้าตรวจรับแล้ว", "Customer accepted")] : [rv.accept, rv.reject, rv.pending, rv.reviewer]), r.site.satpFile, r.site.attFile]);
  }
  sum.push([], [L("ตรวจเมื่อ", "Checked at"), meta.when], [L("ผู้ตรวจ", "Reviewer"), meta.reviewer || ""], [L("เวอร์ชัน", "Version"), meta.version]);
  XLSX.utils.book_append_sheet(wb, aoa(sum, [10, 26, 12, 12, 18, 10, 22, 5, 8, 16, 7, 7, 9, 9, 11, 12, 40, 40]), L("สรุป", "Summary"));

  const iss = [[L("ไซต์", "Site"), L("ระดับ", "Level"), L("ผล", "Result"), L("ผลเดิม (ก่อน ROM ตัดสิน)", "Original (before ROM)"), L("กฎ", "Rule"), "Section", L("หน้า", "Page"), L("ประเด็น", "Issue"), L("ใครตรวจต่อ", "Next reviewer"), L("การตัดสินใจ ROM", "ROM decision"), L("ขอบเขต", "Scope"), L("เหตุผล", "Reason"), L("โดย", "By"), L("เมื่อ", "When")]];
  for (const r of results) for (const i of r.issues) {
    const d = i.learned;
    iss.push([r.facts.code, LV(i.level), SEV[i.severity], i.origSeverity ? SEV[i.origSeverity] : "", i.rule, sectionText(i.section), i.page ?? "", msgOf(i), whoText(i.who),
      d ? (d.decision === "accept" ? L("ยอมรับ", "Accepted") : L("ยืนยันปัญหา", "Confirmed issue")) : "", d ? (d.scope === "site" ? L("เฉพาะไซต์นี้", "This site only") : L("ทุกไซต์ (เรียนรู้)", "All sites (learned)")) : "", d?.reason || "", d?.by || "", d?.at || ""]);
  }
  XLSX.utils.book_append_sheet(wb, aoa(iss, [10, 14, 8, 12, 6, 20, 5, 90, 10, 14, 16, 30, 12, 18]), L("ประเด็น", "Issues"));

  const rv = [[L("ไซต์", "Site"), L("หัวข้อ", "Topic"), L("หน้า", "Page"), L("รูปที่", "Photo #"), L("ผล", "Verdict"), L("เหตุผล", "Reason"), L("ผู้ตรวจ", "Reviewer"), L("เวลา", "Time"), L("ระบบตรวจพบ", "System notes")]];
  for (const r of results) for (const it of reviews[r.site.key]?.items || []) rv.push([r.facts.code, it.label || it.section, it.page, it.idx + 1, it.verdict === "accept" ? (it.autoAccepted ? L("Accept (อัตโนมัติ)", "Accept (automatic)") : "Accept") : it.verdict === "reject" ? "Reject" : "", reasonText(it.reason || ""), it.by === "ระบบ" ? L("ระบบ", "System") : it.by || "", it.at || "", msgOf({ msg: it.auto || "", msg_en: it.auto_en || "" })]);
  XLSX.utils.book_append_sheet(wb, aoa(rv, [10, 30, 5, 6, 8, 30, 12, 18, 40]), L("ตรวจรูป", "Photos"));

  const facts = [[L("ไซต์", "Site"), "Station Name", "Model", "SW", "IP", L("ติดตั้ง", "Installed"), "Acceptance", "Power (V)", "Ground (Ω)", L("ทิศ", "Degrees"), L("โมดูล", "Modules"), "Shelf", L("โปรไฟล์", "Profile"), L("ไม่ตรงโปรไฟล์", "Profile mismatches")]];
  for (const r of results) {
    const S = r.site.satp; if (!S) continue;
    facts.push([r.facts.code, S.header.station, S.header.model, S.software?.release || "", S.header.ip, `${S.header.installStart} – ${S.header.installEnd}`, S.header.acceptanceDate, `${S.power?.main ?? ""} / ${S.power?.standby ?? ""}`, `${S.ground?.rackToBusbar.raw ?? ""} / ${S.ground?.shelfToRack.raw ?? ""}`, r.facts.degrees, [...(r.facts.modules || [])].join(", "), JSON.stringify(r.facts.shelves || {}), r.facts.profile || "", (r.facts.profileMismatches || []).join("; ")]);
  }
  XLSX.utils.book_append_sheet(wb, aoa(facts, [10, 32, 12, 20, 14, 24, 11, 14, 14, 5, 18, 16, 8, 40]), L("ข้อมูลไซต์", "Site data"));

  const inv = [[L("ไซต์", "Site"), "Shelf", "Slot", L("การ์ด", "Card"), "Software Load", "CLEI", "Part Number", "Serial Number", L("หน้า (Attachment)", "Page (Attachment)")]];
  for (const r of results) for (const x of r.inventory || []) inv.push([r.facts.code, x.shelf, x.slot, x.card, x.sw, x.clei, x.part, x.serial, x.page]);
  if (inv.length > 1) XLSX.utils.book_append_sheet(wb, aoa(inv, [10, 6, 6, 12, 22, 14, 18, 16, 10]), "Inventory");
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
