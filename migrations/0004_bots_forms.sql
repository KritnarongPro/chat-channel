-- =====================================================================
-- 0004_bots_forms.sql — ระบบบอท + ฟอร์ม + ออเดอร์ (เฟส 4)
-- เวลาทุกคอลัมน์ *_at เก็บเป็นเวลาไทย ISO (+07:00)
-- =====================================================================

-- ---------- บอท = ผู้ใช้พิเศษ (is_bot = 1) · line_user_id ของบอทเป็น 'bot:<id>' ----------
ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;

-- ---------- ข้อมูลบอท (id เดียวกับ users.id) ----------
-- token_hash: เก็บ hash ของ token เท่านั้น (token เต็มแสดงครั้งเดียวตอนสร้าง) · token_hint: 4 ตัวท้ายไว้จำ
-- webhook_url: ที่ส่งข้อความถึงบอท (เช่น n8n) · webhook_secret: ส่งในหัว X-Bot-Secret ให้ปลายทางตรวจ
-- last_* / fail_count: ผลส่ง webhook ล่าสุด (แสดงในหน้าจัดการบอท)
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
