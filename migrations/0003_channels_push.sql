-- =====================================================================
-- 0003_channels_push.sql — ชาเนล + ปิดเสียงรายห้อง + แจ้งเตือนบนมือถือ (Web Push)
-- เวลาทุกคอลัมน์ *_at เก็บเป็นเวลาไทย ISO (+07:00)
-- =====================================================================

-- ---------- ชาเนล ----------
-- visibility: public = อยู่ในหน้ารายการชาเนล ใครก็กดติดตามได้ · private = เจ้าของ/แอดมินชาเนลเพิ่มคนเอง · ห้องอื่นเป็น NULL
ALTER TABLE rooms ADD COLUMN visibility TEXT CHECK (visibility IN ('public', 'private'));
ALTER TABLE rooms ADD COLUMN description TEXT;
CREATE INDEX idx_rooms_type_visibility ON rooms(type, visibility);

-- ---------- ปิดเสียงรายห้อง (1 = ไม่ส่งแจ้งเตือนห้องนี้) ----------
ALTER TABLE room_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;

-- ---------- เครื่องที่รับแจ้งเตือน (1 คนมีได้หลายเครื่อง) ----------
-- last_error / fail_count: ส่งไม่สำเร็จล่าสุดเพราะอะไร (แสดงในหน้าตั้งค่า) · push service ตอบ 404/410 = เครื่องเลิกรับแล้ว → ลบแถว
CREATE TABLE push_subscriptions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint         TEXT NOT NULL UNIQUE,
  p256dh           TEXT NOT NULL,
  auth             TEXT NOT NULL,
  device_label     TEXT,
  created_at       TEXT NOT NULL,
  last_success_at  TEXT,
  last_error       TEXT,
  last_error_at    TEXT,
  fail_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);

-- ---------- ค่าตั้งของระบบ (เช่น กุญแจ VAPID ที่ระบบสร้างเองครั้งแรก) ----------
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
