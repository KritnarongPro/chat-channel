# บอท + n8n — วิธีตั้งค่า และ Bot API

## ภาพรวม

```
คนพิมพ์ในห้อง ──► ระบบแชท ──(Queue)──► webhook ของบอท (n8n) ──► n8n ทำงาน (ถาม Claude / บันทึก / แจ้งเตือน)
                                                               │
ห้องแชท ◄──────────── Bot API (/api/bot/…) ◄────────────────────┘  (ส่งด้วย Authorization: Bearer <token>)
```

บอทได้รับข้อความเมื่อ
- แชท 1:1 กับบอท → ทุกข้อความ
- กลุ่ม/ชาเนล → เฉพาะข้อความที่ขึ้นต้นด้วย `/` หรือมี `@ชื่อบอท`
- ฟอร์มที่ผูกกับบอท → ได้ `order` ตอนลูกค้าส่ง และ `order_status` ตอนแอดมินเปลี่ยนสถานะ

## ขั้นตอนตั้งค่า (ทำครั้งเดียวต่อบอท)

1. แชท → **แอดมิน → 🤖 บอท → สร้างบอท** → คัดลอก **token** (แสดงครั้งเดียว) และ **webhook secret**
2. n8n → **Import from File** → เลือกไฟล์ในโฟลเดอร์นี้
3. แก้ค่าในเวิร์กโฟลว์ (ค้นคำว่า `YOUR_`):
   - `YOUR_BOT_TOKEN` → token ของบอท
   - `YOUR_WEBHOOK_SECRET` → webhook secret ของบอท
   - `YOUR_ANTHROPIC_API_KEY` → API key ของ Claude (เฉพาะ ai-bot)
   - `YOUR_CHANNEL_ROOM_ID` / `YOUR_SHOP_GROUP_ROOM_ID` → รหัสห้อง (ดูจากท้าย URL `…/room/<รหัส>` หรือเรียก `GET /api/bot/rooms`)
   - แนะนำ: ย้าย token/API key ไปเก็บใน n8n Credentials แทนการใส่ตรง ๆ
4. เปิดเวิร์กโฟลว์ (Active) → คัดลอก **Production URL** ของโหนด "รับจากแชท" → วางในช่อง webhook ของบอทในหน้าแอดมิน → กด **ทดสอบ webhook**
5. เพิ่มบอทเข้ากลุ่ม/ชาเนล (ปุ่ม "+ เพิ่มสมาชิก") · ถ้าจะให้โพสต์ในชาเนล ต้อง **ตั้งเป็นแอดมินชาเนล**

> ⚠️ ไฟล์เวิร์กโฟลว์เขียนตามรูปแบบ n8n รุ่นปัจจุบัน แต่ยังไม่ได้ทดสอบกับ n8n ของคุณจริง — ถ้านำเข้าแล้วโหนดไหนขึ้นแดง ส่งภาพมาให้แก้ได้

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ทำอะไร |
|---|---|
| `ai-bot.json` | รับคำถาม → ถาม Claude → ตอบกลับในห้องเดิม |
| `news-to-channel.json` | ทุก 1 ชม. อ่าน RSS → ตัดข่าวที่เคยโพสต์ → โพสต์ลงชาเนล (ไม่เกิน 5 ข่าว/รอบ) |
| `orders-notify.json` | ออเดอร์ใหม่ → สรุปรายการแจ้งในกลุ่มร้าน |

## ข้อมูลที่ระบบส่งถึง webhook

หัว `X-Bot-Secret: <webhook secret>` — ตรวจทุกครั้ง ไม่ตรงให้ทิ้ง

```json
{ "type": "message",
  "room": { "id": "…", "type": "dm|group|channel", "title": "…" },
  "message": { "seq": 12, "senderId": "…", "senderName": "สมชาย", "kind": "text", "body": "/ราคา ปุ๋ยเกล็ด", "createdAt": "2026-11-10T14:26:00.000+07:00" },
  "bot": { "id": "…", "name": "ผู้ช่วยร้าน" }, "sentAt": "…" }
```
`type` อื่น: `order`, `order_status` (มี `order` = { id, formTitle, userName, status, statusText, items:[{label, value}] … }), `test` (จากปุ่มทดสอบ)

webhook ต้องตอบ HTTP 2xx ภายใน 15 วินาที ไม่งั้นระบบลองใหม่สูงสุด 3 ครั้ง และแสดงเหตุผลในหน้าแอดมิน → บอท

## Bot API

ทุกคำขอใส่หัว `Authorization: Bearer <token>` · ตอบ `{ ok: true, data }` หรือ `{ ok: false, error: { code, message } }`

| วิธี | ที่อยู่ | body | ใช้ทำอะไร |
|---|---|---|---|
| GET | `/api/bot/me` | – | ชื่อ/รหัสบอท |
| GET | `/api/bot/rooms` | – | ห้องที่บอทอยู่ (+ ตำแหน่ง) |
| POST | `/api/bot/sendMessage` | `{ roomId, text }` | ส่งข้อความ |
| POST | `/api/bot/sendForm` | `{ roomId, formId, text? }` | ส่งการ์ดฟอร์ม |
| GET | `/api/bot/orders?status=new` | – | ออเดอร์ของฟอร์มที่ผูกกับบอทนี้ |
| POST | `/api/bot/orders/:id/status` | `{ status, note? }` | เปลี่ยนสถานะ (new / in_progress / done / cancelled) — ลูกค้าได้ข้อความแจ้งในห้อง |

error ที่พบบ่อย: `BAD_BOT_TOKEN` (token ผิด/ถูกสร้างใหม่) · `NOT_MEMBER` (บอทไม่ได้อยู่ในห้อง) · `NOT_CHANNEL_ADMIN` (ชาเนล: ต้องตั้งบอทเป็นแอดมินชาเนล) · `FORM_INACTIVE`
