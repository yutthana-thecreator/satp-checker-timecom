# SATP Checker — ผังระบบและการทำงานโดยละเอียด

เวอร์ชัน ณ 1 ตุลาคม 2026 (commit ล่าสุดดูใน git) · เว็บ https://satp-checker-timecom.vercel.app · repo `yutthana-thecreator/satp-checker-timecom`

## 1. ภาพรวม

SATP Checker ตรวจเอกสาร acceptance ของโปรเจกต์ TIME.com (AGRID 2.0 / DC2DC) ที่ subcon ส่งมาก่อน Nokia submit ให้ลูกค้า ต่อไซต์ใช้ไฟล์ 2 ไฟล์: **SATP** (ตารางค่าที่วัดและผลทดสอบ) และ **Attachment Report** (screenshot และรูปถ่ายหน้างาน)

หลักการออกแบบ
- ทุกอย่างทำในเบราว์เซอร์ (static site บน Vercel ไม่มี backend) ไฟล์ PDF ไม่ออกจากเครื่องผู้ใช้
- ตรวจ 3 ส่วนอัตโนมัติหลังกดปุ่มเดียว: ข้อความ → OCR screenshot → รูปถ่าย
- ระบบตัดสินเองเฉพาะสิ่งที่ยืนยันได้ สิ่งที่ไม่มั่นใจส่งให้ ROM พร้อมหลักฐาน และจำคำตัดสินไว้ใช้ครั้งต่อไป
- ฐานความรู้ (การตัดสินใจ รูปอ้างอิง ลายเซ็นภาพ inventory) อยู่บน Supabase ให้ทั้งทีมใช้ชุดเดียวกัน โดยไม่ต้อง login (ตัดสินใจโดยผู้ใช้)

## 2. ผังระบบ

```mermaid
flowchart TB
  subgraph IN["1. โหลดไฟล์ (เบราว์เซอร์)"]
    F[PDF / zip / โฟลเดอร์] --> X[extract.js<br/>pdf.js ดึงข้อความ+จำนวนรูปต่อหน้า]
    X --> P[parse.js<br/>แยก SATP / Attachment เป็นโครงสร้าง<br/>header, ตาราง 1.3–1.15, sections, captions]
  end
  subgraph T["2. ตรวจข้อความ (ทันที)"]
    P --> R[rules.js R01–R26<br/>ระดับ 1 ครบถ้วน / 2 สอดคล้อง / 3 ค่าเทคนิค]
    PR[profiles.js P1–P5 + เกณฑ์] --> R
    SITES[data/sites.js 56 ไซต์] --> R
    LP[โปรไฟล์ที่ ROM สอน L1..] --> R
    R --> X17[R17 ตรวจข้ามไซต์ในชุดเดียวกัน]
  end
  subgraph O["3. OCR screenshot (พื้นหลัง ~2 นาที/ไซต์)"]
    P --> OC[ocr.js Tesseract<br/>ขยาย 2,800 px]
    OC --> OR[ocrRules.js O01–O10<br/>inventory / power / NE setup / fiber scope / block diagram]
    OR --> INV[parseInventory<br/>shelf·slot·การ์ด·SW·serial]
  end
  subgraph PH["4. รูปถ่าย (พื้นหลัง ~1 นาที/ไซต์)"]
    P --> CI[collectSiteImages<br/>รูปทุก section + หัวข้อ a–g]
    CI --> DG[pixelDigest + aHash + blur]
    CI --> EM[embed.js CLIP ViT-B/32<br/>เวกเตอร์ 512 ค่า]
    CI --> LB[ocrLabels + labels.js<br/>ป้ายสีเหลือง: รหัสไซต์ IP ปลายทาง]
    EM --> DEC[decideSiteImages<br/>เกณฑ์ต่อหัวข้อ p10 · section อื่น · ธง]
    DG --> DEC
    LB --> DEC
  end
  subgraph KB["ฐานความรู้ทีม (learn.js ⇄ cloud.js ⇄ Supabase)"]
    D1[(issue_decisions)]
    D2[(image_decisions)]
    D3[(learned_profiles)]
    D4[(ref_images + bucket ref-thumbs<br/>1,829 รูป + emb + digest)]
    D5[(section_stats<br/>จำนวนรูป/หัวข้อ · INV|ไซต์)]
  end
  DEC <--> D4
  DEC <--> D2
  R <--> D1
  LP <--> D3
  INV <--> D5
  subgraph OUT["ผลลัพธ์"]
    R --> ST[สถานะรวม<br/>ข้อความ + OCR + รูป]
    OR --> ST
    DEC --> ST
    ST --> UI[ตารางสรุป · แท็บ ประเด็น/ตรวจรูป/OCR<br/>หน้าเอกสาร+ไฮไลต์ · ประวัติ]
    ST --> XL[Excel: สรุป ประเด็น ตรวจรูป ข้อมูลไซต์ Inventory]
  end
  ROM((ROM)) -- ยอมรับ/ยืนยันปัญหา · Accept/Reject · ใช้ชุดนี้เป็นตัวอย่าง --> KB
```

