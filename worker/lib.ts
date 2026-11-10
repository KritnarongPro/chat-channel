// =====================================================================
// worker/lib.ts — ของใช้ร่วมของ worker
//
// สารบัญ
//   0. Env (binding + ค่าตั้ง)
//   1. รูปแบบตอบกลับ + error ภาษาไทย
//   2. รหัสสุ่ม / hash
//   3. Cookie + session
//   4. requireUser — helper เดียวสำหรับตรวจล็อกอิน/สิทธิ์ทุก endpoint
// =====================================================================

import { thaiAfter, nowThai } from '../shared/time';

// =====================================================================
// 0. Env
// =====================================================================
export interface Env {
  DB: D1Database;
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_URL: string;
  APP_NAME: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  SETUP_TOKEN?: string;
}

// =====================================================================
// 1. รูปแบบตอบกลับ:  สำเร็จ { ok: true, data }   ผิดพลาด { ok: false, error: { code, message } }
// =====================================================================
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function ok(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function fail(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** อ่าน JSON body — อ่านไม่ได้ → ApiError พร้อมเหตุผล */
export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'ข้อมูลที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง');
  }
}

/** รัน D1 — ล้มเหลว → ApiError (ไม่ข้ามเงียบ) */
export async function db<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`D1 ผิดพลาด: ${what}`, err);
    throw new ApiError(500, 'DB_FAILED', `บันทึก/อ่านฐานข้อมูลไม่สำเร็จ (${what})`);
  }
}

// =====================================================================
// 2. รหัสสุ่ม / hash
// =====================================================================
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// =====================================================================
// 3. Cookie + session
// =====================================================================
export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** สร้าง session ใหม่ → คืนค่า Set-Cookie */
export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken(32);
  await env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(await sha256(token), userId, nowThai(), thaiAfter(SESSION_DAYS * 86400_000)).run();
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearSessionCookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// =====================================================================
// 4. requireUser
// =====================================================================
export interface User {
  id: string;
  displayName: string;
  pictureUrl: string | null;
  status: 'pending' | 'active' | 'blocked';
  role: 'member' | 'admin';
}

type UserRow = { id: string; display_name: string; picture_url: string | null; status: User['status']; role: User['role'] };
export const userOut = (r: UserRow): User => ({
  id: r.id, displayName: r.display_name, pictureUrl: r.picture_url, status: r.status, role: r.role,
});

/** ระดับที่ต้องการ: any = ล็อกอินแล้ว (รออนุมัติก็ได้) · active = อนุมัติแล้ว · admin = แอดมิน */
export type Need = 'any' | 'active' | 'admin';

export async function requireUser(req: Request, env: Env, need: Need): Promise<User> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) throw new ApiError(401, 'NOT_LOGGED_IN', 'กรุณาเข้าสู่ระบบด้วย LINE');
  const tokenHash = await sha256(token);
  const row = await db('ตรวจ session', () =>
    env.DB.prepare(
      `SELECT u.id, u.display_name, u.picture_url, u.status, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    ).bind(tokenHash, nowThai()).first<UserRow>(),
  );
  if (!row) throw new ApiError(401, 'SESSION_EXPIRED', 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const user = userOut(row);
  if (user.status === 'blocked') throw new ApiError(403, 'BLOCKED', 'บัญชีนี้ถูกระงับการใช้งาน');
  if (need !== 'any' && user.status !== 'active') {
    throw new ApiError(403, 'PENDING', 'บัญชีรอแอดมินอนุมัติก่อนใช้งาน');
  }
  if (need === 'admin' && user.role !== 'admin') throw new ApiError(403, 'NOT_ADMIN', 'ต้องเป็นแอดมินเท่านั้น');
  return user;
}
