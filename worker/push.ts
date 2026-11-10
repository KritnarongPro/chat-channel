// =====================================================================
// worker/push.ts — ส่งแจ้งเตือนบนมือถือ (Web Push) ด้วย Web Crypto ล้วน ไม่ใช้ไลบรารีนอก
//
// สารบัญ
//   1. base64url
//   2. กุญแจ VAPID (ระบบสร้างเองครั้งแรก เก็บในตาราง app_settings)
//   3. เข้ารหัสข้อความตามมาตรฐาน RFC 8291 (aes128gcm) + ลายเซ็น VAPID (RFC 8292)
//   4. ส่งถึง 1 เครื่อง → คืนผลพร้อมเหตุผล
//   5. Queue consumer (queue chat-push): งาน push = แจ้งเตือนมือถือ (ชุดละไม่เกิน 100 คน)
//                                         งาน webhook = ส่งข้อความ/ออเดอร์ถึงบอท (เฟส 4)
// =====================================================================

import { nowThai } from '../shared/time';
import type { Env } from './lib';

// =====================================================================
// 1. base64url
// =====================================================================
export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const utf8 = (s: string) => new TextEncoder().encode(s);

// =====================================================================
// 2. กุญแจ VAPID
// =====================================================================
export interface VapidKeys { publicKey: string; privateJwk: JsonWebKey }

/** อ่านกุญแจจาก app_settings — ยังไม่มี → สร้างใหม่ (INSERT OR IGNORE กันสร้างซ้อนกัน) แล้วอ่านอีกรอบ */
export async function getVapidKeys(env: Env): Promise<VapidKeys> {
  const read = async () => {
    const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'vapid_keys'`).first<{ value: string }>();
    return row ? (JSON.parse(row.value) as VapidKeys) : null;
  };
  const existing = await read();
  if (existing) return existing;

  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicRaw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const keys: VapidKeys = { publicKey: b64u(publicRaw), privateJwk };
  await env.DB.prepare(`INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('vapid_keys', ?, ?)`)
    .bind(JSON.stringify(keys), nowThai()).run();
  const saved = await read();
  if (!saved) throw new Error('บันทึกกุญแจ VAPID ไม่สำเร็จ');
  return saved;
}

async function vapidAuthHeader(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // Web Crypto คืนลายเซ็นแบบ r||s (64 ไบต์) ตรงกับที่ JWT ES256 ต้องการ
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// =====================================================================
// 3. เข้ารหัส (RFC 8291 — aes128gcm, record เดียว)
// =====================================================================
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

export async function encryptPayload(p256dh: string, auth: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('กุญแจของเครื่องรับไม่ถูกต้อง');

  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // workers-types ตั้งชื่อฟิลด์ public เป็น $public แต่ runtime ใช้ public ตามมาตรฐาน → ใส่แบบ cast
  const ecdhAlg = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhAlg, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02 = record สุดท้าย
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// =====================================================================
// 4. ส่งถึง 1 เครื่อง
// =====================================================================
export interface PushPayload { title: string; body: string; url: string; tag: string }
export interface Subscription { id: string; endpoint: string; p256dh: string; auth: string }
export type SendResult = { ok: true } | { ok: false; gone: boolean; reason: string };

export async function sendPush(env: Env, keys: VapidKeys, sub: Subscription, payload: PushPayload): Promise<SendResult> {
  let body: Uint8Array;
  let authorization: string;
  try {
    body = await encryptPayload(sub.p256dh, sub.auth, utf8(JSON.stringify(payload)));
    authorization = await vapidAuthHeader(sub.endpoint, keys, env.APP_URL);
  } catch (err) {
    return { ok: false, gone: false, reason: `เข้ารหัสไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}` };
  }
  let res: Response;
  try {
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
      body,
    });
  } catch (err) {
    return { ok: false, gone: false, reason: `ติดต่อ push service ไม่ได้: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (res.ok) return { ok: true };
  const text = (await res.text()).slice(0, 200);
  // 404/410 = เครื่องนี้เลิกรับแจ้งเตือนแล้ว (ถอนแอป/ล้างข้อมูล/ปิดสิทธิ์) → ลบออกได้เลย
  return { ok: false, gone: res.status === 404 || res.status === 410, reason: `push service ตอบ HTTP ${res.status} ${text}` };
}