## 3. ลำดับการทำงานเมื่อกด "ตรวจเอกสาร"

| ขั้น | ทำอะไร | ใช้เวลา | แสดงผล |
|---|---|---|---|
| 0 | เปิดหน้าเว็บ: ซิงก์ฐานความรู้จาก Supabase (ข้อมูลย่อเท่านั้น ~1–2 MB) | < 10 วินาที | แถบ ☁ "ซิงก์แล้ว" |
| 1 | อ่าน PDF ทุกไฟล์ จับคู่ SATP+Attachment ต่อไซต์จากชื่อไฟล์/โฟลเดอร์ | ~2 วินาที/ไฟล์ | "กำลังอ่าน n/N" |
| 2 | ตรวจข้อความ R01–R26 + จับคู่โปรไฟล์ + ตรวจข้ามไซต์ + ใส่คำตัดสินเดิมของ ROM | ทันที | ตารางสรุป สถานะ "ผ่าน (ยังไม่ตรวจ OCR/รูป)" |
| 3 | ไซต์ที่ลูกค้าเซ็นแล้ว → เก็บรูปทุกหัวข้อเป็นรูปอ้างอิงอัตโนมัติ | ~30 วินาที/ไซต์ | "เก็บรูปอ้างอิงจากไซต์ที่ลูกค้าเซ็นแล้ว" |
| 4 | ต่อไซต์ (พื้นหลัง): OCR screenshot → O01–O10 → รวมเข้าประเด็น | ~2 นาที | สถานะ "(ยังไม่ตรวจรูป)" แท็บ OCR มีตัวเลข |
| 5 | ต่อไซต์ (พื้นหลัง): ตัดสินรูปถ่ายทุกรูป | ~1 นาที | สถานะ "รอ ROM ตรวจรูป N" / "ผ่าน" คอลัมน์รูป a/r/p |
| 6 | ROM กดตัดสินส่วนที่เหลือ → สถานะคำนวณใหม่ทันที → ดาวน์โหลด Excel | | |

สถานะรวม (`combineStatus`): ไม่ผ่าน (ข้อความ) → ไม่ผ่าน (รูป Reject N) → รอ ROM ตรวจรูป N → ผ่านมีข้อสังเกต → ผ่าน · ไฟล์ที่ลูกค้าเซ็นแล้ว (Acceptance Date หรือ `_Signed`) = ผ่านทั้งหมด ไม่ตรวจรูป

## 4. ส่วนที่ 1 ตรวจข้อความ (engine)

**extract.js** ใช้ pdf.js อ่านข้อความทีละหน้า (จัดกลุ่มเป็นบรรทัดด้วยพิกัด y) และนับรูปต่อหน้าจาก operator list (ข้ามโลโก้ที่ซ้ำทุกหน้า)

