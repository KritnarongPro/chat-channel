-- =====================================================================
-- do-schema.sql — โครงตารางใน "แต่ละห้อง" (SQLite ของ Durable Object ChatRoom) ใช้อ่านอ้างอิง
-- ตารางพวกนี้ไม่ได้อยู่ใน D1 จึงใช้ migrations/ ของ D1 ไม่ได้
-- ตัวที่ใช้จริงอยู่ใน worker/room.ts (DO_MIGRATIONS) — ห้องจะอัปเดตตัวเองตอนถูกเปิดครั้งถัดไป
-- แก้โครง → เพิ่มเวอร์ชันใหม่ใน DO_MIGRATIONS + เลข DO_SCHEMA_VERSION + อัปเดตไฟล์นี้ (check:rules ตรวจเลขให้ตรงกัน)
-- DO_SCHEMA_VERSION: 1
-- =====================================================================

-- ---------- v1 ----------
-- meta: schema_version = เวอร์ชันโครงของห้องนี้ · room_id = รหัสห้อง (ใช้อัปเดต D1)
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- messages: ข้อความในห้อง · seq = ลำดับ · id = รหัสจากหน้าเว็บ (กันส่งซ้ำ) · created_at = เวลาไทย ISO
CREATE TABLE messages (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  sender_id   TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('text')),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
