-- =====================================================================
-- 0002_files.sql — ไฟล์ที่อัปโหลดในห้อง (รูป / ไฟล์ / ข้อความเสียง) — ตัวไฟล์อยู่ใน R2 bucket "chat-channel"
-- status: uploaded = อัปแล้วแต่ยังไม่ได้ส่งเป็นข้อความ (เกิน 1 วันจะถูกลบ)
--         attached = ผูกกับข้อความแล้ว · expired = ครบ 180 วัน ลบไฟล์ใน R2 แล้ว (แถวนี้เก็บไว้เป็นประวัติ)
-- เวลาทุกคอลัมน์ *_at เก็บเป็นเวลาไทย ISO (+07:00)
-- =====================================================================
CREATE TABLE files (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  uploader_id  TEXT NOT NULL REFERENCES users(id),
  r2_key       TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'file', 'voice')),
  mime         TEXT NOT NULL,
  name         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  duration_ms  INTEGER,
  status       TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'attached', 'expired')),
  message_seq  INTEGER,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_files_room ON files(room_id);
CREATE INDEX idx_files_status_expires ON files(status, expires_at);
