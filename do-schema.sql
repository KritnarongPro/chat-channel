-- =====================================================================
-- do-schema.sql — โครงตารางใน "แต่ละห้อง" (SQLite ของ Durable Object ChatRoom) ใช้อ่านอ้างอิง
-- ตารางพวกนี้ไม่ได้อยู่ใน D1 จึงใช้ migrations/ ของ D1 ไม่ได้
-- ตัวที่ใช้จริงอยู่ใน worker/room.ts (DO_MIGRATIONS) — ห้องจะอัปเดตตัวเองตอนถูกเปิดครั้งถัดไป
-- แก้โครง → เพิ่มเวอร์ชันใหม่ใน DO_MIGRATIONS + เลข DO_SCHEMA_VERSION + อัปเดตไฟล์นี้ (check:rules ตรวจเลขให้ตรงกัน)
-- DO_SCHEMA_VERSION: 7
-- =====================================================================

-- ---------- v1 ----------
-- meta: schema_version = เวอร์ชันโครงของห้องนี้ · room_id = รหัสห้อง (ใช้อัปเดต D1)
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ---------- v2 (เฟส 2) → v3 (เฟส 4) → v4 (เฟส 5): สร้าง messages ใหม่แล้วย้ายข้อมูลทุกครั้ง (SQLite แก้ CHECK เดิมไม่ได้) ----------
-- messages: ข้อความในห้อง · seq = ลำดับ · id = รหัสจากหน้าเว็บ (กันส่งซ้ำ) · created_at = เวลาไทย ISO
-- kind: text / image / file / voice / form (v3: การ์ดฟอร์ม) / sticker (v4: extra.stickerId) · body = ข้อความหรือคำบรรยาย
-- file_*: สำเนาข้อมูลไฟล์จากตาราง files ใน D1 (ตัวไฟล์อยู่ใน R2) · file_expires_at = วันที่ไฟล์จะถูกลบ (180 วัน)
CREATE TABLE messages (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  id               TEXT NOT NULL UNIQUE,
  sender_id        TEXT NOT NULL,
  sender_name      TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('text', 'image', 'file', 'voice', 'form', 'sticker', 'video', 'poll')),
  body             TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  file_id          TEXT,
  file_name        TEXT,
  file_mime        TEXT,
  file_size        INTEGER,
  file_width       INTEGER,
  file_height      INTEGER,
  file_duration_ms INTEGER,
  file_expires_at  TEXT,
  extra            TEXT,  -- v3: JSON เช่น { formId, formTitle } / { orderId } · v4: { stickerId } / { noteId }
  deleted_at       TEXT,  -- v5: ยกเลิกส่ง/แอดมินลบ (เวลาไทย) — เนื้อหา/ไฟล์ถูกล้างแล้ว
  deleted_by       TEXT   -- v5: 'sender' | 'admin'
);

-- ---------- v6 (2026-11-17): รีแอคชัน — คนละ 1 อันต่อข้อความ (6 แบบใน shared/protocol.ts → REACTIONS) ----------
-- ลบข้อความ → ลบรีแอคชันของข้อความนั้นด้วย
CREATE TABLE reactions (
  seq        INTEGER NOT NULL,   -- messages.seq
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,      -- ชื่อตอนกด (แสดงในรายชื่อคนกด)
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL,      -- เวลาไทย ISO
  PRIMARY KEY (seq, user_id)
);

-- ---------- v7 (2026-11-17): messages.kind เพิ่ม 'video' / 'poll' (สร้างตารางใหม่แล้วย้ายข้อมูล — CHECK ข้างบนเป็นของ v7 แล้ว) ----------
-- ข้อความ poll: body = คำถาม · ตัวเลือก/คะแนนอยู่ในตารางด้านล่าง · ลบข้อความ → ลบโพล + โหวตด้วย
-- extra.albumId (รูป/วิดีโอที่ส่งพร้อมกัน — หน้าเว็บรวมเป็นตาราง)
CREATE TABLE polls (
  seq        INTEGER PRIMARY KEY,  -- messages.seq
  options    TEXT NOT NULL,        -- JSON ["ตัวเลือก 1", …] (2–10 ข้อ)
  multi      INTEGER NOT NULL DEFAULT 0,
  closes_at  TEXT,                 -- เวลาไทย (NULL = ไม่มีกำหนด)
  closed_at  TEXT,                 -- ปิดก่อนเวลา (คนสร้าง / เจ้าของ-แอดมินห้อง)
  created_by TEXT NOT NULL
);
CREATE TABLE poll_votes (
  seq        INTEGER NOT NULL,
  option_idx INTEGER NOT NULL,     -- ลำดับตัวเลือก (เริ่ม 0)
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,
  voted_at   TEXT NOT NULL,
  PRIMARY KEY (seq, user_id, option_idx)
);