**parse.js** แยกเอกสารตามชื่อไฟล์ (`parseFileName`: รหัสไซต์, ชนิด ILA/RDM/EILA, เลข 501/601, โปรเจกต์) และหัวข้อในเนื้อหา
- SATP: header หน้า 1 (Station, NE code, IP, model, วันติดตั้ง, Acceptance Date), 1.2 checklist, 1.3 test equipment (calibration), 1.5 power, 1.6 ground, 1.8 visual, 1.9 NE setup, 1.10 discovery, 1.11 span loss (core, ระยะ, TX/RX, loss, loss/km), 1.12 TX, 1.13 RX, 1.14 LCT, Section 2 network test, วันที่ท้ายหน้า
- Attachment: header, ตำแหน่งหน้าแต่ละ section, caption (a)–(g) ของ 1.8, ข้อความ template ค้าง

**profiles.js** โปรไฟล์ P1–P5 สร้างจาก 46 ไซต์ตัวอย่าง (ชนิดโหนด, จำนวน shelf, การ์ด, จำนวนทิศ, ระบบไฟ, ช่วงค่าที่พบ) + `DEFAULT_CRITERIA` (แรงดัน, กราวด์, loss/km, total loss, imageSim) แก้ได้ที่ปุ่ม "เกณฑ์ตรวจ" ไซต์ที่ไม่ตรงโปรไฟล์ใด → ป้าย "ROM ตรวจเอง" + ปุ่มบันทึกเป็นโปรไฟล์ L1, L2…

**rules.js** `checkSite(site, criteria)` → `facts` (รหัส, ชนิด, โปรไฟล์, ทิศ, ไฟ, customerAccepted) + `issues` 26 กฎ 3 ระดับ:
- ระดับ 1 ครบถ้วน: มี 2 ไฟล์, ช่องว่าง, template ค้าง, รูป/remark ครบ, calibration, checklist
- ระดับ 2 สอดคล้อง: ชื่อไฟล์/โฟลเดอร์/Station Name/รายชื่อไซต์, SATP vs Attachment (model, IP), slot ซ้ำ, แถว TX/RX เท่าจำนวนทิศ, ค่า TX/RX ปรากฏในตาราง span, ระยะ core1/core2, R17 ค่า span ตรงกับเอกสารไซต์ปลายทางในชุดเดียวกัน
- ระดับ 3 ค่าเทคนิค: แรงดัน -48/HVDC, กราวด์ < 1 Ω, loss/km และ total loss เทียบเกณฑ์, loss = TX−RX
- `summarize(issues)` → fail/warn/status · `applyDecisions` ใส่คำตัดสินของ ROM (ดูข้อ 8)

## 5. ส่วนที่ 2 OCR screenshot

**ocr.js** โหลด Tesseract.js จาก CDN ครั้งแรก (~10 MB) `ocrSite` อ่านรูปในหน้า 1.4 Inventory, 1.5 Power, 1.9 NE Setup, 1.15 Fiber Scope, ป้าย NE ID (b) และ Block Diagram ใน SATP (crop ตามกรอบรูปแล้วขยาย 2.5 เท่า) ทุกรูปถูกขยายให้กว้าง ~2,800 px ก่อนอ่าน (ตัวอักษรในตาราง ~8 px ต้องขยาย 2 เท่า จากทดสอบ Inventory ของ AHTMJ: ไม่ขยาย conf 47 อ่าน OTDR/8EC2 ไม่ได้ · ขยาย conf 78 อ่านครบ)

**ocrRules.js** `ocrChecks(ocr, site, facts, ctx)` ผลทุกข้อเป็นเตือน/ข้อมูลให้คนยืนยัน
- O01 การ์ดในตาราง Inventory ตรงโปรไฟล์ (need/forbid) + จำนวน shelf
- O02 ค่าแรงดันในรูป vs ตาราง 1.5 (ข้อมูล: อ่านตัวเลขบนมิเตอร์ได้จำกัด)
- O03 IP/ชื่อ NE ใน NE Setup ตรงหน้า 1
- O04 ป้าย NE ID มีรหัสไซต์
- O05 Fiber scope PASS/FAIL และชื่อรายงานครอบคลุม LINE IN/OUT ทุกไซต์ปลายทาง
- O06 Block Diagram มีชื่อ NE และไซต์ปลายทางตาม Span Loss
- O07 วันที่-เวลาบน screenshot (template กำหนด)
- O08 Software Load ในตาราง Inventory vs SW REL หน้า 1 (เทียบตัวเลข)
- O09 ผังการ์ดต่อ shelf/slot vs ไซต์ตัวอย่างโปรไฟล์เดียวกัน (`buildLayouts` จาก inventory ทุกไซต์ในฐานความรู้ ใช้เมื่อ ≥ 3 ไซต์; ไม่นับการ์ดพื้นฐาน PF/FAN/SHFPNL ว่า "ขาด"; ถ้า OCR อ่านได้น้อยกว่าค่ากลาง 80% ลดเป็นข้อมูล)
- O10 Serial number ซ้ำกับไซต์อื่น (screenshot ใช้ซ้ำ / การ์ดย้าย)

