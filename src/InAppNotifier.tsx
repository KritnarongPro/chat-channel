// =====================================================================
// InAppNotifier.tsx — แจ้งเตือนในแอป (ข้อ ง) + ตัวเลขบนไอคอนแอป (ข้อ จ)
//
//   - เปิดแอปอยู่ → ต่อ WebSocket กับ UserHub ของตัวเอง (/api/me/ws)
//   - บอกเซิร์ฟเวอร์ว่าแอปอยู่บนจอไหม (presence-app) → เซิร์ฟเวอร์เลือกเองว่าจะเด้งในแอปหรือส่ง push
//   - ได้ activity ที่ notify = true และไม่ใช่ห้องที่เปิดอยู่ → แบนเนอร์ด้านบน แตะเพื่อไปที่ห้อง
//   - ทุก activity → อัปเดตตัวเลขบนไอคอน + บอกหน้ารายการแชทให้โหลดใหม่ (event 'chat-activity')
//   - หลุด → ต่อใหม่เอง (1, 2, 4 … สูงสุด 30 วินาที) · หลุด 3 ครั้งติด → แจ้งผู้ใช้ 1 ครั้ง (ไม่เงียบ)
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ActivityFrame, ServerFrame } from '../shared/protocol';
import { useNotify } from './notice';

const PING_MS = 25_000;
const BANNER_MS = 5_000;

/** ตัวเลขบนไอคอนแอป (รองรับเฉพาะบางเครื่อง เช่น Android/Chrome, iPhone ที่ติดตั้งแอป) */
export function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) void nav.setAppBadge?.(n).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  } catch { /* เครื่องไม่รองรับ — ไม่ใช่ error ที่ผู้ใช้ต้องรู้ */ }
}

export default function InAppNotifier() {
  const notify = useNotify();
  const nav = useNavigate();
  const location = useLocation();
  const [banner, setBanner] = useState<ActivityFrame | null>(null);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let fails = 0;
    let warned = false;
    let retry: number | undefined;
    let ping: number | undefined;
    let hide: number | undefined;

    const sendVisible = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'presence-app', visible: document.visibilityState === 'visible' }));
      }
    };

    const connect = () => {
      if (stopped) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sock = new WebSocket(`${proto}//${window.location.host}/api/me/ws`);
      ws = sock;
      sock.onopen = () => {
        fails = 0;
        if (warned) { warned = false; notifyRef.current('success', 'แจ้งเตือนในแอปกลับมาทำงานแล้ว'); }
        sendVisible();
        ping = window.setInterval(() => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ type: 'ping' })), PING_MS);
      };
      sock.onmessage = (ev) => {
        let f: ServerFrame;
        try { f = JSON.parse(String(ev.data)) as ServerFrame; } catch { return; }
        if (f.type !== 'activity') return;
        setBadge(f.unread);
        window.dispatchEvent(new CustomEvent('chat-activity', { detail: f }));
        if (!f.notify || pathRef.current === `/room/${f.roomId}`) return;
        setBanner(f);
        if (hide) clearTimeout(hide);
        hide = window.setTimeout(() => setBanner(null), BANNER_MS);
      };
      sock.onclose = () => {
        if (ping) clearInterval(ping);
        if (ws === sock) ws = null;
        if (stopped) return;
        fails += 1;
        if (fails === 3 && !warned) {
          warned = true;
          notifyRef.current('warning', 'เชื่อมต่อแจ้งเตือนในแอปไม่ได้ (เน็ตหลุด?) — กำลังลองใหม่ ระหว่างนี้แจ้งเตือนจะมาทางมือถือแทน');
        }
        retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(fails - 1, 5)));
      };
    };

    document.addEventListener('visibilitychange', sendVisible);
    connect();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', sendVisible);
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      if (hide) clearTimeout(hide);
      ws?.close(1000, 'leave');
    };
  }, []);

  if (!banner) return null;
  return (
    <button
      className="inapp-banner"
      onClick={() => { setBanner(null); nav(`/room/${banner.roomId}`); }}
      aria-label={`ข้อความใหม่จาก ${banner.title} แตะเพื่อเปิด`}
    >
      <b>{banner.title}</b>
      <span>{banner.body}</span>
    </button>
  );
}
