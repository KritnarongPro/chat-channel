-- =====================================================================
-- 0005_invites.sql — ลิงก์เชิญเข้าชาเนล/กลุ่ม (https://noti.kalon-ai.app/join/<code>)
-- กดลิงก์: คนใหม่ล็อกอิน LINE แล้วได้รับอนุมัติทันที + เข้าห้อง · คนที่มีบัญชีแล้วเข้าห้องทันที
-- เวลาทุกคอลัมน์ *_at เก็บเป็นเวลาไทย ISO (+07:00)
-- =====================================================================

-- ---------- ลิงก์เชิญ ----------
-- expires_at: NULL = ไม่หมดอายุ · max_uses: NULL = ไม่จำกัดจำนวนคน · revoked_at: ไม่ NULL = ถูกยกเลิก
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