`parseInventory` แยกแถว "Shelf Slot Present/Provisioned SoftwareLoad Mnemonic CLEI Part Serial" ยอมให้ OCR ผิด 1 ตัวอักษรในชื่อการ์ด (BEC2→8EC2, PE→PF) และแก้ O/I/S/B ในเลข serial แถวลง Excel ชีท Inventory และเก็บต่อไซต์ในฐานความรู้ (section_stats key `INV|<ไซต์>`) ชุดตัวอย่างเก็บแล้ว 44 ไซต์ 547 การ์ด 495 serial

## 6. ส่วนที่ 3 รูปถ่าย

**collectSiteImages** ดึงรูปทุก section ที่ต้องตรวจ (1.8, 1.4, 1.5, 1.6, 1.9, 1.15) พร้อมหัวข้อย่อยจาก caption เช่น "(a) Rack Installation" ทุกรูปคำนวณ
- `pixelDigest` ลายนิ้วมือพิกเซลทั้งรูป → รูปซ้ำ = ไฟล์เดียวกันจริง (aHash หยาบใช้ไม่ได้กับ screenshot template เดียวกัน พบ false positive 165 รูป)
- `aHash` 256 บิต (ใช้เสริมเฉพาะรูปถ่าย ต่าง ≤ 2 บิต = น่าจะรูปเดียวกันบันทึกใหม่) · `blurScore` ความคมชัด
- `embedImage` (embed.js) CLIP ViT-B/32 ผ่าน transformers.js (โมเดล q8 ~90 MB โหลดครั้งแรกแล้ว cache, ~0.25 วินาที/รูป) → เวกเตอร์ 512 ค่า เข้ารหัส int8+base64 (~700 ตัวอักษร)

**รูปอ้างอิง** ต่อ (โปรไฟล์ × หัวข้อ) 3 แหล่ง: `signed` ลูกค้าเซ็นแล้ว (อัตโนมัติ), `sample` ROM กดใช้ชุดนี้เป็นตัวอย่าง (ชุดเริ่มต้น 46 ไซต์ = 1,829 รูป), `rom` Accept (เก็บ 3 รูปล่าสุด/หัวข้อ) ทุกรูปมี emb + digest บนคลาวด์ รูปย่อดาวน์โหลดเฉพาะเมื่อต้องแสดง

