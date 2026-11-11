// =====================================================================
// sw.js — Service Worker ของแอปแชท
//   - ทำให้ "ติดตั้งแอป" ได้ (Chrome ต้องมี service worker ที่จัดการ fetch)
//   - รับแจ้งเตือน (push) แล้วแสดงบนมือถือ · แตะแจ้งเตือน → เปิดห้องแชทนั้น
//   - ไม่เก็บ cache ของ API/ข้อความ (ข้อมูลสดเสมอ) · เน็ตหลุดตอนเปิดหน้า → แสดงหน้า "ออฟไลน์"
// =====================================================================

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ออฟไลน์</title><body style="font-family:sans-serif;text-align:center;padding:40px">
<h2>ไม่มีอินเทอร์เน็ต</h2><p>เชื่อมต่อเน็ตแล้วกดลองใหม่</p><button onclick="location.reload()">ลองใหม่</button></body></html>`;

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // อย่างอื่นปล่อยให้เบราว์เซอร์จัดการตามปกติ
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })),
  );
});

// ---------- รวมแจ้งเตือนต่อห้อง: นับข้อความที่ยังไม่ได้แตะของแต่ละห้อง (หน่วยความจำของ service worker) ----------
// ⚠️ iPhone/Safari: ต้องเรียก showNotification ทันทีทุกครั้งที่ได้ push ห้าม await อะไรก่อน ไม่งั้นโดนถอนสิทธิ์ (BUGS-11)
const pendingCount = new Map();

self.addEventListener('push', (event) => {
  let data = { title: 'แชทส่วนตัว', body: 'มีข้อความใหม่', url: '/', tag: 'chat' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (err) {
    console.error('อ่านข้อมูลแจ้งเตือนไม่ได้', err);
  }
  const n = (pendingCount.get(data.tag) || 0) + 1;
  pendingCount.set(data.tag, n);
  const body = n > 1 ? `${n} ข้อความใหม่ · ล่าสุด: ${data.body}` : data.body;
  const show = self.registration.showNotification(data.title, {
    body,
    tag: data.tag,
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url, tag: data.tag },
  });
  // ตัวเลขยังไม่อ่านบนไอคอนแอป (รองรับเฉพาะบางเครื่อง — ไม่รองรับก็ข้าม)
  const badge = typeof data.badge === 'number' && self.navigator.setAppBadge
    ? self.navigator.setAppBadge(data.badge).catch((err) => console.error('ตั้งตัวเลขบนไอคอนไม่ได้', err))
    : Promise.resolve();
  event.waitUntil(Promise.all([show, badge]));
});

// หน้าเว็บเปิดห้องแล้ว → ล้างตัวนับ + ปิดแจ้งเตือนของห้องนั้น
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'room-opened' && typeof msg.tag === 'string') {
    pendingCount.delete(msg.tag);
    event.waitUntil(
      self.registration.getNotifications({ tag: msg.tag }).then((list) => list.forEach((x) => x.close())),
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data && event.notification.data.tag) pendingCount.delete(event.notification.data.tag);
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        try {
          await client.navigate(url);
        } catch (err) {
          client.postMessage({ type: 'open', url });
        }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
