-- =====================================================================
-- 0001_init.sql — ตารางกลางของระบบแชท (D1)
-- ข้อความของแต่ละห้องไม่ได้อยู่ที่นี่ → อยู่ใน SQLite ของ Durable Object ห้องนั้น (ดู do-schema.sql)
-- เวลาทุกคอลัมน์ *_at เก็บเป็นข้อความ ISO เวลาไทย เช่น 2026-11-10T11:09:00.000+07:00
-- =====================================================================

-- ---------- ผู้ใช้ (ล็อกอินด้วย LINE) ----------
-- status: pending = รอแอดมินอนุมัติ · active = ใช้งานได้ · blocked = ถูกระงับ
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  line_user_id  TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  picture_url   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'blocked')),
  role          TEXT NOT NULL DEFAULT 'member'  CHECK (role IN ('member', 'admin')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- ---------- การล็อกอิน (เก็บ hash ของ token เท่านั้น) ----------
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ---------- ห้อง ----------
-- type: dm = แชท 1:1 · group = กลุ่ม · channel = ชาเนล (เฟส 3)
-- dm_key: ไอดีผู้ใช้ 2 คนเรียงแล้วต่อด้วย ':' กันสร้างห้อง 1:1 ซ้ำ (ห้องอื่นเป็น NULL)
-- last_*: ข้อความล่าสุดย่อ ๆ ที่ห้อง (Durable Object) ส่งมาอัปเดต ใช้แสดงหน้ารายการแชท
CREATE TABLE rooms (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL CHECK (type IN ('dm', 'group', 'channel')),
  title                 TEXT,
  dm_key                TEXT UNIQUE,
  created_by            TEXT NOT NULL REFERENCES users(id),
  created_at            TEXT NOT NULL,
  last_seq              INTEGER NOT NULL DEFAULT 0,
  last_message_at       TEXT,
  last_message_preview  TEXT,
  last_sender_name      TEXT
);

-- ---------- สมาชิกห้อง ----------
-- last_read_seq: อ่านถึงข้อความลำดับที่เท่าไรแล้ว (ยังไม่อ่าน = rooms.last_seq - last_read_seq)
CREATE TABLE room_members (
  room_id        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at      TEXT NOT NULL,
  last_read_seq  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);
