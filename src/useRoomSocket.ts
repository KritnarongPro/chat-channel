// =====================================================================
// useRoomSocket.ts — การเชื่อมต่อเรียลไทม์กับห้องแชท 1 ห้อง
//
//   - เชื่อมต่อ WebSocket → ขอข้อความที่พลาดไป (sync) ทุกครั้งที่ต่อได้
//   - เน็ตหลุด → ต่อใหม่เองแบบรอนานขึ้นเรื่อย ๆ (1, 2, 4 … สูงสุด 15 วินาที)
//   - ต่อไม่ได้ 3 ครั้งติด → ถามเซิร์ฟเวอร์ว่าเพราะอะไร (หมดอายุล็อกอิน / ไม่ใช่สมาชิก ฯลฯ) แล้วแจ้งผู้ใช้
//   - ข้อความที่ส่ง: กำลังส่ง → ส่งแล้ว · ไม่ได้รับยืนยันใน 10 วินาที หรือเซิร์ฟเวอร์ตอบ error → "ส่งไม่สำเร็จ + เหตุผล" กดส่งใหม่ได้
//     ส่งใหม่ใช้รหัสเดิม เซิร์ฟเวอร์จึงไม่บันทึกซ้ำ
//   - ไฟล์ (เฟส 2): กำลังอัป (%) → กำลังส่ง → ส่งแล้ว · อัปไม่สำเร็จ → "ส่งไม่สำเร็จ + เหตุผล" กดส่งใหม่ = อัปใหม่
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientFrame, FileKind, MessageExtra, ServerFrame } from '../shared/protocol';
import { MAX_BYTES, MAX_MESSAGE_CHARS } from '../shared/protocol';
import { api, errMsg, uploadFile } from './api';
import { formatSize } from './media';

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'failed';

