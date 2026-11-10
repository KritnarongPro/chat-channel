// =====================================================================
// worker/auth-line.ts — ล็อกอินด้วย LINE Login (OAuth 2.1 / OpenID Connect)
//
//   /api/auth/line/start     → สร้าง state + nonce เก็บใน cookie แล้วพาไปหน้า LINE
//   /api/auth/line/callback  → ตรวจ state → แลก code เป็น id_token → ให้ LINE ตรวจ id_token (+nonce)
//                              → สร้าง/อัปเดตผู้ใช้ → สร้าง session cookie → กลับหน้าแรก
// ล้มเหลวทุกจุด → พากลับหน้าแรกพร้อม ?login_error=รหัส (หน้าเว็บแสดงเหตุผลภาษาไทย)
// =====================================================================

import { nowThai } from '../shared/time';
import { Env, createSession, newId, randomToken, readCookie } from './lib';

const LINE_AUTHORIZE = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY = 'https://api.line.me/oauth2/v2.1/verify';
const STATE_COOKIE = 'line_oauth';
const STATE_MAX_AGE = 600; // 10 นาที

function callbackUrl(env: Env) {
  return `${env.APP_URL}/api/auth/line/callback`;
}

function backToApp(env: Env, error?: string, extraHeaders: Headers = new Headers()) {
  const target = new URL(env.APP_URL);
  if (error) target.searchParams.set('login_error', error);
  extraHeaders.set('Location', target.toString());
  // ลบ cookie state ทุกครั้งที่จบขั้นตอน
  extraHeaders.append('Set-Cookie', `${STATE_COOKIE}=; Path=/api/auth/line; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 302, headers: extraHeaders });
}

/** ตรวจว่าตั้งค่า LINE ครบ — ไม่ครบคืนรหัส error */
export function lineConfigError(env: Env): string | null {
  if (!env.LINE_CHANNEL_ID) return 'NO_LINE_CHANNEL_ID';
  if (!env.LINE_CHANNEL_SECRET) return 'NO_LINE_CHANNEL_SECRET';
  if (!env.APP_URL) return 'NO_APP_URL';
  return null;
}

// ---------- เริ่มล็อกอิน ----------
export function lineStart(env: Env): Response {
  const cfgErr = lineConfigError(env);
  if (cfgErr) return backToApp(env, cfgErr);

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
      'Set-Cookie': `${STATE_COOKIE}=${state}.${nonce}; Path=/api/auth/line; Max-Age=${STATE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

// ---------- LINE ส่งกลับมา ----------
export async function lineCallback(req: Request, env: Env): Promise<Response> {
  const cfgErr = lineConfigError(env);
  if (cfgErr) return backToApp(env, cfgErr);

  const url = new URL(req.url);
  if (url.searchParams.get('error')) return backToApp(env, 'LINE_DENIED'); // ผู้ใช้กดยกเลิกที่หน้า LINE

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = readCookie(req, STATE_COOKIE);
  if (!code || !state || !saved) return backToApp(env, 'STATE_MISSING');
  const [savedState, nonce] = saved.split('.');
  if (state !== savedState || !nonce) return backToApp(env, 'STATE_MISMATCH');

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

  // ---------- สร้าง/อัปเดตผู้ใช้ ----------
  const now = nowThai();
  const name = (profile.name || 'ผู้ใช้ LINE').slice(0, 80);
  let userId: string;
  try {
    const existing = await env.DB.prepare(`SELECT id, status FROM users WHERE line_user_id = ?`)
      .bind(profile.sub).first<{ id: string; status: string }>();
    if (existing) {
      if (existing.status === 'blocked') return backToApp(env, 'BLOCKED');
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

  // ---------- session ----------
  let cookie: string;
  try {
    cookie = await createSession(env, userId);
  } catch (err) {
    console.error('สร้าง session ไม่สำเร็จ', err);
    return backToApp(env, 'SESSION_FAILED');
  }
  const headers = new Headers();
  headers.append('Set-Cookie', cookie);
  return backToApp(env, undefined, headers);
}
