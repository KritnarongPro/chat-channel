-- =====================================================================
-- 0010_chat_more.sql — ฟีเจอร์แชทชุด 2 (2026-11-17)
--   1) files: รับชนิด 'video' (SQLite แก้ CHECK เดิมไม่ได้ → สร้างตารางใหม่ ย้ายข้อมูล แล้วเปลี่ยนชื่อ)
--   2) room_pins: ปักหมุด/ประกาศได้หลายข้อความต่อห้อง (สูงสุด 5 — ตรวจในโค้ด) · ย้ายหมุดเดิมจาก rooms.pinned_* มาไว้ที่นี่
--      rooms.pinned_* เลิกใช้ตั้งแต่ 0010 (คอลัมน์ยังอยู่ — SQLite ลบคอลัมน์ที่มีข้อมูลแล้วไม่สะดวก)
--   3) link_previews: เก็บหัวข้อ/รูปของลิงก์ที่ดึงมาแล้ว 7 วัน (รูปส่งผ่านเซิร์ฟเวอร์เรา — เว็บต้นทางไม่เห็น IP ผู้ใช้)
--   โพล / อัลบั้ม / กำลังพิมพ์ เก็บในห้องแชท (Durable Object v7) ไม่ใช่ D1
-- =====================================================================
PRAGMA defer_foreign_keys = true;

CREATE TABLE files_v2 (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  uploader_id  TEXT NOT NULL REFERENCES users(id),
  r2_key       TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'file', 'voice', 'video')),
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
INSERT INTO files_v2 (id, room_id, uploader_id, r2_key, kind, mime, name, size, width, height, duration_ms,
                      status, message_seq, created_at, expires_at)
  SELECT id, room_id, uploader_id, r2_key, kind, mime, name, size, width, height, duration_ms,
         status, message_seq, created_at, expires_at FROM files;
DROP TABLE files;
ALTER TABLE files_v2 RENAME TO files;
CREATE INDEX idx_files_room ON files(room_id);
CREATE INDEX idx_files_status_expires ON files(status, expires_at);

CREATE TABLE room_pins (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,          -- ลำดับข้อความในห้อง
  text       TEXT NOT NULL,             -- ข้อความย่อตอนปัก
  sender     TEXT,                      -- ชื่อคนเขียนข้อความ
  pinned_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  pinned_at  TEXT NOT NULL,             -- เวลาไทย
  PRIMARY KEY (room_id, seq)
);
CREATE INDEX idx_room_pins_room ON room_pins(room_id, pinned_at);
INSERT INTO room_pins (room_id, seq, text, sender, pinned_by, pinned_at)
  SELECT id, pinned_seq, COALESCE(pinned_text, ''), pinned_sender, pinned_by, COALESCE(pinned_at, created_at)
  FROM rooms WHERE pinned_seq IS NOT NULL;

CREATE TABLE link_previews (
  url          TEXT PRIMARY KEY,        -- ลิงก์ตามที่อยู่ในข้อความ
  status       TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  title        TEXT,
  description  TEXT,
  site_name    TEXT,
  image_url    TEXT,                    -- รูปต้นทาง (เปิดผ่าน /api/link-preview/image เท่านั้น)
  error        TEXT,                    -- เหตุผลที่ดึงไม่ได้ (status = failed)
  fetched_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL            -- เก็บ 7 วันแล้วดึงใหม่
);
