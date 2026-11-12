-- =====================================================================
-- schema.sql — โครงฐานข้อมูล D1 ปัจจุบันทั้งหมด (รวมทุก migration) ใช้อ่านอ้างอิง
-- แก้โครงตาราง → เพิ่มไฟล์ใหม่ใน migrations/ แล้วอัปเดตไฟล์นี้ให้ตรงกัน (check:rules ตรวจให้)
-- ล่าสุดถึง: 0007_phase5.sql
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
  description           TEXT,                                              -- 0003: คำอธิบายชาเนล
  pinned_seq            INTEGER,  -- 0006: ข้อความที่ปักหมุด (ลำดับในห้อง)
  pinned_text           TEXT,     -- 0006: ข้อความย่อของโพสต์ที่ปักหมุด
  pinned_sender         TEXT,     -- 0006
  pinned_by             TEXT,     -- 0006: ใครปักหมุด (users.id)
  pinned_at             TEXT      -- 0006
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
  muted_until    TEXT,                        -- 0006: ปิดถึงเวลานี้ (NULL + muted=1 = ปิดตลอด)
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
  fail_count        INTEGER NOT NULL DEFAULT 0,
  notify_scope      TEXT NOT NULL DEFAULT 'contacted' CHECK (notify_scope IN ('contacted', 'all'))  -- 0006
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

-- ---------- ลิงก์เชิญ (0005) ----------
CREATE TABLE invite_links (
  code        TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  max_uses    INTEGER,
  use_count   INTEGER NOT NULL DEFAULT 0,
  revoked_at  TEXT
);
CREATE INDEX idx_invite_links_room ON invite_links(room_id);

-- ---------- ใครเข้ามาผ่านลิงก์ไหน ----------
CREATE TABLE invite_uses (
  code     TEXT NOT NULL REFERENCES invite_links(code) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at  TEXT NOT NULL,
  PRIMARY KEY (code, user_id)
);

-- ---------- ตั้งค่าแจ้งเตือนรวม (0006) ----------
CREATE TABLE notify_settings (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dm                   INTEGER NOT NULL DEFAULT 1,
  groups               INTEGER NOT NULL DEFAULT 1,
  channels             INTEGER NOT NULL DEFAULT 1,
  show_preview         INTEGER NOT NULL DEFAULT 1,
  mentions_when_muted  INTEGER NOT NULL DEFAULT 1,
  updated_at           TEXT NOT NULL
);

-- =====================================================================
-- 0007: เฟส 5 (ธีม/ตัวอักษร · เพื่อน · สติกเกอร์ · โน้ต)
-- =====================================================================
-- ---------- ค่าที่ผู้ใช้เลือก (จำต่อบัญชี ใช้ได้ทุกเครื่อง) ----------
CREATE TABLE user_prefs (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme       TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  font_level  INTEGER NOT NULL DEFAULT 3 CHECK (font_level BETWEEN 1 AND 5),
  updated_at  TEXT NOT NULL
);

-- ---------- เพื่อน: 1 แถวต่อคู่ (user_low < user_high) ----------
-- status: pending = รออีกฝ่ายกดยอมรับ (requested_by = คนส่งคำขอ) · accepted = เป็นเพื่อนกันแล้ว
-- ปฏิเสธ / ยกเลิกคำขอ / เลิกเป็นเพื่อน = ลบแถว
CREATE TABLE friendships (
  user_low      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  accepted_at   TEXT,
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);
CREATE INDEX idx_friendships_high ON friendships(user_high);

-- ---------- สติกเกอร์ (แอดมินระบบเพิ่ม · ตัวภาพอยู่ใน R2 ไม่มีวันหมดอายุ) ----------
CREATE TABLE sticker_packs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE TABLE stickers (
  id          TEXT PRIMARY KEY,
  pack_id     TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  r2_key      TEXT NOT NULL UNIQUE,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_stickers_pack ON stickers(pack_id, sort);

-- ---------- โน้ตในห้อง (แบบ LINE: สมาชิกทุกคนเห็น + คอมเมนต์ได้) ----------
CREATE TABLE room_notes (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_room_notes_room ON room_notes(room_id, created_at);
CREATE TABLE note_comments (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES room_notes(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_note_comments_note ON note_comments(note_id, created_at);

-- ---------- โน้ตส่วนตัว (เห็นคนเดียว) ----------
CREATE TABLE user_notes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_user_notes_user ON user_notes(user_id, updated_at);
