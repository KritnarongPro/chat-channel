// =====================================================================
// worker/auth-common.ts — ส่วนที่ LINE Login และ Google Login ใช้ร่วมกัน
//   - stateCookie: เก็บ state.nonce.invite.mode ระหว่างไปหน้าผู้ให้บริการแล้วกลับ (10 นาที)
//   - finishLogin: สร้าง session → (มาจากลิงก์เชิญ) ใช้ลิงก์เลย → พากลับหน้าเว็บ
//   - linkResult : โหมด "ผูกบัญชี" จบที่หน้า /account พร้อมผล/เหตุผล
// ทุกจุดที่ล้มเหลว → พากลับหน้าเว็บพร้อมรหัส error (หน้าเว็บแปลเป็นภาษาไทย) ไม่ค้างเงียบ
// =====================================================================

import { ApiError, Env, createSession } from './lib';
import { redeemInvite } from './invites';

export const STATE_MAX_AGE = 600; // 10 นาที
export type AuthMode = 'login' | 'link';

export interface OAuthState { state: string; nonce: string; invite: string; mode: AuthMode }

export function setStateCookie(name: string, path: string, s: OAuthState): string {
  return `${name}=${s.state}.${s.nonce}.${s.invite}.${s.mode}; Path=${path}; Max-Age=${STATE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}
export function clearStateCookie(name: string, path: string): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
export function parseState(raw: string | null): OAuthState | null {
  if (!raw) return null;
  const [state, nonce, invite = '', mode = 'login'] = raw.split('.');
  if (!state || !nonce) return null;
  return { state, nonce, invite, mode: mode === 'link' ? 'link' : 'login' };
}
export function cleanInvite(invite?: string | null): string {
  return invite && /^[A-Za-z0-9_-]{6,40}$/.test(invite) ? invite : '';
}

/** กลับหน้าแรก (ล้มเหลว → ?login_error=รหัส) */
export function backToApp(env: Env, clearCookie: string, error?: string, headers: Headers = new Headers()) {
  const target = new URL(env.APP_URL);
  if (error) target.searchParams.set('login_error', error);
  headers.set('Location', target.toString());
  headers.append('Set-Cookie', clearCookie);
  return new Response(null, { status: 302, headers });
}

/** โหมดผูกบัญชี: กลับหน้า /account?linked=line|google หรือ ?link_error=รหัส */
export function linkResult(env: Env, clearCookie: string, result: { linked: 'line' | 'google' } | { error: string }) {
  const target = new URL('/account', env.APP_URL);
  if ('linked' in result) target.searchParams.set('linked', result.linked);
  else target.searchParams.set('link_error', result.error);
  const headers = new Headers({ Location: target.toString() });
  headers.append('Set-Cookie', clearCookie);
  return new Response(null, { status: 302, headers });
}

/** ล็อกอินสำเร็จ: สร้าง session · มาจากลิงก์เชิญ → ใช้ลิงก์ทันทีแล้วพาไปห้อง (ใช้ไม่ได้ → /join/<รหัส>?error=…) */
export async function finishLogin(
  env: Env, clearCookie: string, user: { id: string; status: 'pending' | 'active' | 'blocked' }, inviteCode: string,
): Promise<Response> {
  let cookie: string;
  try {
    cookie = await createSession(env, user.id);
  } catch (err) {
    console.error('สร้าง session ไม่สำเร็จ', err);
    return backToApp(env, clearCookie, 'SESSION_FAILED');
  }
  const headers = new Headers();
  headers.append('Set-Cookie', cookie);
  if (!inviteCode) return backToApp(env, clearCookie, undefined, headers);

  let path: string;
  try {
    const r = await redeemInvite(env, inviteCode, user);
    path = `/room/${encodeURIComponent(r.roomId)}`;
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'INVITE_FAILED';
    if (!(err instanceof ApiError)) console.error('ใช้ลิงก์เชิญหลังล็อกอินไม่สำเร็จ', err);
    path = `/join/${encodeURIComponent(inviteCode)}?error=${encodeURIComponent(code)}`;
  }
  headers.set('Location', new URL(path, env.APP_URL).toString());
  headers.append('Set-Cookie', clearCookie);
  return new Response(null, { status: 302, headers });
}