**decideSiteImages** ต่อรูป
1. ธง: รูปเดียวกับรูปอื่นในชุด/ไซต์ตัวอย่าง (digest), เบลอ, เคยถูก Reject (hash) หรือคล้ายรูปที่เคย Reject ≥ 0.95
2. ป้าย (labels.js): หัวข้อ 1.8 a–g และ 1.6 → `ocrLabels` หาบริเวณเทปสีเหลือง (ป้าย NIIMBOT/Brother ตามเอกสาร LABELLING FORMAT Rev 0) ตัดขยาย 4 เท่าเพิ่ม contrast แล้ว OCR ทีละป้าย (ไม่พบสีเหลือง → OCR ทั้งรูป sparse) ตัด "TIME:<ไซต์>" ของแอปกล้องออก เทียบรหัสไซต์ (ยอมผิด 1 ตัว), ชื่อ NE, IP vs หน้า 1, รหัสไซต์ปลายทางจาก Span Loss, โปรเจกต์ → ธงเมื่อป้ายระบุไซต์อื่น / IP ไม่ตรง / (b) NE ID ไม่มีรหัส; หัวข้ออื่นเป็นหมายเหตุ
3. ความคล้าย: s1 = สูงสุดกับรูปอ้างอิงหัวข้อเดียวกัน (ไม่นับไซต์ตัวเอง), so = สูงสุดกับ section อื่น, เกณฑ์ต่อหัวข้อ = p10 ของความคล้าย leave-one-site-out ของรูปอ้างอิงเอง (ขั้นต่ำ `imageSim.value` 0.70 สูงสุด 0.90, หัวข้อ < 8 รูป ใช้ 0.78) screenshot ได้ ~0.92 รูปกราวด์/ODF ~0.72
4. ผ่านอัตโนมัติเมื่อ s1 ≥ เกณฑ์ และ s1 + 0.03 ≥ so และไม่มีธง หรือป้ายในรูป (a)/(b) ยืนยันรหัสไซต์ (+IP) · มิฉะนั้น "ต้องให้ ROM ตรวจ" พร้อมเหตุผลและรูปอ้างอิงที่คล้ายที่สุด 3 รูป
5. คาลิเบรตบน 1,829 รูป: ผ่านอัตโนมัติ 92% · จับรูปวางผิด section 96% · รีวิวจริง 46 ไซต์: 85% อัตโนมัติ

**reviewPanel** แสดง 3 กลุ่ม: ต้องให้ ROM ตรวจ (เปิด) · ผ่านอัตโนมัติ (พับ, Reject ทับได้) · ROM ตัดสินแล้ว ปุ่ม Accept ที่เหลือทั้งหมด / ตรวจรูปใหม่ ผลถูก cache เปิดซ้ำทันที · Accept → รูปเป็นอ้างอิง (rom) · Reject → จำ hash+emb+เหตุผล เตือนถ้ารูปเดิมโผล่อีก

## 7. ฐานความรู้ทีม (learn.js, cloud.js, Supabase)

| ตาราง (key + data jsonb) | เนื้อหา | เขียนเมื่อ |
|---|---|---|
| issue_decisions | ลายเซ็นประเด็น → ยอมรับ/ยืนยันปัญหา (scope all/site), เหตุผล, โดย, เมื่อ | ROM กดในแท็บประเด็น |
| image_decisions | hash รูป → Accept/Reject, เหตุผล, emb | ROM กดในแท็บตรวจรูป |
| learned_profiles | config ไซต์ชนิดใหม่ที่ ROM ยืนยัน (L1..) + ค่าที่วัด | ปุ่ม "ROM ยืนยัน: ใช้ไซต์นี้เป็นอ้างอิง" |
| ref_images (+ bucket ref-thumbs) | รูปอ้างอิง: โปรไฟล์, หัวข้อ, ไซต์, หน้า, hash, digest, emb, ที่มา, รูปย่อ ~30 KB | ลูกค้าเซ็นแล้ว / ปุ่มใช้ชุดนี้เป็นตัวอย่าง / Accept |
| section_stats | จำนวนรูปต่อ (โปรไฟล์ × หัวข้อ) ต่อไซต์ · `INV|<ไซต์>` = inventory | ตอนเก็บรูปอ้างอิง / OCR |

- สิทธิ์: `schema.sql` (RLS ตามโดเมน/รายชื่อ สำหรับโหมด login) + `no-login.sql` (anon อ่าน/เขียนได้ — โหมดที่ใช้อยู่) ใครรู้ URL เว็บก็อ่าน/เขียนได้ ถ้าต้องการจำกัดเปิด Password Protection ของ Vercel
- ซิงก์: เปิดหน้า/กด "ซิงก์" ดึงทุกตาราง (แบ่งหน้า 1,000 แถว) รวมกับสำเนาในเครื่อง (localStorage + IndexedDB) คลาวด์ชนะเมื่อ key ซ้ำ รูปที่ถูกถอดบนคลาวด์ถูกถอดในเครื่องตาม ทุกการเขียนขึ้นคลาวด์ทันที
- ปุ่ม "อัปโหลดฐานความรู้ในเครื่องขึ้นคลาวด์" ใช้ย้ายข้อมูลเก่าครั้งแรก ปุ่มล้างในหน้าเว็บมีผลเฉพาะเครื่อง

