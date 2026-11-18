-- =====================================================================
-- 0011_profile.sql — เปลี่ยนรูปโปรไฟล์ / ชื่อที่แสดง / รูปกลุ่ม-ชาเนล (2026-11-18)
--   users.display_name / picture_url ยังเป็น "ค่าที่แสดงจริง" เหมือนเดิม (ทุกจุดที่อ่านชื่อ/รูปไม่ต้องแก้)
--   oauth_name / oauth_picture = ชื่อ/รูปล่าสุดจาก Gmail (หรือ LINE บัญชีเก่า) — ใช้ตอนกด "กลับไปใช้ของ Gmail"
--   name_custom = 1 → ผู้ใช้ตั้งชื่อเอง: ล็อกอินครั้งถัดไปห้ามเขียนทับ display_name
--   picture_id  ไม่ว่าง → ผู้ใช้อัปรูปเอง (R2 pictures/<picture_id>): ล็อกอินห้ามเขียนทับ picture_url
--   rooms.picture_id → รูปกลุ่ม/ชาเนล (แชท 1:1 ใช้รูปของอีกฝ่ายเหมือนเดิม)
-- =====================================================================
ALTER TABLE users ADD COLUMN oauth_name TEXT;
ALTER TABLE users ADD COLUMN oauth_picture TEXT;
ALTER TABLE users ADD COLUMN name_custom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN picture_id TEXT;
ALTER TABLE rooms ADD COLUMN picture_id TEXT;

-- คนเดิม: ชื่อ/รูปตอนนี้มาจาก Gmail/LINE ทั้งหมด → เก็บไว้เป็นค่าสำรองสำหรับปุ่ม "กลับไปใช้ของ Gmail"
UPDATE users SET oauth_name = display_name, oauth_picture = picture_url WHERE is_bot = 0;
