// =====================================================================
// worker/auth-google.ts — เข้าสู่ระบบด้วย Google (OpenID Connect · server flow)
//
//   /api/auth/google/start     → state + nonce เก็บใน cookie → พาไปหน้าเลือกบัญชี Google
//   /api/auth/google/link      → (ต้องล็อกอินอยู่) เหมือน start แต่โหมด "ผูกบัญชี"
//   /api/auth/google/callback  → ตรวจ state → แลก code เป็น id_token กับ Google (HTTPS + client secret)
//                                → ตรวจ iss / aud / exp / nonce / email_verified
//                                → login: หา/สร้างผู้ใช้จาก google_sub · link: ผูกกับผู้ใช้ที่ล็อกอินอยู่
//
// ผู้ใช้เลือก (2026-11-17): ผูกเองในหน้าบัญชี (ไม่จับคู่อีเมลอัตโนมัติ) · คนใหม่รออนุมัติเหมือน LINE
//   (มาจากลิงก์เชิญ = อนุมัติทันที) · ไม่จำกัดโดเมนอีเมล
// id_token ได้มาจาก Google ตรง ๆ ผ่าน HTTPS พร้อม client secret → ไม่ต้องตรวจลายเซ็นซ้ำ (ตามเอกสาร Google)
//   แต่ยังตรวจค่าข้างในทุกตัว
// =====================================================================

import { nowThai } from '../shared/time';
import { Env, newId, randomToken, readCookie, requireUser } from './lib';
import {
  backToApp, cleanInvite, clearStateCookie, finishLogin, linkResult, parseState, setStateCookie, type AuthMode,
} from './auth-common';

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const COOKIE = 'google_oauth';
const COOKIE_PATH = '/api/auth/google';
const CLEAR = clearStateCookie(COOKIE, COOKIE_PATH);

/** ตั้งค่าไม่ครบ → รหัส error (ไม่บังคับต้องมี: ไม่ตั้ง = เข้าด้วย Google ไม่ได้ แต่ LINE ใช้ได้ปกติ) */
export function googleConfigError(env: Env): string | null {
  if (!env.GOOGLE_CLIENT_ID) return 'NO_GOOGLE_CLIENT_ID';
  if (!env.GOOGLE_CLIENT_SECRET) return 'NO_GOOGLE_CLIENT_SECRET';
  if (!env.APP_URL) return 'NO_APP_URL';
  return null;
}

const callbackUrl = (env: Env) => `${env.APP_URL}/api/auth/google/callback`;

// ---------- เริ่ม (ล็อกอิน / ผูกบัญชี) ----------
export function googleStart(env: Env, mode: AuthMode, invite?: string | null): Response {
  const cfgErr = googleConfigError(env);
  if (cfgErr) return mode === 'link' ? linkResult(env, CLEAR, { error: cfgErr }) : backToApp(env, CLEAR, cfgErr);
  const s = { state: randomToken(16), nonce: randomToken(16), invite: mode === 'login' ? cleanInvite(invite) : '', mode };
  const url = new URL(GOOGLE_AUTHORIZE);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', callbackUrl(env));
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', s.state);
  url.searchParams.set('nonce', s.nonce);
  url.searchParams.set('prompt', 'select_account'); // ให้เลือกบัญชีทุกครั้ง (เครื่องที่มีหลายบัญชี Gmail)
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Set-Cookie': setStateCookie(COOKIE, COOKIE_PATH, s) } });
}

interface GoogleClaims {
  iss?: string; aud?: string; exp?: number; nonce?: string; sub?: string;
  email?: string; email_verified?: boolean | string; name?: string; picture?: string;
}

function decodeJwtPayload(jwt: string): GoogleClaims | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
    return JSON.parse(json) as GoogleClaims;
  } catch (err) {
    console.error('อ่าน id_token ของ Google ไม่ได้', err);
    return null;
  }
}