export interface OutgoingFile {
  kind: FileKind;
  blob: Blob;
  name: string;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface PendingMessage {
  clientId: string;
  kind: 'text' | FileKind | 'form';
  body: string;
  extra?: MessageExtra;   // เฟส 4: การ์ดฟอร์ม { formId }
  status: 'uploading' | 'sending' | 'failed';
  reason?: string;
  progress?: number;
  file?: OutgoingFile;
  fileId?: string;
  previewUrl?: string; // รูปที่กำลังส่ง แสดงจากเครื่องตัวเองไปก่อน
}

const ACK_TIMEOUT_MS = 10_000;
const PING_MS = 25_000;

function makeClientId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function useRoomSocket(roomId: string, onNotice: (kind: 'error' | 'warning', text: string) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [connError, setConnError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const initialSyncRef = useRef(true);
  const failsRef = useRef(0);
  const timersRef = useRef(new Map<string, number>());
  const pendingRef = useRef<PendingMessage[]>([]);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  pendingRef.current = pending;

  // ---------- รวมข้อความใหม่เข้ากับของเดิม (กันซ้ำด้วย seq) ----------
  const merge = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.seq, m]));
      for (const m of incoming) map.set(m.seq, m);
      const out = [...map.values()].sort((a, b) => a.seq - b.seq);
      lastSeqRef.current = out.length ? out[out.length - 1].seq : 0;
      return out;
    });
    const ids = new Set(incoming.map((m) => m.id));
    setPending((ps) => ps.filter((p) => {
      if (!ids.has(p.clientId)) return true;
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return false;
    }));
    for (const id of ids) {
      const t = timersRef.current.get(id);
      if (t) { clearTimeout(t); timersRef.current.delete(id); }
    }
  }, []);

  const markFailed = useCallback((clientId: string, reason: string) => {
    const t = timersRef.current.get(clientId);
    if (t) { clearTimeout(t); timersRef.current.delete(clientId); }
    setPending((ps) => ps.map((p) => (p.clientId === clientId ? { ...p, status: 'failed', reason } : p)));
  }, []);

  const rawSend = useCallback((frame: ClientFrame): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(frame));
    return true;
  }, []);

  const transmit = useCallback((p: PendingMessage) => {
    if (!rawSend({ type: 'send', clientId: p.clientId, body: p.body, kind: p.kind, fileId: p.fileId, extra: p.extra })) {
      markFailed(p.clientId, 'ยังไม่ได้เชื่อมต่อกับห้อง (เน็ตหลุด?) — กดส่งใหม่เมื่อเชื่อมต่อแล้ว');
      return;
    }
    const t = window.setTimeout(
      () => markFailed(p.clientId, 'ไม่ได้รับการยืนยันจากเซิร์ฟเวอร์ภายใน 10 วินาที — กดส่งใหม่ได้ (ไม่ส่งซ้ำ)'),
      ACK_TIMEOUT_MS,
    );
    timersRef.current.set(p.clientId, t);
  }, [rawSend, markFailed]);

  // ---------- เชื่อมต่อ + ต่อใหม่อัตโนมัติ ----------
  useEffect(() => {
    let stopped = false;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    lastSeqRef.current = 0;
    failsRef.current = 0;
    setMessages([]);
    setPending([]);
    setConn('connecting');
    setConnError(null);

    const diagnose = async () => {
      try {
        await api.get(`/api/rooms/${roomId}`);
        setConnError('ต่อห้องแชทไม่ได้ กำลังลองใหม่…');
      } catch (e) {
        setConnError(errMsg(e));
        setConn('failed');
        stopped = true; // สาเหตุถาวร (เช่น ไม่ใช่สมาชิก / ล็อกอินหมดอายุ) ไม่ต้องลองต่อ
      }
    };

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${encodeURIComponent(roomId)}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        failsRef.current = 0;
        setConn('open');
        setConnError(null);
        // บอกห้องว่าหน้าจอเปิดอยู่ไหม (เปิดอยู่ = ไม่ต้องส่งแจ้งเตือนให้เรา)
        ws.send(JSON.stringify({ type: 'presence', visible: document.visibilityState === 'visible' } satisfies ClientFrame));
        initialSyncRef.current = lastSeqRef.current === 0;
        ws.send(JSON.stringify({ type: 'sync', afterSeq: lastSeqRef.current } satisfies ClientFrame));
        // ข้อความที่ค้าง "กำลังส่ง" ตอนเน็ตหลุด → ส่งอีกรอบ (รหัสเดิม ไม่ซ้ำ)
        for (const p of pendingRef.current) if (p.status === 'sending' && (p.kind === 'text' || p.kind === 'form' || p.fileId)) transmit(p);
        pingTimer = window.setInterval(() => rawSend({ type: 'ping' }), PING_MS);
      };

      ws.onmessage = (ev) => {
        let f: ServerFrame;
        try {
          f = JSON.parse(String(ev.data)) as ServerFrame;
        } catch {
          noticeRef.current('warning', 'ได้รับข้อมูลจากเซิร์ฟเวอร์ที่อ่านไม่ได้');
          return;
        }
        switch (f.type) {
          case 'message': merge([f.message]); break;
          case 'sync':
            if (initialSyncRef.current) {
              // เปิดห้องครั้งแรก: hasMore = ยังมีข้อความเก่ากว่านี้ให้เลื่อนขึ้นดู
              initialSyncRef.current = false;
              setHasMore(f.hasMore);
              merge(f.messages);
            } else {
              // ต่อใหม่หลังเน็ตหลุด: hasMore = ข้อความที่พลาดยังมาไม่ครบ → ขอชุดต่อไป
              merge(f.messages);
              if (f.hasMore && f.messages.length) {
                rawSend({ type: 'sync', afterSeq: f.messages[f.messages.length - 1].seq });
              }
            }
            break;
          case 'ack': break; // รอข้อความจริงที่ห้องกระจายมา แล้ว merge จะลบออกจากรายการค้างเอง
          case 'error':
            if (f.clientId) markFailed(f.clientId, f.message);
            else noticeRef.current('error', f.message);
            break;
          case 'warning': noticeRef.current('warning', f.message); break;
          case 'pong': break;
        }
      };

      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        failsRef.current += 1;
        setConn('reconnecting');
        if (failsRef.current === 3) void diagnose();
        const wait = Math.min(15_000, 1000 * 2 ** Math.min(failsRef.current - 1, 4));
        retryTimer = window.setTimeout(connect, wait);
      };
    };

    const onVisibility = () => rawSend({ type: 'presence', visible: document.visibilityState === 'visible' });
    document.addEventListener('visibilitychange', onVisibility);

    connect();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
      for (const p of pendingRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      wsRef.current?.close(1000, 'leave');
      wsRef.current = null;
    };
  }, [roomId, merge, markFailed, rawSend, transmit]);

  // ---------- ส่งข้อความ ----------
  const send = useCallback((body: string): string | null => {
    const text = body.trim();
    if (!text) return 'พิมพ์ข้อความก่อนส่ง';
    if (text.length > MAX_MESSAGE_CHARS) return `ข้อความยาวเกิน ${MAX_MESSAGE_CHARS} ตัวอักษร`;
    const p: PendingMessage = { clientId: makeClientId(), kind: 'text', body: text, status: 'sending' };
    setPending((ps) => [...ps, p]);
    transmit(p);
    return null;
  }, [transmit]);

  // ---------- ส่งไฟล์: อัปโหลด → ได้ fileId → ส่งข้อความผ่านห้อง ----------
  const upload = useCallback(async (p: PendingMessage) => {
    const f = p.file!;
    const update = (patch: Partial<PendingMessage>) =>
      setPending((ps) => ps.map((x) => (x.clientId === p.clientId ? { ...x, ...patch } : x)));
    update({ status: 'uploading', progress: 0, reason: undefined });
    try {
      const { fileId } = await uploadFile(
        roomId, f.blob,
        { kind: f.kind, name: f.name, mime: f.mime, width: f.width, height: f.height, durationMs: f.durationMs },
        (progress) => update({ progress }),
      );
      const ready: PendingMessage = { ...p, fileId, status: 'sending', progress: 100, reason: undefined };
      update(ready);
      transmit(ready);
    } catch (e) {
      update({ status: 'failed', reason: `อัปโหลดไม่สำเร็จ: ${errMsg(e)}` });
    }
  }, [roomId, transmit]);

  const sendFile = useCallback((file: OutgoingFile, caption = ''): string | null => {
    if (file.blob.size === 0) return 'ไฟล์ว่าง ส่งไม่ได้';
    if (file.blob.size > MAX_BYTES[file.kind]) {
      return `ไฟล์ใหญ่เกิน ${formatSize(MAX_BYTES[file.kind])} (ไฟล์นี้ ${formatSize(file.blob.size)})`;
    }
    if (caption.length > MAX_MESSAGE_CHARS) return `คำบรรยายยาวเกิน ${MAX_MESSAGE_CHARS} ตัวอักษร`;
    const p: PendingMessage = {
      clientId: makeClientId(), kind: file.kind, body: caption.trim(), status: 'uploading', progress: 0, file,
      previewUrl: file.kind === 'image' ? URL.createObjectURL(file.blob) : undefined,
    };
    setPending((ps) => [...ps, p]);
    void upload(p);
    return null;
  }, [upload]);

  // ---------- การ์ดฟอร์ม (แอดมินระบบเท่านั้น — ห้องตรวจสิทธิ์ซ้ำ) ----------
  const sendForm = useCallback((formId: string, formTitle: string, caption = '') => {
    const p: PendingMessage = {
      clientId: makeClientId(), kind: 'form', body: caption.trim(), status: 'sending', extra: { formId, formTitle },
    };
    setPending((ps) => [...ps, p]);
    transmit(p);
  }, [transmit]);

  const retry = useCallback((clientId: string) => {
    const p = pendingRef.current.find((x) => x.clientId === clientId);
    if (!p) return;
    // ไฟล์ที่ยังอัปไม่ผ่าน → อัปใหม่ · อัปแล้ว/ข้อความ → ส่งผ่านห้องอีกรอบ (รหัสเดิม ไม่ซ้ำ)
    if (p.kind !== 'text' && p.kind !== 'form' && !p.fileId) { void upload(p); return; }
    const again = { ...p, status: 'sending' as const, reason: undefined };
    setPending((ps) => ps.map((x) => (x.clientId === clientId ? again : x)));
    transmit(again);
  }, [transmit, upload]);

  const discard = useCallback((clientId: string) => {
    setPending((ps) => ps.filter((x) => {
      if (x.clientId !== clientId) return true;
      if (x.previewUrl) URL.revokeObjectURL(x.previewUrl);
      return false;
    }));
  }, []);

  // ---------- บอกห้องว่าอ่านถึงไหนแล้ว ----------
  const markRead = useCallback((seq: number) => {
    if (seq > 0) rawSend({ type: 'read', seq });
  }, [rawSend]);

  // ---------- โหลดข้อความเก่า ----------
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore) return;
    const first = messages[0]?.seq;
    if (!first) return;
    setLoadingOlder(true);
    try {
      const data = await api.get<{ messages: ChatMessage[]; hasMore: boolean }>(
        `/api/rooms/${encodeURIComponent(roomId)}/messages?before=${first}`,
      );
      merge(data.messages);
      setHasMore(data.hasMore);
    } catch (e) {
      noticeRef.current('error', `โหลดข้อความเก่าไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setLoadingOlder(false);
    }
  }, [roomId, messages, hasMore, loadingOlder, merge]);

  return { messages, pending, conn, connError, hasMore, loadingOlder, send, sendFile, sendForm, retry, discard, markRead, loadOlder };
}
