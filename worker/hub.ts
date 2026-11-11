// =====================================================================
// worker/hub.ts — UserHub: 1 ผู้ใช้ = 1 Durable Object ถือ WebSocket ของแอปที่เปิดอยู่ (ทุกเครื่องของคนนั้น)
//   - แอปเปิดอยู่บนจอ (visible) → ส่ง "activity" ให้แอปเด้งแบนเนอร์ในแอปเอง แล้ว **ไม่ส่ง** แจ้งเตือนมือถือซ้ำ
//     (ต้องตัดสินใจฝั่งเซิร์ฟเวอร์ เพราะ iPhone/Safari บังคับให้ service worker แสดงแจ้งเตือนทุกครั้งที่ได้ push)
//   - ปิดแอป/อยู่เบื้องหลัง → ตอบ visible = false → worker ส่งแจ้งเตือนมือถือตามปกติ
// เรียกจาก worker เท่านั้น: /ws (หลังตรวจล็อกอิน) และ /deliver (จาก Queue consumer)
// =====================================================================

import { DurableObject } from 'cloudflare:workers';
import type { ActivityFrame } from '../shared/protocol';
import type { Env } from './lib';

interface HubSocket { visible: boolean }

export class UserHub extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('ต้องเชื่อมต่อแบบ WebSocket', { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ visible: true } satisfies HubSocket);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === '/deliver' && req.method === 'POST') {
      let frame: ActivityFrame;
      try {
        frame = (await req.json()) as ActivityFrame;
      } catch {
        return Response.json({ ok: false, error: { code: 'BAD_JSON', message: 'ข้อมูลไม่ใช่ JSON' } }, { status: 400 });
      }
      let visible = false;
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as HubSocket | null;
        if (a?.visible) visible = true;
        try {
          ws.send(JSON.stringify(frame));
        } catch (err) {
          console.error('ส่ง activity ให้แอปไม่สำเร็จ (socket อาจปิดแล้ว)', err);
        }
      }
      return Response.json({ ok: true, data: { visible } });
    }

    return new Response('ไม่พบเส้นทาง', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return;
    let f: { type?: string; visible?: unknown };
    try {
      f = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'BAD_JSON', message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' }));
      return;
    }
    if (f.type === 'presence-app') ws.serializeAttachment({ visible: f.visible === true } satisfies HubSocket);
    else if (f.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch (err) {
      console.log('hub socket ปิดไปแล้ว', err);
    }
  }
}
