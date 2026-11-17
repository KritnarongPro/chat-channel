-- =====================================================================
-- 0008_google_login.sql — เข้าสู่ระบบด้วย Google (Gmail)
--   google_sub = รหัสบัญชี Google (claim "sub") · email = อีเมลที่ Google ยืนยันแล้ว (แสดงในหน้าบัญชี/แอดมิน)
--   คนที่สมัครด้วย Google อย่างเดียว: line_user_id = 'google:<sub>' (ช่องนี้ NOT NULL — แบบเดียวกับบอท 'bot:<id>')
--   ผูกบัญชีเอง (ผู้ใช้เลือก): เข้าด้วย LINE แล้วกด "ผูก Google" หรือกลับกัน ในหน้า บัญชี — ไม่จับคู่จากอีเมลอัตโนมัติ
-- =====================================================================
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub);