## 8. การตัดสินใจของ ROM

| แถว | ปุ่ม | ขอบเขต | ผล |
|---|---|---|---|
| เตือน | ยอมรับ / ยืนยันปัญหา + เหตุผล | ทุกไซต์ (ลายเซ็น = กฎ+section+ชนิด+โปรไฟล์+ข้อความที่ตัดตัวเลข/รหัสไซต์) | ครั้งต่อไปติดป้ายอัตโนมัติ: ยอมรับ → เป็นข้อมูล, ยืนยันปัญหา → เป็นเตือนเสมอ |
| ไม่ผ่าน | ยอมรับ (ไซต์นี้) + เหตุผล | เฉพาะไซต์และหน้า (key `S:<ไซต์>\|<หน้า>\|<ลายเซ็น>`) | ประเด็นเป็น "ข้อมูล (เดิม fail)" สถานะคำนวณใหม่ ไม่เรียนรู้ข้ามไซต์ |
| ทุกแถว | ปุ่มหน้า N | | แสดงหน้าเอกสารจริง + ไฮไลต์ข้อความใน '…' / IP / slot / ตัวเลข |
| รูป | Accept / Reject + เหตุผล | | Accept → รูปอ้างอิง, Reject → จำ hash/emb |
| ชุดไฟล์ | ใช้ทุกไซต์ในชุดนี้เป็นรูปอ้างอิง | | เก็บรูปทุกหัวข้อ + จำนวนรูป + ลายเซ็นภาพ |

ปุ่ม "ยกเลิก"/"ลบ"/× ลบรายการนั้นทั้งทีม (คลาวด์ด้วย) และคืนสถานะเดิม

## 9. Excel (report.js)

ชีท สรุป (สถานะรวม, ไม่ผ่าน/เตือน, รูป Accept/Reject/รอ) · ประเด็น (ผล, ผลเดิม, การตัดสินใจ ROM, ขอบเขต, เหตุผล, โดย, เมื่อ) · ตรวจรูป (Accept อัตโนมัติ/ROM, Reject, เหตุผล, ข้อสังเกตของระบบ) · ข้อมูลไซต์ · Inventory (การ์ด/SW/CLEI/part/serial) สร้างสด ณ ตอนกด

## 10. ข้อมูลตัวอย่างและผลคาลิเบรต

- 46 ไซต์ AGRID/DC2DC (`../AGRID`, `../DC2DC`) → โปรไฟล์ P1–P4, เกณฑ์ค่าเทคนิค, รูปอ้างอิง 1,829 รูป/45 ไซต์ (OBSXB กับ CX2EB เป็นเอกสารเดียวกัน), inventory 44 ไซต์
- ตรวจข้อความ: 25 ไซต์ไม่ผ่าน 78 ประเด็น (ข้อผิดจริงของ subcon ในชุดตัวอย่าง) `npm test` ต้องได้ค่าเดิม
- รีวิวรูปทั้งชุด: 1,900 รูป ผ่านอัตโนมัติ 85% ต้องให้ ROM ดู 287 (76 เอกสารซ้ำ OBSXB/CX2EB, 43 392MR ไม่มีไซต์โปรไฟล์เดียวกัน, 105 คล้ายไม่ถึงเกณฑ์, 38 วางผิด section, 18 นำรูปไซต์อื่นมาใช้จริง)

## 11. ข้อจำกัดที่ต้องรู้

- ความคล้ายภาพตัดสินว่า "รูปดูเหมือนรูปที่เคยผ่าน" ไม่เห็นรายละเอียดเล็ก เช่น ขั้วกราวด์หลวม
- รูป power breaker ในเอกสาร ~500×600 px ตัวหนังสือบนป้ายเล็กเกิน OCR จึงเป็นหมายเหตุ ไม่กั้นการผ่าน
- ROADM (P3/P4) การ์ดเยอะ อ่าน serial ได้ ~70–88% แถวที่อ่านไม่ได้เว้นว่าง
- OCR ตัวเลขบนมิเตอร์/LCT (1.5 Power) อ่านได้จำกัด เป็นข้อมูลให้คนดู
- เวลาตรวจต่อไซต์รวม ~2–3 นาที (OCR + รูป) ตารางสรุปและประเด็นข้อความดูได้ทันที

