-- =====================================================================
-- 0006_notifications.sql — ระบบแจ้งเตือนแบบ Telegram
-- เวลาทุกคอลัมน์ *_at / *_until เก็บเป็นเวลาไทย ISO (+07:00)
-- =====================================================================

-- ---------- ปิดเสียงแบบมีเวลา ----------
-- muted = 1 + muted_until = NULL → ปิดตลอด · muted = 1 + muted_until = เวลา → ปิดถึงเวลานั้นแล้วเปิดเองอัตโนมัติ
ALTER TABLE room_members ADD COLUMN muted_until TEXT;

-- ---------- ปักหมุดข้อความในห้อง (1 ข้อความต่อห้อง) ----------
ALTER TABLE rooms ADD COLUMN pinned_seq INTEGER;
ALTER TABLE rooms ADD COLUMN pinned_text TEXT;
ALTER TABLE rooms ADD COLUMN pinned_sender TEXT;
ALTER TABLE rooms ADD COLUMN pinned_by TEXT;
ALTER TABLE rooms ADD COLUMN pinned_at TEXT;

-- ---------- บอทส่งแจ้งเตือนหาคนโดยตรง ----------
-- contacted = ส่งได้เฉพาะคนที่เคยมีแชท 1:1 กับบอทแล้ว (แบบ Telegram) · all = ส่งหาผู้ใช้ที่อนุมัติแล้วได้ทุกคน
ALTER TABLE bots ADD COLUMN notify_scope TEXT NOT NULL DEFAULT 'contacted' CHECK (notify_scope IN ('contacted', 'all'));

-- ---------- ตั้งค่าแจ้งเตือนรวมของแต่ละคน (ไม่มีแถว = ค่าเริ่มต้น เปิดทั้งหมด) ----------
-- dm / groups / channels: แจ้งเตือนห้องประเภทนั้นไหม · show_preview: แสดงเนื้อหาข้อความในแจ้งเตือนไหม
-- mentions_when_muted: ถูก @ชื่อ หรือถูกตอบกลับ ยังแจ้งเตือนแม้ปิดเสียงห้อง/ปิดประเภทนั้นไว้
CREATE TABLE notify_settings (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dm                   INTEGER NOT NULL DEFAULT 1,
  groups               INTEGER NOT NULL DEFAULT 1,
  channels             INTEGER NOT NULL DEFAULT 1,
  show_preview         INTEGER NOT NULL DEFAULT 1,
  mentions_when_muted  INTEGER NOT NULL DEFAULT 1,
  updated_at           TEXT NOT NULL
);
