-- =====================================================================
-- schema.sql — โครงฐานข้อมูล D1 ปัจจุบันทั้งหมด (รวมทุก migration) ใช้อ่านอ้างอิง
-- แก้โครงตาราง → เพิ่มไฟล์ใหม่ใน migrations/ แล้วอัปเดตไฟล์นี้ให้ตรงกัน (check:rules ตรวจให้)
-- ล่าสุดถึง: 0004_bots_forms.sql
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
  is_bot        INTEGER NOT NULL DEFAULT 0,  -- 0004: 1 = บอท (line_user_id = 'bot:<id>')
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
  last_sender_name      TEXT,
  visibility            TEXT CHECK (visibility IN ('public', 'private')),  -- 0003: ชาเนลสาธารณะ/ส่วนตัว (ห้องอื่น NULL)
  description           TEXT                                               -- 0003: คำอธิบายชาเนล
);
CREATE INDEX idx_rooms_type_visibility ON rooms(type, visibility);

-- ---------- สมาชิกห้อง ----------
-- last_read_seq: อ่านถึงข้อความลำดับที่เท่าไรแล้ว (ยังไม่อ่าน = rooms.last_seq - last_read_seq)
CREATE TABLE room_members (
  room_id        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at      TEXT NOT NULL,
  last_read_seq  INTEGER NOT NULL DEFAULT 0,
  muted          INTEGER NOT NULL DEFAULT 0,  -- 0003: 1 = ปิดแจ้งเตือนห้องนี้
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);

-- ---------- ไฟล์ในห้อง (0002) — ตัวไฟล์อยู่ใน R2 · status: uploaded / attached / expired ----------
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

-- ---------- เครื่องที่รับแจ้งเตือน (0003) ----------
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

-- ---------- ค่าตั้งของระบบ เช่น กุญแจ VAPID (0003) ----------
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ---------- บอท / ฟอร์ม / ออเดอร์ (0004) ----------
CREATE TABLE bots (
  id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,
  token_hint        TEXT NOT NULL,
  webhook_url       TEXT,
  webhook_secret    TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL,
  last_delivery_at  TEXT,
  last_error        TEXT,
  last_error_at     TEXT,
  fail_count        INTEGER NOT NULL DEFAULT 0
);

-- ---------- ฟอร์ม (สร้างจากหน้า แอดมิน → ฟอร์ม) ----------
-- fields_json: [{ id, label, type: text|textarea|number|select|phone|date, required, options?, min?, max? }]
-- bot_id: บอทที่จะได้รับออเดอร์จากฟอร์มนี้ทาง webhook (ไม่ใส่ก็ได้)
CREATE TABLE forms (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  fields_json  TEXT NOT NULL,
  bot_id       TEXT REFERENCES bots(id) ON DELETE SET NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- ---------- ออเดอร์ (เลขออเดอร์ = id) ----------
-- data_json: คำตอบที่กรอก { fieldId: value } · form_snapshot: สำเนาฟอร์มตอนกรอก (แก้ฟอร์มทีหลัง ออเดอร์เก่าไม่เพี้ยน)
-- status: new = ใหม่ · in_progress = กำลังทำ · done = เสร็จ · cancelled = ยกเลิก
CREATE TABLE orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id        TEXT NOT NULL REFERENCES forms(id),
  room_id        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id),
  data_json      TEXT NOT NULL,
  form_snapshot  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done', 'cancelled')),
  status_note    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_user ON orders(user_id, created_at);
