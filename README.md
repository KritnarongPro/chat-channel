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
4. **โดเมน** `noti.kalon-ai.app` — โซน `kalon-ai.app` ต้องอยู่ใน Cloudflare account เดียวกัน (ตั้งใน `wrangler.jsonc` → routes)

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
| `shared/time.ts` | เวลาไทย — ห้ามใช้ `toISOString()` ที่อื่น |
| `scripts/check-rules.mjs` | ข้อสอบอัตโนมัติจาก cheat sheet |

## เฟส

- [x] เฟส 1: ล็อกอิน LINE + อนุมัติผู้ใช้ + แชท 1:1 และกลุ่มแบบเรียลไทม์
- [ ] เฟส 2: รูป / ไฟล์ / ข้อความเสียง (R2)
- [ ] เฟส 3: ชาเนล + แจ้งเตือน (Web Push / PWA)
- [ ] เฟส 4: ระบบบอท (token + webhook) + n8n + บอท AI + โพสต์ข่าวอัตโนมัติ + ฟอร์มรับออเดอร์
