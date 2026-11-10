// =====================================================================
// pwa.ts — ติดตั้งแอปลงหน้าจอโฮม + เปิดแจ้งเตือน (Web Push)
//
//   Android / คอมพิวเตอร์ (Chrome, Edge, Samsung) → ปุ่มติดตั้งกดครั้งเดียว (beforeinstallprompt)
//   iPhone / iPad → Apple ไม่เปิดให้เว็บติดตั้งเองได้ → แสดงวิธีทำ 2 ขั้น (แชร์ → เพิ่มไปยังหน้าจอโฮม)
//   เปิดจากในแอป LINE → ปุ่ม "เปิดในเบราว์เซอร์" (ใส่ ?openExternalBrowser=1 ตามเอกสาร LINE)
// =====================================================================

import { api } from './api';

// ---------- ตรวจชนิดเครื่อง/เบราว์เซอร์ ----------
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(ua);
export const inLineApp = /\bLine\//i.test(ua);
export const inOtherInApp = /FBAN|FBAV|FB_IAB|Instagram|TikTok|Messenger/i.test(ua);

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function deviceLabel(): string {
  const os = isIOS ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : isAndroid ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'คอมพิวเตอร์';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'เบราว์เซอร์';
  return `${os} · ${br}${isStandalone() ? ' (แอป)' : ''}`;
}

// ---------- เก็บ event ติดตั้งไว้ (ต้องดักตั้งแต่เปิดหน้า) ----------
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // ไม่ให้เบราว์เซอร์เด้งเอง — ใช้ปุ่มของเรา
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('ลงทะเบียน service worker ไม่สำเร็จ', err));
    // แตะแจ้งเตือนตอนแอปเปิดค้างแต่เปลี่ยนหน้าเองไม่ได้ → service worker ส่ง url มาให้
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data?.type === 'open' && typeof ev.data.url === 'string') location.href = ev.data.url;
    });
  }
}

export const onPwaChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const canOneClickInstall = () => deferred !== null;

/** กดปุ่มติดตั้ง (Android/คอม) → คืนผล */
export async function oneClickInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  deferred = null;
  emit();
  return outcome;
}

/** เปิดหน้านี้ใหม่ในเบราว์เซอร์จริง (ออกจากในแอป LINE) */
export function openInExternalBrowser() {
  const url = new URL(location.href);
  url.searchParams.set('openExternalBrowser', '1');
  location.href = url.toString();
}

// ---------- แจ้งเตือน ----------
export type PushState = 'unsupported' | 'need-install' | 'denied' | 'off' | 'on';

export async function getPushState(): Promise<PushState> {
  if (isIOS && !isStandalone()) return 'need-install'; // iPhone รับแจ้งเตือนได้เฉพาะตอนเปิดจากไอคอนหน้าจอโฮม
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** เปิดแจ้งเตือนบนเครื่องนี้ (ต้องเรียกจากการกดปุ่ม) — ไม่สำเร็จ throw พร้อมเหตุผลภาษาไทย */
export async function enablePush(): Promise<void> {
  const state = await getPushState();
  if (state === 'need-install') throw new Error('iPhone ต้องติดตั้งแอปลงหน้าจอโฮมก่อน แล้วเปิดจากไอคอน จึงจะเปิดแจ้งเตือนได้');
  if (state === 'unsupported') throw new Error('เบราว์เซอร์นี้ไม่รองรับแจ้งเตือน — ลองเปิดด้วย Chrome หรือ Safari');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'คุณกด "ไม่อนุญาต" ไว้ — เปิดสิทธิ์แจ้งเตือนของเว็บนี้ในการตั้งค่าเครื่อง/เบราว์เซอร์ แล้วกดใหม่'
      : 'ยังไม่ได้อนุญาตแจ้งเตือน');
  }
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>('/api/push/key');
  let sub: PushSubscription;
  try {
    sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  } catch (err) {
    console.error('subscribe ไม่สำเร็จ', err);
    throw new Error(`ลงทะเบียนรับแจ้งเตือนไม่สำเร็จ (${err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ'})`);
  }
  const json = sub.toJSON();
  await api.post('/api/push/subscribe', { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export async function currentEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}
