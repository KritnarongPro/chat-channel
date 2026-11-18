-- =====================================================================
-- 0012_room_links.sql — ลิงก์ของกลุ่ม/ชาเนล (2026-11-18)
--   ผู้ใช้เลือก: เจ้าของ/แอดมินห้องเพิ่ม/แก้/ลบ · สมาชิกดูและกดใช้ · กลุ่ม + ชาเนล (ไม่มีในแชท 1:1)
--   แถบลิงก์ด่วนในห้อง = ลิงก์ที่ pinned = 1 (สูงสุด 8 — ตรวจในโค้ด) · ทั้งหมดสูงสุด 50 ต่อห้อง
--   icon_kind: auto = ดึงไอคอนจากเว็บ (เก็บใน R2 pictures/<icon_value>) · upload = อัปรูปเอง (R2 เหมือนกัน)
--              emoji = icon_value เป็นอีโมจิ · letter = ตัวอักษรแรกของชื่อ (ดึงไอคอนไม่ได้ก็ใช้แบบนี้)
--   color: สีพื้นของ emoji/letter (ชื่อสีจาก LINK_COLORS ใน shared/protocol.ts)
-- =====================================================================
CREATE TABLE room_links (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  category    TEXT,
  icon_kind   TEXT NOT NULL DEFAULT 'letter' CHECK (icon_kind IN ('auto', 'upload', 'emoji', 'letter')),
  icon_value  TEXT,
  color       TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_room_links_room ON room_links(room_id, sort);
