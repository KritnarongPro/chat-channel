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
}

export interface RoomMember { id: string; displayName: string; pictureUrl: string | null; role: string }

export type { ChatMessage };

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
