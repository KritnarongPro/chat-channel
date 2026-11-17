// =====================================================================
// worker/auth-line.ts — ล็อกอินด้วย LINE Login (OAuth 2.1 / OpenID Connect)
//
//   /api/auth/line/start     → สร้าง state + nonce เก็บใน cookie แล้วพาไปหน้า LINE
//   /api/auth/line/callback  → ตรวจ state → แลก code เป็น id_token → ให้ LINE ตรวจ id_token (+nonce)
//                              → สร้าง/อัปเดตผู้ใช้ → สร้าง session cookie → กลับหน้าแรก
//   ล็อกอินผ่านลิงก์เชิญ (?invite=รหัส): หลังล็อกอินใช้ลิงก์ทันที → อนุมัติ + เข้าห้อง → พาไปห้องนั้น
//                                       ลิงก์ใช้ไม่ได้ → พาไปหน้า /join/<รหัส>?error=รหัส (บอกเหตุผล)
//   /api/auth/line/link      → (ต้องล็อกอินอยู่) โหมดผูก LINE ให้บัญชีที่สมัครด้วย Google
//   ส่วนที่ใช้ร่วมกับ Google (state cookie, จบการล็อกอิน, ลิงก์เชิญ) อยู่ใน auth-common.ts
// ล้มเหลวทุกจุด → พากลับหน้าแรกพร้อม ?login_error=รหัส (หน้าเว็บแสดงเหตุผลภาษาไทย)
// =====================================================================

import { nowThai } from '../shared/time';
import { Env, newId, randomToken, readCookie, requireUser } from './lib';
import {
  backToApp as back, cleanInvite, clearStateCookie, finishLogin, linkResult, parseState, setStateCookie, type AuthMode,
} from './auth-common';

const LINE_AUTHORIZE = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY = 'https://api.line.me/oauth2/v2.1/verify';
const STATE_COOKIE = 'line_oauth';
const COOKIE_PATH = '/api/auth/line';
const CLEAR = clearStateCookie(STATE_COOKIE, COOKIE_PATH);

function callbackUrl(env: Env) {
  return `${env.APP_URL}/api/auth/line/callback`;
}

/** กลับหน้าแรก (ลบ cookie state ทุกครั้งที่จบขั้นตอน) */
const backToApp = (env: Env, error?: string) => back(env, CLEAR, error);

/** ตรวจว่าตั้งค่า LINE ครบ — ไม่ครบคืนรหัส error */
export function lineConfigError(env: Env): string | null {
  if (!env.LINE_CHANNEL_ID) return 'NO_LINE_CHANNEL_ID';
  if (!env.LINE_CHANNEL_SECRET) return 'NO_LINE_CHANNEL_SECRET';
  if (!env.APP_URL) return 'NO_APP_URL';
  return null;
}

// ---------- เริ่มล็อกอิน ----------
export function lineStart(env: Env, invite?: string | null, mode: AuthMode = 'login'): Response {
  const cfgErr = lineConfigError(env);
  if (cfgErr) return mode === 'link' ? linkResult(env, CLEAR, { error: cfgErr }) : backToApp(env, cfgErr);
  const inviteCode = mode === 'login' ? cleanInvite(invite) : '';

  const state = randomToken(16);
  const nonce = randomToken(16);
  const url = new URL(LINE_AUTHORIZE);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.LINE_CHANNEL_ID!);
  url.searchParams.set('redirect_uri', callbackUrl(env));
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'profile openid');
  url.searchParams.set('nonce', nonce);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': setStateCookie(STATE_COOKIE, COOKIE_PATH, { state, nonce, invite: inviteCode, mode }),
    },
  });
}