// ---------- Google ส่งกลับมา ----------
export async function googleCallback(req: Request, env: Env): Promise<Response> {
  const saved = parseState(readCookie(req, COOKIE));
  const mode: AuthMode = saved?.mode ?? 'login';
  const fail = (code: string) => (mode === 'link' ? linkResult(env, CLEAR, { error: code }) : backToApp(env, CLEAR, code));

  const cfgErr = googleConfigError(env);
  if (cfgErr) return fail(cfgErr);
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return fail('GOOGLE_DENIED'); // กดยกเลิกที่หน้า Google
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !saved) return fail('STATE_MISSING');
  if (state !== saved.state) return fail('STATE_MISMATCH');

  // ---------- แลก code → id_token ----------
  let idToken: string;
  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: callbackUrl(env),
        client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
      }),
    });
    if (!res.ok) {
      console.error('Google token ตอบผิดพลาด', res.status, await res.text());
      return fail('TOKEN_FAILED');
    }
    const data = (await res.json()) as { id_token?: string };
    if (!data.id_token) return fail('NO_ID_TOKEN');
    idToken = data.id_token;
  } catch (err) {
    console.error('เรียก Google token ไม่สำเร็จ', err);
    return fail('GOOGLE_UNREACHABLE');
  }

  // ---------- ตรวจค่าใน id_token ----------
  const c = decodeJwtPayload(idToken);
  if (!c || !c.sub) return fail('VERIFY_FAILED');
  if (!c.iss || !GOOGLE_ISSUERS.includes(c.iss) || c.aud !== env.GOOGLE_CLIENT_ID) return fail('VERIFY_FAILED');
  if (!c.exp || c.exp * 1000 < Date.now()) return fail('VERIFY_FAILED');
  if (c.nonce !== saved.nonce) return fail('STATE_MISMATCH');
  const emailVerified = c.email_verified === true || c.email_verified === 'true';
  if (!c.email || !emailVerified) return fail('GOOGLE_EMAIL_UNVERIFIED');
  const email = c.email.toLowerCase().slice(0, 200);

  if (mode === 'link') return linkGoogle(req, env, c.sub, email);

  // ---------- ล็อกอิน: หา/สร้างผู้ใช้ ----------
  const now = nowThai();
  let user: { id: string; status: 'pending' | 'active' | 'blocked' };
  let isNew = false;  // สมัครใหม่ → แจ้งแอดมิน (ใน finishLogin เพราะต้องรู้ผลลิงก์เชิญก่อน)
  try {
    const existing = await env.DB.prepare(`SELECT id, status, line_user_id FROM users WHERE google_sub = ? AND is_bot = 0`)
      .bind(c.sub).first<{ id: string; status: 'pending' | 'active' | 'blocked'; line_user_id: string }>();
    if (existing) {
      if (existing.status === 'blocked') return backToApp(env, CLEAR, 'BLOCKED');
      // ชื่อ/รูป: บัญชีที่มี LINE ด้วยใช้ของ LINE เป็นหลัก · สมัครด้วย Google อย่างเดียว → อัปเดตจาก Google
      // 0011 (BUGS-23): เก็บของ Google ไว้ใน oauth_* เสมอ · ทับค่าที่แสดงเฉพาะเมื่อผู้ใช้ไม่ได้ตั้งชื่อ/อัปรูปเอง
      if (existing.line_user_id.startsWith('google:')) {
        await env.DB.prepare(
          `UPDATE users SET oauth_name = ?1, oauth_picture = ?2,
                  display_name = CASE WHEN name_custom = 1 THEN display_name ELSE ?1 END,
                  picture_url = CASE WHEN picture_id IS NOT NULL THEN picture_url ELSE ?2 END,
                  email = ?3, updated_at = ?4
           WHERE id = ?5`,
        ).bind((c.name || email.split('@')[0]).slice(0, 80), c.picture ?? null, email, now, existing.id).run();
      } else {
        await env.DB.prepare(`UPDATE users SET email = ?, updated_at = ? WHERE id = ?`).bind(email, now, existing.id).run();
      }
      user = { id: existing.id, status: existing.status };
    } else {
      const id = newId();
      await env.DB.prepare(
        `INSERT INTO users (id, line_user_id, google_sub, email, display_name, picture_url, oauth_name, oauth_picture, status, role, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?6, 'pending', 'member', ?7, ?7)`,
      ).bind(id, `google:${c.sub}`, c.sub, email, (c.name || email.split('@')[0]).slice(0, 80), c.picture ?? null, now).run();
      user = { id, status: 'pending' };
      isNew = true;
    }
  } catch (err) {
    console.error('บันทึกผู้ใช้ Google ลง D1 ไม่สำเร็จ', err);
    return backToApp(env, CLEAR, 'DB_FAILED');
  }
  return finishLogin(env, CLEAR, user, saved.invite,
    isNew ? { name: (c.name || email.split('@')[0]).slice(0, 80), email } : undefined);
}

/** ผูก Google กับบัญชีที่ล็อกอินอยู่ — บัญชี Google นี้ผูกกับคนอื่นแล้ว → ไม่รวมบัญชีให้ แจ้งเหตุผล */
async function linkGoogle(req: Request, env: Env, sub: string, email: string): Promise<Response> {
  let me: { id: string };
  try {
    me = await requireUser(req, env, 'any');
  } catch (err) {
    console.error('ผูก Google: ไม่พบการล็อกอิน', err);
    return linkResult(env, CLEAR, { error: 'NOT_LOGGED_IN' });
  }
  try {
    const owner = await env.DB.prepare(`SELECT id FROM users WHERE google_sub = ?`).bind(sub).first<{ id: string }>();
    if (owner && owner.id !== me.id) return linkResult(env, CLEAR, { error: 'GOOGLE_IN_USE' });
    const r = await env.DB.prepare(`UPDATE users SET google_sub = ?, email = ?, updated_at = ? WHERE id = ?`)
      .bind(sub, email, nowThai(), me.id).run();
    if (r.meta.changes !== 1) return linkResult(env, CLEAR, { error: 'DB_FAILED' });
  } catch (err) {
    console.error('ผูก Google ลง D1 ไม่สำเร็จ', err);
    return linkResult(env, CLEAR, { error: 'DB_FAILED' });
  }
  return linkResult(env, CLEAR, { linked: 'google' });
}
