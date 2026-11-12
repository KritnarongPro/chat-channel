-- =====================================================================
-- 0007_phase5.sql — เฟส 5: ธีม/ขนาดตัวอักษร · เพื่อน · สติกเกอร์ · โน้ต (ในห้อง + ส่วนตัว)
-- เวลาทุกช่องเป็นเวลาไทย ISO (+07:00)
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

-- ผู้ใช้เลือก: คนที่มีแชท 1:1 กันอยู่แล้ว (ที่ไม่ใช่บอท) → เป็นเพื่อนกันอัตโนมัติ แชทเดิมใช้ต่อได้
-- dm_key = ไอดี 2 คนเรียงแล้วต่อด้วย ':' จึงได้ low < high ตรงตามเงื่อนไข
INSERT OR IGNORE INTO friendships (user_low, user_high, status, requested_by, created_at, accepted_at)
SELECT substr(r.dm_key, 1, instr(r.dm_key, ':') - 1),
       substr(r.dm_key, instr(r.dm_key, ':') + 1),
       'accepted', r.created_by, r.created_at, r.created_at
FROM rooms r
WHERE r.type = 'dm' AND r.dm_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.is_bot = 1
      AND (u.id = substr(r.dm_key, 1, instr(r.dm_key, ':') - 1) OR u.id = substr(r.dm_key, instr(r.dm_key, ':') + 1))
  );

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