// ---------- LINE ส่งกลับมา ----------
export async function lineCallback(req: Request, env: Env): Promise<Response> {
  const cfgErr = lineConfigError(env);
  if (cfgErr) return backToApp(env, cfgErr);

  const url = new URL(req.url);
  const saved = parseState(readCookie(req, STATE_COOKIE));
  const linking = saved?.mode === 'link';
  if (url.searchParams.get('error')) return linking ? linkResult(env, CLEAR, { error: 'LINE_DENIED' }) : backToApp(env, 'LINE_DENIED'); // ผู้ใช้กดยกเลิกที่หน้า LINE

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !saved) return backToApp(env, 'STATE_MISSING');
  const { nonce, invite: inviteCode } = saved;
  if (state !== saved.state) return backToApp(env, 'STATE_MISMATCH');

  // ---------- แลก code → id_token ----------
  let idToken: string;
  try {
    const res = await fetch(LINE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl(env),
        client_id: env.LINE_CHANNEL_ID!,
        client_secret: env.LINE_CHANNEL_SECRET!,
      }),
    });
    if (!res.ok) {
      console.error('LINE token ตอบผิดพลาด', res.status, await res.text());
      return backToApp(env, 'TOKEN_FAILED');
    }
    const data = (await res.json()) as { id_token?: string };
    if (!data.id_token) return backToApp(env, 'NO_ID_TOKEN');
    idToken = data.id_token;
  } catch (err) {
    console.error('เรียก LINE token ไม่สำเร็จ', err);
    return backToApp(env, 'LINE_UNREACHABLE');
  }

  // ---------- ให้ LINE ตรวจ id_token + nonce ----------
  let profile: { sub: string; name?: string; picture?: string };
  try {
    const res = await fetch(LINE_VERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: env.LINE_CHANNEL_ID!, nonce }),
    });
    if (!res.ok) {
      console.error('LINE verify ตอบผิดพลาด', res.status, await res.text());
      return backToApp(env, 'VERIFY_FAILED');
    }
    profile = (await res.json()) as typeof profile;
    if (!profile.sub) return backToApp(env, 'VERIFY_FAILED');
  } catch (err) {
    console.error('เรียก LINE verify ไม่สำเร็จ', err);
    return backToApp(env, 'LINE_UNREACHABLE');
  }

  if (linking) return linkLine(req, env, profile.sub);

  // ---------- สร้าง/อัปเดตผู้ใช้ ----------
  const now = nowThai();
  const name = (profile.name || 'ผู้ใช้ LINE').slice(0, 80);
  let userId: string;
  let status: 'pending' | 'active' | 'blocked' = 'pending';
  try {
    const existing = await env.DB.prepare(`SELECT id, status FROM users WHERE line_user_id = ?`)
      .bind(profile.sub).first<{ id: string; status: string }>();
    if (existing) {
      if (existing.status === 'blocked') return backToApp(env, 'BLOCKED');
      status = existing.status as typeof status;
      await env.DB.prepare(`UPDATE users SET display_name = ?, picture_url = ?, updated_at = ? WHERE id = ?`)
        .bind(name, profile.picture ?? null, now, existing.id).run();
      userId = existing.id;
    } else {
      userId = newId();
      await env.DB.prepare(
        `INSERT INTO users (id, line_user_id, display_name, picture_url, status, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 'member', ?, ?)`,
      ).bind(userId, profile.sub, name, profile.picture ?? null, now, now).run();
    }
  } catch (err) {
    console.error('บันทึกผู้ใช้ลง D1 ไม่สำเร็จ', err);
    return backToApp(env, 'DB_FAILED');
  }

  return finishLogin(env, CLEAR, { id: userId, status }, inviteCode);
}

/** ผูก LINE ให้บัญชีที่สมัครด้วย Google (line_user_id ยังเป็น 'google:…') — LINE นี้เป็นของคนอื่นแล้ว → ไม่รวมบัญชี แจ้งเหตุผล */
async function linkLine(req: Request, env: Env, lineSub: string): Promise<Response> {
  let me: { id: string };
  try {
    me = await requireUser(req, env, 'any');
  } catch (err) {
    console.error('ผูก LINE: ไม่พบการล็อกอิน', err);
    return linkResult(env, CLEAR, { error: 'NOT_LOGGED_IN' });
  }
  try {
    const row = await env.DB.prepare(`SELECT line_user_id FROM users WHERE id = ?`).bind(me.id).first<{ line_user_id: string }>();
    if (!row) return linkResult(env, CLEAR, { error: 'NOT_LOGGED_IN' });
    if (row.line_user_id === lineSub) return linkResult(env, CLEAR, { linked: 'line' });
    if (!row.line_user_id.startsWith('google:')) return linkResult(env, CLEAR, { error: 'LINE_ALREADY_LINKED' });
    const owner = await env.DB.prepare(`SELECT id FROM users WHERE line_user_id = ?`).bind(lineSub).first<{ id: string }>();
    if (owner) return linkResult(env, CLEAR, { error: 'LINE_IN_USE' });
    const r = await env.DB.prepare(`UPDATE users SET line_user_id = ?, updated_at = ? WHERE id = ? AND line_user_id LIKE 'google:%'`)
      .bind(lineSub, nowThai(), me.id).run();
    if (r.meta.changes !== 1) return linkResult(env, CLEAR, { error: 'DB_FAILED' });
  } catch (err) {
    console.error('ผูก LINE ลง D1 ไม่สำเร็จ', err);
    return linkResult(env, CLEAR, { error: 'DB_FAILED' });
  }
  return linkResult(env, CLEAR, { linked: 'line' });
}
