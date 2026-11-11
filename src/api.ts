// =====================================================================
// api.ts — ตัวเรียก API กลาง + ชนิดข้อมูลที่ตรงกับ worker
// ทุก error จาก server ถูกโยนเป็น ApiError พร้อมข้อความไทย ให้หน้าเว็บแสดงผู้ใช้
// =====================================================================

import type { ChatMessage } from '../shared/protocol';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'NETWORK', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต');
  }
  let json: { ok: boolean; data?: T; error?: { code: string; message: string } };
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', `เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP ${res.status})`);
  }
  if (!res.ok || !json.ok) {
    const e = json.error ?? { code: 'UNKNOWN', message: `เกิดข้อผิดพลาด (HTTP ${res.status})` };
    throw new ApiError(res.status, e.code, e.message);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
};

/**
 * อัปโหลดไฟล์ดิบเข้าห้อง (ใช้ XHR เพื่อดูความคืบหน้า) → คืน fileId
 * ไม่สำเร็จ → ApiError พร้อมเหตุผลภาษาไทย
 */
export function uploadFile(
  roomId: string,
  blob: Blob,
  meta: { kind: 'image' | 'file' | 'voice'; name: string; mime: string; width?: number; height?: number; durationMs?: number },
  onProgress: (pct: number) => void,
): Promise<{ fileId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/rooms/${encodeURIComponent(roomId)}/files`);
    xhr.setRequestHeader('Content-Type', meta.mime || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Kind', meta.kind);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(meta.name));
    if (meta.width) xhr.setRequestHeader('X-Width', String(Math.round(meta.width)));
    if (meta.height) xhr.setRequestHeader('X-Height', String(Math.round(meta.height)));
    if (meta.durationMs) xhr.setRequestHeader('X-Duration-Ms', String(Math.round(meta.durationMs)));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'อัปโหลดไม่สำเร็จ — เน็ตหลุดระหว่างอัป'));
    xhr.ontimeout = () => reject(new ApiError(0, 'TIMEOUT', 'อัปโหลดนานเกินไป — ลองใหม่เมื่อเน็ตดีขึ้น'));
    xhr.onload = () => {
      let json: { ok: boolean; data?: { fileId: string }; error?: { code: string; message: string } };
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        reject(new ApiError(xhr.status, 'BAD_RESPONSE', `เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP ${xhr.status})`));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.ok && json.data) resolve(json.data);
      else reject(new ApiError(xhr.status, json.error?.code ?? 'UNKNOWN', json.error?.message ?? `อัปโหลดไม่สำเร็จ (HTTP ${xhr.status})`));
    };
    xhr.timeout = 10 * 60_000;
    xhr.send(blob);
  });
}

export const errMsg = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';

// ---------------------------------------------------------------------
// ชนิดข้อมูลจาก API
// ---------------------------------------------------------------------
export interface User {
  id: string;
  displayName: string;
  pictureUrl: string | null;
  status: 'pending' | 'active' | 'blocked';
  role: 'member' | 'admin';
  isBot: boolean;   // เฟส 4
}

export interface Me { user: User; appName: string; hasAdmin: boolean }

export interface Room {
  id: string;
  type: 'dm' | 'group' | 'channel';
  title: string;
  picture: string | null;
  lastSeq: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastSenderName: string | null;
  createdAt: string;
  unread: number;
  myRole: string;
  muted: boolean;                              // เฟส 3: ปิดแจ้งเตือนห้องนี้ (คิดจาก mutedUntil แล้ว)
  mutedUntil: string | null;                   // แจ้งเตือน: ปิดเสียงถึงเวลาไหน (null = ตลอด / ไม่ได้ปิด)
  pinned: { seq: number; text: string; sender: string | null; at: string } | null;  // ข้อความที่ปักหมุด
  visibility: 'public' | 'private' | null;     // เฟส 3: ชาเนลสาธารณะ/ส่วนตัว
  description: string | null;
  canPost: boolean;                            // ชาเนล: เฉพาะเจ้าของ/แอดมินชาเนล
}

export interface RoomMember { id: string; displayName: string; pictureUrl: string | null; role: string }

export type { ChatMessage };

/** ตั้งค่าแจ้งเตือนรวม (ทุกค่าเริ่มต้น = เปิด) */
export interface NotifySettings { dm: boolean; groups: boolean; channels: boolean; show_preview: boolean; mentions_when_muted: boolean }


// ---------- เฟส 4: บอท / ฟอร์ม / ออเดอร์ ----------
export interface Bot {
  id: string; name: string; tokenHint: string; webhookUrl: string | null; webhookSecret: string; enabled: boolean;
  createdAt: string; lastDeliveryAt: string | null; lastError: string | null; lastErrorAt: string | null; failCount: number;
  notifyScope: 'contacted' | 'all';   // แจ้งเตือนตรง: เฉพาะคนที่เคยคุยกับบอท / ทุกคนในระบบ
}
export interface FormInfo {
  id: string; title: string; description: string | null; fields: import('../shared/forms').FormField[];
  botId: string | null; active: boolean; createdAt: string; updatedAt: string;
}
export interface Order {
  id: number; formId: string; formTitle: string; roomId: string; roomTitle: string | null; userId: string; userName: string;
  status: import('../shared/forms').OrderStatus; statusText: string; statusNote: string | null;
  items: { id: string; label: string; value: string | number | null }[]; createdAt: string; updatedAt: string;
}

// ---------------------------------------------------------------------
// ข้อความ error ตอนล็อกอิน (worker ส่งกลับมาเป็น ?login_error=รหัส)
// ---------------------------------------------------------------------
export const LOGIN_ERRORS: Record<string, string> = {
  NO_LINE_CHANNEL_ID: 'ระบบยังไม่ได้ตั้งค่า LINE_CHANNEL_ID (แจ้งผู้ดูแล)',
  NO_LINE_CHANNEL_SECRET: 'ระบบยังไม่ได้ตั้งค่า LINE_CHANNEL_SECRET (แจ้งผู้ดูแล)',
  NO_APP_URL: 'ระบบยังไม่ได้ตั้งค่า APP_URL (แจ้งผู้ดูแล)',
  LINE_DENIED: 'คุณยกเลิกการเข้าสู่ระบบที่หน้า LINE',
  STATE_MISSING: 'ข้อมูลการเข้าสู่ระบบหายหรือหมดเวลา (เกิน 10 นาที) กรุณาลองใหม่',
  STATE_MISMATCH: 'ข้อมูลการเข้าสู่ระบบไม่ตรงกัน กรุณาลองใหม่',
  TOKEN_FAILED: 'LINE ไม่ยอมรับการเข้าสู่ระบบ (ตรวจ Channel secret / Callback URL)',
  NO_ID_TOKEN: 'LINE ไม่ได้ส่งข้อมูลผู้ใช้กลับมา (ตรวจว่าเปิด scope openid)',
  VERIFY_FAILED: 'ตรวจสอบข้อมูลจาก LINE ไม่ผ่าน กรุณาลองใหม่',
  LINE_UNREACHABLE: 'ติดต่อ LINE ไม่ได้ชั่วคราว กรุณาลองใหม่',
  BLOCKED: 'บัญชีนี้ถูกระงับการใช้งาน',
  DB_FAILED: 'บันทึกข้อมูลผู้ใช้ไม่สำเร็จ กรุณาลองใหม่',
  SESSION_FAILED: 'สร้างการเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่',
};