## 12. โครงสร้างไฟล์

| ไฟล์ | บรรทัด | หน้าที่ |
|---|---|---|
| index.html | 79 | หน้าเว็บ (โหลด JSZip, SheetJS จาก cdnjs) |
| src/styles.css | 74 | สไตล์ |
| src/config.js | 4 | Supabase URL + publishable key |
| src/app.js | 835 | UI ทั้งหมด: โหลดไฟล์, ตรวจ, สถานะรวม, แท็บ, หน้าเอกสาร, ตรวจรูป, OCR, ฐานความรู้, ประวัติ, test hooks |
| src/engine/extract.js | 111 | pdf.js → ข้อความ/รูปต่อหน้า |
| src/engine/parse.js | 236 | โครงสร้าง SATP/Attachment |
| src/engine/rules.js | 316 | กฎ R01–R26, summarize |
| src/engine/profiles.js | 109 | โปรไฟล์ P1–P5, DEFAULT_CRITERIA, โปรไฟล์ที่เรียนรู้ |
| src/engine/index.js | 59 | analyzeFiles: จับคู่ไฟล์ต่อไซต์, เรียก extract/parse/rules, R17 |
| src/engine/ocrRules.js | 225 | O01–O10, parseInventory, buildLayouts |
| src/engine/labels.js | 107 | รูปแบบป้ายโปรเจกต์ + checkLabelText |
| src/data/sites.js | 62 | รายชื่อ 56 ไซต์ไทยจาก Masterfile |
| src/ui/images.js | 100 | renderPage, pageImageCanvases, aHash, pixelDigest, blurScore, thumb |
| src/ui/embed.js | 62 | CLIP embedding, encode/decode, cosine, rank |
| src/ui/ocr.js | 192 | Tesseract: ocrSite, ocrLabels (ป้ายสีเหลือง), imageBBox |
| src/ui/learn.js | 322 | ฐานความรู้ในเครื่อง + ซิงก์คลาวด์ + รูปอ้างอิง + inventory + สถิติ |
| src/ui/cloud.js | 98 | Supabase client: pushRow/pushRows/deleteRow/pullAll, Storage |
| src/ui/report.js | 50 | Excel |
| supabase/schema.sql, no-login.sql | 68 | ตาราง, RLS, bucket, policy anon |
| test/run-samples.mjs | 39 | regression 46 ไซต์ (Node) |
| test/serve.mjs | 16 | dev server :8090 + /samples/ + POST /__out/ |
| test/review-report.py | 85 | รายงาน Excel จากผลรีวิวรูปทั้งชุด |
| test/*.mjs อื่น | | parse-one, dump-one, img-one, img-digest |

## 13. เครื่องมือทดสอบ (localhost เท่านั้น)

`window.satpTest`: `load(paths)` โหลดจาก /samples/ · `runCheck()` · `skipBackground` · `harvestAllAsSamples()` · `harvestInventory()` · `backfillEmbeddings()` · `backfillDigests()` · `decideSiteImages(r)` · `wb()` Excel · `refVectorsForProfile` ฯลฯ — ใช้ร่วมกับ `node test/serve.mjs .` และ `test/out/all_pdfs.json`

## 14. Deploy

Static site บน Vercel (Pro) auto-deploy เมื่อ push `main` · ไลบรารีจาก CDN: pdf.js 4.10.38, JSZip 3.10.1, SheetJS 0.18.5, Tesseract.js 5.1.1 (cdnjs), supabase-js 2, transformers.js 3.7.5 + Xenova/clip-vit-base-patch32 (jsdelivr/huggingface) · `.gitignore` กัน PDF/zip · README.md มีขั้นตอนตั้งค่า Supabase