/** ส่งให้ทุกเครื่องของผู้ใช้ชุดหนึ่ง แล้วบันทึกผลลง push_subscriptions — คืนจำนวน ส่งได้/ไม่ได้ */
export async function sendToUsers(env: Env, userIds: string[], payload: PushPayload): Promise<{ sent: number; failed: number; errors: string[] }> {
  const out = { sent: 0, failed: 0, errors: [] as string[] };
  if (userIds.length === 0) return out;
  const keys = await getVapidKeys(env);
  const subs: Subscription[] = [];
  for (let i = 0; i < userIds.length; i += 90) {
    const part = userIds.slice(i, i + 90);
    const rows = await env.DB.prepare(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${part.map(() => '?').join(',')})`,
    ).bind(...part).all<Subscription>();
    subs.push(...rows.results);
  }

  const now = nowThai();
  const updates: D1PreparedStatement[] = [];
  // ส่งพร้อมกันครั้งละ 6 (ขีดจำกัดการเชื่อมต่อพร้อมกันของ Worker)
  for (let i = 0; i < subs.length; i += 6) {
    const chunk = subs.slice(i, i + 6);
    const results = await Promise.all(chunk.map((s) => sendPush(env, keys, s, payload)));
    results.forEach((r, j) => {
      const s = chunk[j];
      if (r.ok) {
        out.sent++;
        updates.push(env.DB.prepare(`UPDATE push_subscriptions SET last_success_at = ?, fail_count = 0 WHERE id = ?`).bind(now, s.id));
      } else {
        out.failed++;
        out.errors.push(r.reason);
        updates.push(r.gone
          ? env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(s.id)
          : env.DB.prepare(
              `UPDATE push_subscriptions SET last_error = ?, last_error_at = ?, fail_count = fail_count + 1 WHERE id = ?`,
            ).bind(r.reason, now, s.id));
      }
    });
  }
  if (updates.length) await env.DB.batch(updates);
  return out;
}

// =====================================================================
// 5. Queue consumer
// =====================================================================
/** งานใน queue: งานเก่าก่อนเฟส 4 ไม่มี type = งาน push */
export type PushJob =
  | { type?: 'push'; userIds: string[]; payload: PushPayload }
  | { type: 'webhook'; botId: string; update: Record<string, unknown> };

export async function handlePushQueue(batch: MessageBatch<PushJob>, env: Env) {
  for (const msg of batch.messages) {
    if (msg.body.type === 'webhook') {
      const r = await deliverWebhook(env, msg.body.botId, msg.body.update);
      if (r === 'retry') msg.retry(); else msg.ack();
      continue;
    }
    try {
      const r = await sendToUsers(env, msg.body.userIds, msg.body.payload);
      if (r.failed) console.error(`push: ส่งไม่สำเร็จ ${r.failed} เครื่อง`, r.errors.slice(0, 5));
      msg.ack();
    } catch (err) {
      // อ่าน/เขียน D1 หรือสร้างกุญแจไม่สำเร็จ → ให้ Queue ลองใหม่ (สูงสุดตาม max_retries)
      console.error('push: งานแจ้งเตือนล้มเหลว จะลองใหม่', err);
      msg.retry();
    }
  }
}

// =====================================================================
// 6. ส่งถึง webhook ของบอท (เฟส 4)
//    หัว X-Bot-Secret = webhook_secret ของบอท ให้ปลายทาง (n8n) ตรวจว่ามาจากระบบเราจริง
//    ไม่สำเร็จ → บันทึก last_error + fail_count (เห็นในหน้า แอดมิน → บอท) แล้วให้ Queue ลองใหม่ (สูงสุด 3 ครั้ง)
// =====================================================================
export async function deliverWebhook(env: Env, botId: string, update: Record<string, unknown>): Promise<'ok' | 'retry' | 'skip'> {
  let bot: { webhook_url: string | null; webhook_secret: string; enabled: number; display_name: string } | null;
  try {
    bot = await env.DB.prepare(
      `SELECT b.webhook_url, b.webhook_secret, b.enabled, u.display_name FROM bots b JOIN users u ON u.id = b.id WHERE b.id = ?`,
    ).bind(botId).first();
  } catch (err) {
    console.error('webhook: อ่านข้อมูลบอทไม่สำเร็จ จะลองใหม่', err);
    return 'retry';
  }
  if (!bot || !bot.enabled || !bot.webhook_url) return 'skip'; // บอทถูกลบ/ปิด/ไม่มี webhook → ทิ้งงาน
  const now = nowThai();
  let reason: string | null = null;
  try {
    const res = await fetch(bot.webhook_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Bot-Secret': bot.webhook_secret },
      body: JSON.stringify({ ...update, bot: { id: botId, name: bot.display_name }, sentAt: now }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) reason = `webhook ตอบ HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
  } catch (err) {
    reason = `ติดต่อ webhook ไม่ได้: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    await (reason
      ? env.DB.prepare(`UPDATE bots SET last_error = ?, last_error_at = ?, fail_count = fail_count + 1 WHERE id = ?`).bind(reason, now, botId)
      : env.DB.prepare(`UPDATE bots SET last_delivery_at = ?, fail_count = 0 WHERE id = ?`).bind(now, botId)
    ).run();
  } catch (err) {
    console.error('webhook: บันทึกผลส่งไม่สำเร็จ', err);
  }
  if (reason) {
    console.error(`webhook บอท ${botId}: ${reason}`);
    return 'retry';
  }
  return 'ok';
}
