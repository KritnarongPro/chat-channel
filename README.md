# chat-channel — แชทส่วนตัว

แชท 1:1 / กลุ่ม / ชาเนล + บอท สำหรับกลุ่มของเรา บน Cloudflare (Workers + Durable Objects + D1 + R2)
เว็บ: https://noti.kalon-ai.app

## วิธี deploy: GitHub Actions (ไม่ใช้ Workers Builds)

| เหตุการณ์ | สิ่งที่เกิด |
|---|---|
| เปิด/อัปเดต PR เข้า `main` | ตรวจกฎ cheat sheet (`check:rules`) + typecheck + build — **ยังไม่ deploy** |
| merge เข้า `main` | ตรวจอีกรอบ → D1 migration (remote) → `wrangler deploy` |

ห้ามเปิด Workers Builds ให้ repo นี้ ไม่งั้นจะ deploy ซ้ำ 2 ทาง

## ตั้งค่าครั้งแรก

1. **GitHub Secrets** (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
2. **Cloudflare Worker secrets** (Workers → chat-channel → Settings → Variables and Secrets — ตั้งหลัง deploy ครั้งแรก):
   - `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` — จาก LINE Developers (LINE Login channel)
   - `SETUP_TOKEN` — รหัสยาว ๆ ที่ตั้งเอง ใช้ครั้งเดียวตอนตั้งแอดมินคนแรก
3. **LINE Login channel** → Callback URL: `https://noti.kalon-ai.app/api/auth/line/callback` · เปิด scope `openid` + `profile`
4. **R2 bucket** ชื่อ `chat-channel` (เก็บรูป/ไฟล์/เสียง) — ไม่ต้องเปิด public access
5. **Queue** ชื่อ `chat-push` (Workers & Pages → Queues → Create) — ใช้กระจายแจ้งเตือน · API token ของ GitHub Actions ต้องมีสิทธิ์ **Queues: Edit**
6. **LINE Login channel ต้องเป็น Published** (ไม่งั้นล็อกอินได้เฉพาะ Admin/Tester ของ channel)
7. **โดเมน** `noti.kalon-ai.app` — โซน `kalon-ai.app` ต้องอยู่ใน Cloudflare account เดียวกัน (ตั้งใน `wrangler.jsonc` → routes)

## ใช้งานครั้งแรก

1. เปิดเว็บ → เข้าสู่ระบบด้วย LINE → ขึ้น "รออนุมัติ"
2. ยังไม่มีแอดมิน → กรอก `SETUP_TOKEN` → เป็นแอดมินคนแรก
3. คนอื่นล็อกอิน → แอดมินเข้า "แอดมิน" กดอนุมัติ

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `worker/index.ts` | API + ตาราง endpoint แยกหมวด |
| `worker/lib.ts` | ของใช้ร่วม: รูปแบบ error, session, `requireUser` (ตรวจสิทธิ์ที่เดียว) |
| `worker/auth-line.ts` | LINE Login |
| `worker/room.ts` | ห้องแชท (Durable Object): WebSocket + ข้อความใน SQLite ของห้อง |
| `migrations/` + `schema.sql` | ตาราง D1 (ผู้ใช้ session ห้อง สมาชิก) |
| `do-schema.sql` | ตารางในห้อง (ข้อความ) — ใช้อ่านอ้างอิง ตัวจริงอยู่ใน `worker/room.ts` |
| `worker/cleanup.ts` | งานทุกวัน 03:00 เวลาไทย: ลบไฟล์ครบ 180 วัน + ไฟล์ที่อัปแล้วไม่ได้ส่ง |
| `src/media.ts`, `src/VoiceRecorder.tsx`, `src/MessageContent.tsx` | ย่อรูป, อัดเสียง, แสดงรูป/ไฟล์/เสียง |
| `worker/push.ts` | แจ้งเตือนบนมือถือ: กุญแจ VAPID (สร้างเองเก็บใน app_settings), เข้ารหัส RFC 8291, ส่ง, Queue consumer |
| `public/sw.js`, `src/pwa.ts`, `src/SetupCard.tsx` | ติดตั้งแอป (คลิกเดียวบน Android/คอม, วิธีทำบน iPhone, ออกจากในแอป LINE) + เปิดแจ้งเตือน |
| `shared/forms.ts` | ฟอร์ม: ชนิดช่อง + ตรวจโครง + ตรวจคำตอบ (ใช้ทั้งหน้าเว็บและ worker) |
| `docs/n8n/` | เวิร์กโฟลว์ n8n พร้อมนำเข้า (บอท AI, ข่าว RSS → ชาเนล, แจ้งออเดอร์) + คู่มือ Bot API |
| `worker/invites.ts`, `src/InvitePanel.tsx`, `src/pages/JoinPage.tsx` | ลิงก์เชิญเข้าชาเนล/กลุ่ม (`/join/<รหัส>`): อายุ, จำนวนคน, ยกเลิก, QR, แชร์ LINE |
| `shared/time.ts` | เวลาไทย — ห้ามใช้ `toISOString()` ที่อื่น |
| `scripts/check-rules.mjs` | ข้อสอบอัตโนมัติจาก cheat sheet |

## เฟส

- [x] เฟส 1: ล็อกอิน LINE + อนุมัติผู้ใช้ + แชท 1:1 และกลุ่มแบบเรียลไทม์
- [x] เฟส 2: รูป (ย่อ 1600px) / ส่งเป็นไฟล์ / ข้อความเสียง 5 นาที — R2, เปิดได้เฉพาะสมาชิกห้อง, ลบอัตโนมัติ 180 วัน
- [x] เฟส 3: ชาเนล (สาธารณะ/ส่วนตัว, แอดมินระบบสร้าง, เจ้าของ/แอดมินชาเนลโพสต์) + แจ้งเตือน Web Push ผ่าน Queue + ติดตั้งแอป
- [x] ลิงก์เชิญเข้าชาเนล/กลุ่ม — คนใหม่ล็อกอิน LINE ผ่านลิงก์ได้รับอนุมัติทันที
- [x] เฟส 4: ระบบบอท (token + webhook ผ่าน Queue + Bot API) + n8n + บอท AI (Claude) + ข่าว RSS → ชาเนล + ฟอร์มรับออเดอร์ (ตัวสร้างฟอร์ม, การ์ดฟอร์ม, หน้าออเดอร์) — ดู `docs/n8n/README.md`
