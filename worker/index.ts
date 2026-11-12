// =====================================================================
// worker/index.ts — API ระบบแชท (Cloudflare Workers + D1 + Durable Objects)
// Deploy: GitHub Actions (merge เข้า main → migration + deploy) — ไม่ใช้ Workers Builds
//
// สารบัญ
//   1. Router + ตาราง endpoint แยกหมวด
//   2. Handlers: health / auth / setup / admin / users / rooms / channels / messages / files / push
//                bots (แอดมินจัดการ) / bot-api (บอทเรียกด้วย token) / forms / orders   ← เฟส 4
//                invites (ลิงก์เชิญเข้าชาเนล/กลุ่ม)
//                notify (ระบบแจ้งเตือนแบบ Telegram: ปิดเสียงมีเวลา, ตั้งค่ารวม, ปักหมุด, แอปเปิดอยู่, บอทแจ้งเตือน)
//                เฟส 5: prefs (ธีม/ตัวอักษร) / friends (เพื่อน) / stickers / notes (โน้ตในห้อง + ส่วนตัว)
//   3. ตัวช่วยเรื่องห้อง (ตรวจสมาชิก, สิทธิ์โพสต์)
//   4. Entry point (fetch + scheduled: ลบไฟล์ครบ 180 วัน + queue: ส่งแจ้งเตือน)
//
// กติกา: ข้อมูลไม่ผ่านเงื่อนไข หรือเขียน D1 ไม่สำเร็จ → ตอบ error พร้อมเหตุผลภาษาไทยเสมอ
// สิทธิ์ทุก endpoint ตรวจผ่าน requireUser() ใน lib.ts ที่เดียว
// =====================================================================

import { nowThai } from '../shared/time';
import {
  FILE_RETENTION_DAYS, FileKind, HISTORY_LIMIT, IMAGE_MIMES, MAX_BYTES, MAX_VOICE_SECONDS, VOICE_MIMES,
} from '../shared/protocol';
import { thaiAfter } from '../shared/time';
import { cleanupFiles } from './cleanup';
import { PushJob, deliverWebhook, getVapidKeys, handlePushQueue, sendToUsers } from './push';
import {
  ApiError, Env, Need, User, clearSessionCookie, db, fail, newId, ok, randomToken, readCookie, readJson,
  requireBot, requireUser, sha256, SESSION_COOKIE, userOut, contactableIds, friendPair,
} from './lib';
import { FormField, OrderStatus, ORDER_STATUS_TH, checkFormDef, checkSubmission } from '../shared/forms';
import { lineCallback, lineConfigError, lineStart } from './auth-line';
import { InviteRow, inviteProblem, loadInvite, redeemInvite } from './invites';

export { ChatRoom } from './room';
export { UserHub } from './hub';

// =====================================================================
// 1. Router
// =====================================================================
interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  user: User | null; // เติมโดย router ตาม need ของ route
}
type Handler = (c: Ctx) => Promise<Response> | Response;
interface Route { method: string; pattern: string; need: Need | 'public'; handler: Handler }

const routes: Route[] = [
  // ---------- health ----------
  { method: 'GET',  pattern: '/api/health',                   need: 'public', handler: health },

  // ---------- auth (LINE Login) ----------
  { method: 'GET',  pattern: '/api/auth/line/start',          need: 'public', handler: (c) => lineStart(c.env, c.url.searchParams.get('invite')) },
  { method: 'GET',  pattern: '/api/auth/line/callback',       need: 'public', handler: (c) => lineCallback(c.req, c.env) },
  { method: 'POST', pattern: '/api/auth/logout',              need: 'public', handler: logout },
  { method: 'GET',  pattern: '/api/me',                       need: 'any',    handler: me },

  // ---------- setup: ตั้งแอดมินคนแรกด้วย SETUP_TOKEN ----------
  { method: 'POST', pattern: '/api/setup/claim-admin',        need: 'any',    handler: claimAdmin },

  // ---------- admin: อนุมัติ/ระงับผู้ใช้ ----------
  { method: 'GET',  pattern: '/api/admin/users',              need: 'admin',  handler: adminListUsers },
  { method: 'POST', pattern: '/api/admin/users/:id/status',   need: 'admin',  handler: adminSetStatus },

  // ---------- users: รายชื่อสำหรับเริ่มแชท ----------
  { method: 'GET',  pattern: '/api/users',                    need: 'active', handler: listUsers },

  // ---------- rooms ----------
  { method: 'GET',  pattern: '/api/rooms',                    need: 'active', handler: listRooms },
  { method: 'POST', pattern: '/api/rooms/dm',                 need: 'active', handler: openDm },
  { method: 'POST', pattern: '/api/rooms/group',              need: 'active', handler: createGroup },
  { method: 'GET',  pattern: '/api/rooms/:id',                need: 'active', handler: getRoom },
  { method: 'POST', pattern: '/api/rooms/:id/members',        need: 'active', handler: addMembers },
  { method: 'POST', pattern: '/api/rooms/:id/mute',           need: 'active', handler: setMute },
  { method: 'POST', pattern: '/api/rooms/:id/pin',            need: 'active', handler: pinMessage },

  // ---------- notify: ตั้งค่าแจ้งเตือนรวม + การเชื่อมต่อของแอป (แจ้งเตือนในแอป) ----------
  { method: 'GET',  pattern: '/api/me/notify-settings',       need: 'active', handler: getNotifySettings },
  { method: 'POST', pattern: '/api/me/notify-settings',       need: 'active', handler: saveNotifySettings },
  { method: 'GET',  pattern: '/api/me/ws',                    need: 'active', handler: openHub },

  // ---------- channels (สร้างได้เฉพาะแอดมินระบบ · โพสต์ได้เฉพาะเจ้าของ/แอดมินชาเนล) ----------
  { method: 'GET',  pattern: '/api/channels',                 need: 'active', handler: listChannels },
  { method: 'POST', pattern: '/api/rooms/channel',            need: 'admin',  handler: createChannel },
  { method: 'POST', pattern: '/api/rooms/:id/join',           need: 'active', handler: joinChannel },
  { method: 'POST', pattern: '/api/rooms/:id/leave',          need: 'active', handler: leaveChannel },
  { method: 'POST', pattern: '/api/rooms/:id/members/:userId/role', need: 'active', handler: setMemberRole },

  // ---------- messages (ส่งต่อไปที่ห้อง = Durable Object) ----------
  { method: 'GET',  pattern: '/api/rooms/:id/messages',       need: 'active', handler: history },
  { method: 'GET',  pattern: '/api/rooms/:id/ws',             need: 'active', handler: openSocket },

  // ---------- files (รูป / ไฟล์ / เสียง — ตัวไฟล์อยู่ใน R2 เปิดได้เฉพาะสมาชิกห้อง) ----------
  { method: 'POST', pattern: '/api/rooms/:id/files',          need: 'active', handler: uploadFile },
  { method: 'GET',  pattern: '/api/files/:fileId',            need: 'active', handler: downloadFile },

  // ---------- push (แจ้งเตือนบนมือถือ) ----------
  { method: 'GET',  pattern: '/api/push/key',                 need: 'active', handler: pushKey },
  { method: 'POST', pattern: '/api/push/subscribe',           need: 'active', handler: pushSubscribe },
  { method: 'POST', pattern: '/api/push/unsubscribe',         need: 'active', handler: pushUnsubscribe },
  { method: 'GET',  pattern: '/api/push/devices',             need: 'active', handler: pushDevices },
  { method: 'POST', pattern: '/api/push/test',                need: 'active', handler: pushTest },

  // ---------- bots: แอดมินระบบสร้าง/แก้/ปิดบอท ----------
  { method: 'GET',  pattern: '/api/admin/bots',               need: 'admin',  handler: adminListBots },
  { method: 'POST', pattern: '/api/admin/bots',               need: 'admin',  handler: adminCreateBot },
  { method: 'POST', pattern: '/api/admin/bots/:id',           need: 'admin',  handler: adminUpdateBot },
  { method: 'POST', pattern: '/api/admin/bots/:id/token',     need: 'admin',  handler: adminRegenToken },
  { method: 'POST', pattern: '/api/admin/bots/:id/test',      need: 'admin',  handler: adminTestWebhook },

  // ---------- bot-api: บอท (เช่น n8n) เรียกด้วย Authorization: Bearer <token> ----------
  { method: 'GET',  pattern: '/api/bot/me',                   need: 'bot',    handler: botMe },
  { method: 'GET',  pattern: '/api/bot/rooms',                need: 'bot',    handler: botRooms },
  { method: 'POST', pattern: '/api/bot/sendMessage',          need: 'bot',    handler: botSendMessage },
  { method: 'POST', pattern: '/api/bot/sendForm',             need: 'bot',    handler: botSendForm },
  { method: 'POST', pattern: '/api/bot/notify',               need: 'bot',    handler: botNotify },
  { method: 'GET',  pattern: '/api/bot/orders',               need: 'bot',    handler: botOrders },
  { method: 'POST', pattern: '/api/bot/orders/:orderId/status', need: 'bot',  handler: botSetOrderStatus },

  // ---------- forms: แอดมินสร้าง/แก้ · ผู้ใช้เปิดกรอกจากการ์ดในห้อง ----------
  { method: 'GET',  pattern: '/api/admin/forms',              need: 'admin',  handler: adminListForms },
  { method: 'POST', pattern: '/api/admin/forms',              need: 'admin',  handler: adminSaveForm },
  { method: 'POST', pattern: '/api/admin/forms/:formId',      need: 'admin',  handler: adminSaveForm },
  { method: 'GET',  pattern: '/api/forms/:formId',            need: 'active', handler: getForm },
  { method: 'POST', pattern: '/api/forms/:formId/submit',     need: 'active', handler: submitForm },

  // ---------- orders: แอดมินเห็นทั้งหมด + เปลี่ยนสถานะ · ผู้ใช้เห็นของตัวเอง ----------
  { method: 'GET',  pattern: '/api/orders',                   need: 'active', handler: listOrders },
  { method: 'POST', pattern: '/api/orders/:orderId/status',   need: 'admin',  handler: adminSetOrderStatus },

  // ---------- invites: เจ้าของ/แอดมินห้องสร้าง-ยกเลิก · ใครมีลิงก์ก็ดูข้อมูลห้องได้ · ล็อกอินแล้ว (รออนุมัติก็ได้) ใช้ลิงก์ได้ ----------
  { method: 'GET',  pattern: '/api/rooms/:id/invites',        need: 'active', handler: listInvites },
  { method: 'POST', pattern: '/api/rooms/:id/invites',        need: 'active', handler: createInvite },
  { method: 'POST', pattern: '/api/rooms/:id/invites/:code/revoke', need: 'active', handler: revokeInvite },
  { method: 'GET',  pattern: '/api/invites/:code',            need: 'public', handler: inviteInfo },
  { method: 'POST', pattern: '/api/invites/:code/join',       need: 'any',    handler: joinByInvite },

  // ---------- prefs (เฟส 5): ธีม + ขนาดตัวอักษร จำต่อบัญชี ----------
  { method: 'GET',  pattern: '/api/me/prefs',                 need: 'active', handler: getPrefs },
  { method: 'POST', pattern: '/api/me/prefs',                 need: 'active', handler: savePrefs },

  // ---------- friends (เฟส 5): แชท 1:1 / เพิ่มเข้ากลุ่ม ได้เฉพาะเพื่อน (ยกเว้นแอดมินระบบ + บอท) ----------
  { method: 'GET',  pattern: '/api/friends',                  need: 'active', handler: listFriends },
  { method: 'POST', pattern: '/api/friends/request',          need: 'active', handler: requestFriend },
  { method: 'POST', pattern: '/api/friends/:userId/accept',   need: 'active', handler: acceptFriend },
  { method: 'POST', pattern: '/api/friends/:userId/remove',   need: 'active', handler: removeFriend },

  // ---------- stickers (เฟส 5): แอดมินระบบเพิ่ม · ทุกคนส่งได้ ----------
  { method: 'GET',  pattern: '/api/stickers',                 need: 'active', handler: listStickers },
  { method: 'GET',  pattern: '/api/stickers/:stickerId/image', need: 'active', handler: stickerImage },
  { method: 'GET',  pattern: '/api/admin/stickers',           need: 'admin',  handler: adminListStickers },
  { method: 'POST', pattern: '/api/admin/stickers/packs',     need: 'admin',  handler: adminCreatePack },
  { method: 'POST', pattern: '/api/admin/stickers/packs/:packId', need: 'admin', handler: adminUpdatePack },
  { method: 'POST', pattern: '/api/admin/stickers/packs/:packId/upload', need: 'admin', handler: adminUploadSticker },
  { method: 'POST', pattern: '/api/admin/stickers/:stickerId', need: 'admin', handler: adminUpdateSticker },

  // ---------- notes (เฟส 5): โน้ตในห้อง (สมาชิกเห็นทุกคน + คอมเมนต์) · โน้ตส่วนตัว ----------
  { method: 'GET',  pattern: '/api/rooms/:id/notes',          need: 'active', handler: listRoomNotes },
  { method: 'POST', pattern: '/api/rooms/:id/notes',          need: 'active', handler: createRoomNote },
  { method: 'GET',  pattern: '/api/notes/:noteId',            need: 'active', handler: getNote },
  { method: 'POST', pattern: '/api/notes/:noteId',            need: 'active', handler: updateNote },
  { method: 'POST', pattern: '/api/notes/:noteId/delete',     need: 'active', handler: deleteNote },
  { method: 'POST', pattern: '/api/notes/:noteId/comments',   need: 'active', handler: addNoteComment },
  { method: 'POST', pattern: '/api/note-comments/:commentId/delete', need: 'active', handler: deleteNoteComment },
  { method: 'GET',  pattern: '/api/me/notes',                 need: 'active', handler: listMyNotes },
  { method: 'POST', pattern: '/api/me/notes',                 need: 'active', handler: createMyNote },
  { method: 'POST', pattern: '/api/me/notes/:noteId',         need: 'active', handler: updateMyNote },
  { method: 'POST', pattern: '/api/me/notes/:noteId/delete',  need: 'active', handler: deleteMyNote },
];

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** กันเว็บอื่นยิงคำสั่งแทนผู้ใช้ (CSRF / WebSocket hijack): POST และ WebSocket ต้องมาจากโดเมนของเราเท่านั้น
 *  (Bot API ใช้ token ในหัว Authorization ไม่ใช้ cookie จึงไม่ต้องตรวจ Origin) */
function checkOrigin(req: Request, env: Env) {
  if (new URL(req.url).pathname.startsWith('/api/bot/')) return;
  const isWs = req.headers.get('Upgrade') === 'websocket';
  if (req.method === 'GET' && !isWs) return;
  const origin = req.headers.get('Origin');
  // อนุญาตเฉพาะหน้าเว็บโดเมนเดียวกับที่เรียก (ใช้ได้ทั้งโดเมนจริงและตอนทดสอบในเครื่อง) หรือ APP_URL
  if (origin && origin !== new URL(req.url).origin && origin !== new URL(env.APP_URL).origin) {
    throw new ApiError(403, 'BAD_ORIGIN', 'คำขอนี้ไม่ได้มาจากหน้าเว็บของระบบ');
  }
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  let methodMismatch = false;
  for (const r of routes) {
    const params = match(r.pattern, url.pathname);
    if (!params) continue;
    if (r.method !== req.method) { methodMismatch = true; continue; }
    try {
      checkOrigin(req, env);
      const user = r.need === 'public' ? null
        : r.need === 'bot' ? await requireBot(req, env)
        : await requireUser(req, env, r.need);
      return await r.handler({ req, env, url, params, user });
    } catch (err) {
      if (err instanceof ApiError) return fail(err.status, err.code, err.message);
      console.error('ข้อผิดพลาดที่ไม่คาดไว้', req.method, url.pathname, err);
      return fail(500, 'INTERNAL', 'ระบบขัดข้อง กรุณาลองใหม่ (ดูรายละเอียดใน log ของ Worker)');
    }
  }
  if (methodMismatch) return fail(405, 'METHOD', 'ไม่รองรับวิธีเรียกนี้');
  return fail(404, 'NOT_FOUND', 'ไม่พบ API นี้');
}

// =====================================================================
// 2. Handlers
// =====================================================================

// ---------- health ----------
async function health(c: Ctx) {
  const problems: string[] = [];
  const lineErr = lineConfigError(c.env);
  if (lineErr) problems.push(lineErr);
  if (!c.env.SETUP_TOKEN) problems.push('NO_SETUP_TOKEN');
  try {
    await c.env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
  } catch (err) {
    console.error('health: D1 ใช้ไม่ได้', err);
    problems.push('DB_NOT_READY');
  }
  return ok({ time: nowThai(), problems });
}

// ---------- auth ----------
async function logout(c: Ctx) {
  const token = readCookie(c.req, SESSION_COOKIE);
  if (token) {
    const hash = await sha256(token);
    await db('ออกจากระบบ', () => c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run());
  }
  return ok({ loggedOut: true }, 200, { 'Set-Cookie': clearSessionCookie });
}

async function me(c: Ctx) {
  const hasAdmin = await db('ตรวจว่ามีแอดมินหรือยัง', () =>
    c.env.DB.prepare(`SELECT 1 AS x FROM users WHERE role = 'admin' LIMIT 1`).first(),
  );
  return ok({ user: c.user, appName: c.env.APP_NAME, hasAdmin: !!hasAdmin });
}

// ---------- setup ----------
async function claimAdmin(c: Ctx) {
  if (!c.env.SETUP_TOKEN) {
    throw new ApiError(500, 'NO_SETUP_TOKEN', 'ยังไม่ได้ตั้ง SETUP_TOKEN ใน Cloudflare (Settings → Variables and Secrets)');
  }
  const body = await readJson<{ token?: unknown }>(c.req);
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new ApiError(400, 'NO_TOKEN', 'กรุณากรอกรหัสตั้งค่า');
  }
  if ((await sha256(body.token)) !== (await sha256(c.env.SETUP_TOKEN))) {
    throw new ApiError(403, 'WRONG_TOKEN', 'รหัสตั้งค่าไม่ถูกต้อง');
  }
  const res = await db('ตั้งแอดมินคนแรก', () =>
    c.env.DB.prepare(
      `UPDATE users SET role = 'admin', status = 'active', updated_at = ?
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`,
    ).bind(nowThai(), c.user!.id).run(),
  );
  if (res.meta.changes !== 1) {
    throw new ApiError(409, 'ADMIN_EXISTS', 'มีแอดมินอยู่แล้ว ให้แอดมินคนเดิมอนุมัติบัญชีนี้แทน');
  }
  return ok({ role: 'admin' });
}

// ---------- admin ----------
async function adminListUsers(c: Ctx) {
  const status = c.url.searchParams.get('status');
  if (status && !['pending', 'active', 'blocked'].includes(status)) {
    throw new ApiError(400, 'BAD_STATUS', 'สถานะที่ค้นหาไม่ถูกต้อง');
  }
  const rows = await db('อ่านรายชื่อผู้ใช้', () =>
    (status
      ? c.env.DB.prepare(`SELECT * FROM users WHERE status = ? AND is_bot = 0 ORDER BY created_at DESC`).bind(status)
      : c.env.DB.prepare(`SELECT * FROM users WHERE is_bot = 0 ORDER BY status = 'pending' DESC, created_at DESC`)
    ).all<Parameters<typeof userOut>[0] & { created_at: string }>(),
  );
  return ok({ users: rows.results.map((r) => ({ ...userOut(r), createdAt: r.created_at })) });
}

async function adminSetStatus(c: Ctx) {
  const body = await readJson<{ status?: unknown }>(c.req);
  const status = body.status;
  if (status !== 'active' && status !== 'blocked' && status !== 'pending') {
    throw new ApiError(400, 'BAD_STATUS', 'สถานะต้องเป็น active, blocked หรือ pending');
  }
  if (c.params.id === c.user!.id) throw new ApiError(400, 'SELF', 'เปลี่ยนสถานะบัญชีตัวเองไม่ได้');
  const res = await db('เปลี่ยนสถานะผู้ใช้', () =>
    c.env.DB.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND is_bot = 0`).bind(status, nowThai(), c.params.id).run(),
  );
  if (res.meta.changes !== 1) throw new ApiError(404, 'USER_NOT_FOUND', 'ไม่พบผู้ใช้นี้');
  if (status === 'blocked') {
    await db('ออกจากระบบผู้ใช้ที่ถูกระงับ', () =>
      c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(c.params.id).run(),
    );
  }
  return ok({ id: c.params.id, status });
}

// ---------- users ----------
/** รายชื่อผู้ใช้ทั้งหมด + สถานะเพื่อน (เฟส 5) · canChat = ทักแชท 1:1 / เพิ่มเข้ากลุ่มได้เลย */
async function listUsers(c: Ctx) {
  const me = c.user!;
  const rows = await db('อ่านรายชื่อผู้ใช้', () =>
    c.env.DB.prepare(
      `SELECT u.id, u.display_name, u.picture_url, u.status, u.role, u.is_bot, f.status AS f_status, f.requested_by
       FROM users u
       LEFT JOIN friendships f ON f.user_low = MIN(?1, u.id) AND f.user_high = MAX(?1, u.id)
       WHERE u.status = 'active' AND u.id <> ?1 ORDER BY u.is_bot, u.display_name`,
    ).bind(me.id).all<Parameters<typeof userOut>[0] & { f_status: string | null; requested_by: string | null }>(),
  );
  const meExempt = me.role === 'admin' || me.isBot;
  return ok({
    users: rows.results.map((r) => {
      const friend = r.f_status === 'accepted' ? 'friend'
        : r.f_status === 'pending' ? (r.requested_by === me.id ? 'outgoing' : 'incoming') : 'none';
      return { ...userOut(r), friend, canChat: friend === 'friend' || meExempt || r.is_bot === 1 || r.role === 'admin' };
    }),
  });
}

// ---------- rooms ----------
type RoomListRow = {
  id: string; type: 'dm' | 'group' | 'channel'; title: string | null; last_seq: number;
  last_message_at: string | null; last_message_preview: string | null; last_sender_name: string | null;
  created_at: string; last_read_seq: number; my_role: string; peer_name: string | null; peer_picture: string | null;
  visibility: 'public' | 'private' | null; description: string | null; muted: number; muted_until: string | null;
  pinned_seq: number | null; pinned_text: string | null; pinned_sender: string | null; pinned_at: string | null;
};

async function listRooms(c: Ctx) {
  const rows = await db('อ่านรายการแชท', () =>
    c.env.DB.prepare(
      `SELECT r.id, r.type, r.title, r.last_seq, r.last_message_at, r.last_message_preview, r.last_sender_name,
              r.created_at, r.visibility, r.description, m.last_read_seq, m.role AS my_role, m.muted, m.muted_until,
              r.pinned_seq, r.pinned_text, r.pinned_sender, r.pinned_at,
              (SELECT u.display_name FROM room_members m2 JOIN users u ON u.id = m2.user_id
                 WHERE m2.room_id = r.id AND m2.user_id <> ?1 LIMIT 1) AS peer_name,
              (SELECT u.picture_url FROM room_members m2 JOIN users u ON u.id = m2.user_id
                 WHERE m2.room_id = r.id AND m2.user_id <> ?1 LIMIT 1) AS peer_picture
       FROM room_members m JOIN rooms r ON r.id = m.room_id
       WHERE m.user_id = ?1
       ORDER BY COALESCE(r.last_message_at, r.created_at) DESC`,
    ).bind(c.user!.id).all<RoomListRow>(),
  );
  return ok({ rooms: rows.results.map(roomOut) });
}

function roomOut(r: RoomListRow) {
  return {
    id: r.id,
    type: r.type,
    title: r.type === 'dm' ? (r.peer_name ?? 'แชท 1:1') : (r.title ?? (r.type === 'channel' ? 'ชาเนล' : 'กลุ่ม')),
    picture: r.type === 'dm' ? r.peer_picture : null,
    lastSeq: r.last_seq,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    lastSenderName: r.last_sender_name,
    createdAt: r.created_at,
    unread: Math.max(0, r.last_seq - r.last_read_seq),
    myRole: r.my_role,
    // ปิดเสียงอยู่ไหม: ปิดตลอด หรือยังไม่ถึงเวลาเปิดเสียงเอง
    muted: r.muted === 1 && (r.muted_until === null || r.muted_until > nowThai()),
    mutedUntil: r.muted === 1 ? r.muted_until : null,
    pinned: r.pinned_seq ? { seq: r.pinned_seq, text: r.pinned_text, sender: r.pinned_sender, at: r.pinned_at } : null,
    visibility: r.visibility,
    description: r.description,
    canPost: r.type !== 'channel' || r.my_role === 'owner' || r.my_role === 'admin',
  };
}

async function activeUserIds(env: Env, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const found = new Set<string>();
  // แบ่งชุดละ 90 ตัว (D1 จำกัดจำนวนพารามิเตอร์ต่อคำสั่ง)
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rows = await db('ตรวจรายชื่อสมาชิก', () =>
      env.DB.prepare(
        `SELECT id FROM users WHERE status = 'active' AND id IN (${part.map(() => '?').join(',')})`,
      ).bind(...part).all<{ id: string }>(),
    );
    for (const r of rows.results) found.add(r.id);
  }
  return found;
}

/** เฟส 5: เพิ่มเข้ากลุ่มได้เฉพาะเพื่อน (ยกเว้นแอดมินระบบ + บอท) — ไม่ผ่านบอกจำนวนคนที่ติด */
async function requireContactable(env: Env, me: User, ids: string[]) {
  const okIds = await contactableIds(env, me, ids);
  const notFriends = ids.filter((x) => !okIds.has(x));
  if (notFriends.length) {
    throw new ApiError(403, 'NOT_FRIEND', `มี ${notFriends.length} คนที่ยังไม่ได้เป็นเพื่อนกับคุณ — เพิ่มเข้ากลุ่มได้เฉพาะเพื่อน (คนอื่นให้ใช้ลิงก์เชิญ)`);
  }
}

async function openDm(c: Ctx) {
  const body = await readJson<{ userId?: unknown }>(c.req);
  const peerId = body.userId;
  if (typeof peerId !== 'string' || !peerId) throw new ApiError(400, 'NO_USER', 'กรุณาเลือกคนที่จะคุยด้วย');
  if (peerId === c.user!.id) throw new ApiError(400, 'SELF', 'เปิดแชท 1:1 กับตัวเองไม่ได้');
  if (!(await activeUserIds(c.env, [peerId])).has(peerId)) {
    throw new ApiError(404, 'USER_NOT_ACTIVE', 'ไม่พบผู้ใช้นี้ หรือยังไม่ได้รับอนุมัติ');
  }
  // เฟส 5: ทักแชท 1:1 ได้เฉพาะเพื่อน (ยกเว้นแอดมินระบบ + บอท) — ห้องเดิมที่มีอยู่ก็ตรวจเหมือนกัน
  if (!(await contactableIds(c.env, c.user!, [peerId])).has(peerId)) {
    throw new ApiError(403, 'NOT_FRIEND', 'ยังไม่ได้เป็นเพื่อนกัน — ส่งคำขอเป็นเพื่อนก่อน แล้วรออีกฝ่ายกดยอมรับ');
  }
  const dmKey = [c.user!.id, peerId].sort().join(':');
  const existing = await db('หาแชท 1:1 เดิม', () =>
    c.env.DB.prepare(`SELECT id FROM rooms WHERE dm_key = ?`).bind(dmKey).first<{ id: string }>(),
  );
  if (existing) return ok({ roomId: existing.id, created: false });

  const id = newId();
  const now = nowThai();
  await db('สร้างแชท 1:1', () =>
    c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO rooms (id, type, title, dm_key, created_by, created_at) VALUES (?, 'dm', NULL, ?, ?, ?)`)
        .bind(id, dmKey, c.user!.id, now),
      c.env.DB.prepare(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
        .bind(id, c.user!.id, now),
      c.env.DB.prepare(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
        .bind(id, peerId, now),
    ]),
  );
  return ok({ roomId: id, created: true }, 201);
}

async function createGroup(c: Ctx) {
  const body = await readJson<{ title?: unknown; memberIds?: unknown }>(c.req);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 80) throw new ApiError(400, 'BAD_TITLE', 'ชื่อกลุ่มต้องมี 1–80 ตัวอักษร');
  if (!Array.isArray(body.memberIds) || body.memberIds.some((x) => typeof x !== 'string')) {
    throw new ApiError(400, 'BAD_MEMBERS', 'รายชื่อสมาชิกไม่ถูกต้อง');
  }
  const ids = [...new Set((body.memberIds as string[]).filter((x) => x !== c.user!.id))];
  if (ids.length < 1) throw new ApiError(400, 'NO_MEMBERS', 'กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
  if (ids.length > 999) throw new ApiError(400, 'TOO_MANY', 'สมาชิกเกิน 999 คน');
  const active = await activeUserIds(c.env, ids);
  const missing = ids.filter((x) => !active.has(x));
  if (missing.length) {
    throw new ApiError(400, 'MEMBERS_NOT_ACTIVE', `มีสมาชิก ${missing.length} คนที่ไม่พบหรือยังไม่ได้รับอนุมัติ`);
  }
  await requireContactable(c.env, c.user!, ids);

  const id = newId();
  const now = nowThai();
  const stmts = [
    c.env.DB.prepare(`INSERT INTO rooms (id, type, title, created_by, created_at) VALUES (?, 'group', ?, ?, ?)`)
      .bind(id, title, c.user!.id, now),
    c.env.DB.prepare(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`)
      .bind(id, c.user!.id, now),
    ...ids.map((uid) =>
      c.env.DB.prepare(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
        .bind(id, uid, now)),
  ];
  await db('สร้างกลุ่ม', () => c.env.DB.batch(stmts));
  return ok({ roomId: id }, 201);
}

async function getRoom(c: Ctx) {
  const { room } = await requireMember(c.env, c.params.id, c.user!.id);
  const members = await db('อ่านสมาชิกห้อง', () =>
    c.env.DB.prepare(
      `SELECT u.id, u.display_name, u.picture_url, m.role FROM room_members m JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ? ORDER BY m.role = 'owner' DESC, u.display_name`,
    ).bind(c.params.id).all<{ id: string; display_name: string; picture_url: string | null; role: string }>(),
  );
  return ok({
    room: roomOut(room),
    members: members.results.map((m) => ({ id: m.id, displayName: m.display_name, pictureUrl: m.picture_url, role: m.role })),
  });
}

async function addMembers(c: Ctx) {
  const { room, role } = await requireMember(c.env, c.params.id, c.user!.id);
  if (room.type === 'dm') throw new ApiError(400, 'NOT_GROUP', 'เพิ่มสมาชิกได้เฉพาะกลุ่มและชาเนล');
  if (role !== 'owner' && role !== 'admin') throw new ApiError(403, 'NOT_ROOM_ADMIN', 'เฉพาะเจ้าของ/แอดมินของห้องเท่านั้นที่เพิ่มสมาชิกได้');
  const body = await readJson<{ userIds?: unknown }>(c.req);
  if (!Array.isArray(body.userIds) || body.userIds.some((x) => typeof x !== 'string') || body.userIds.length === 0) {
    throw new ApiError(400, 'BAD_MEMBERS', 'กรุณาเลือกสมาชิกที่จะเพิ่ม');
  }
  const ids = [...new Set(body.userIds as string[])];
  const active = await activeUserIds(c.env, ids);
  const missing = ids.filter((x) => !active.has(x));
  if (missing.length) {
    throw new ApiError(400, 'MEMBERS_NOT_ACTIVE', `มีสมาชิก ${missing.length} คนที่ไม่พบหรือยังไม่ได้รับอนุมัติ`);
  }
  if (room.type === 'group') await requireContactable(c.env, c.user!, ids); // เฟส 5: กลุ่มเพิ่มได้เฉพาะเพื่อน (ชาเนลเหมือนเดิม)
  const now = nowThai();
  // คนใหม่เริ่มนับ "ยังไม่อ่าน" จากข้อความถัดไป
  await db('เพิ่มสมาชิกกลุ่ม', () =>
    c.env.DB.batch(ids.map((uid) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at, last_read_seq) VALUES (?, ?, 'member', ?, ?)`,
      ).bind(c.params.id, uid, now, room.last_seq))),
  );
  return ok({ added: ids.length });
}

const MUTE_FOR: Record<string, number | null> = { '1h': 3600_000, '8h': 8 * 3600_000, '2d': 2 * 86400_000, forever: null };

/** ปิดเสียงห้อง: { muted: true, for: '1h' | '8h' | '2d' | 'forever' } · เปิดเสียง: { muted: false } */
async function setMute(c: Ctx) {
  await requireMember(c.env, c.params.id, c.user!.id);
  const body = await readJson<{ muted?: unknown; for?: unknown }>(c.req);
  if (typeof body.muted !== 'boolean') throw new ApiError(400, 'BAD_MUTED', 'ค่าปิดเสียงต้องเป็น true หรือ false');
  const dur = typeof body.for === 'string' ? body.for : 'forever';
  if (body.muted && !(dur in MUTE_FOR)) throw new ApiError(400, 'BAD_DURATION', 'ระยะเวลาปิดเสียงต้องเป็น 1h, 8h, 2d หรือ forever');
  const ms = MUTE_FOR[dur];
  const until = body.muted && ms ? thaiAfter(ms) : null;
  await db('บันทึกการปิดเสียง', () =>
    c.env.DB.prepare(`UPDATE room_members SET muted = ?, muted_until = ? WHERE room_id = ? AND user_id = ?`)
      .bind(body.muted ? 1 : 0, until, c.params.id, c.user!.id).run(),
  );
  return ok({ muted: body.muted, mutedUntil: until });
}

// ---------- notify: ตั้งค่าแจ้งเตือนรวม ----------
const NOTIFY_KEYS = ['dm', 'groups', 'channels', 'show_preview', 'mentions_when_muted'] as const;
type NotifySettings = Record<(typeof NOTIFY_KEYS)[number], boolean>;

async function getNotifySettings(c: Ctx) {
  const r = await db('อ่านตั้งค่าแจ้งเตือน', () =>
    c.env.DB.prepare(`SELECT * FROM notify_settings WHERE user_id = ?`).bind(c.user!.id).first<Record<string, number>>(),
  );
  const out = Object.fromEntries(NOTIFY_KEYS.map((k) => [k, r ? r[k] === 1 : true])) as NotifySettings;
  return ok({ settings: out });
}

async function saveNotifySettings(c: Ctx) {
  const body = await readJson<Partial<Record<string, unknown>>>(c.req);
  for (const k of NOTIFY_KEYS) {
    if (typeof body[k] !== 'boolean') throw new ApiError(400, 'BAD_SETTINGS', `ค่า ${k} ต้องเป็น true หรือ false`);
  }
  const v = NOTIFY_KEYS.map((k) => (body[k] ? 1 : 0));
  await db('บันทึกตั้งค่าแจ้งเตือน', () =>
    c.env.DB.prepare(
      `INSERT INTO notify_settings (user_id, dm, groups, channels, show_preview, mentions_when_muted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET dm = excluded.dm, groups = excluded.groups, channels = excluded.channels,
         show_preview = excluded.show_preview, mentions_when_muted = excluded.mentions_when_muted, updated_at = excluded.updated_at`,
    ).bind(c.user!.id, ...v, nowThai()).run(),
  );
  return ok({ saved: true });
}

/** แอปเปิดอยู่ → ต่อ WebSocket กับ UserHub ของตัวเอง (แจ้งเตือนในแอป + ตัวเลขยังไม่อ่าน) */
async function openHub(c: Ctx) {
  if (c.req.headers.get('Upgrade') !== 'websocket') throw new ApiError(426, 'NOT_WEBSOCKET', 'ต้องเชื่อมต่อแบบ WebSocket');
  return c.env.HUB.get(c.env.HUB.idFromName(c.user!.id)).fetch(new Request('https://hub/ws', { headers: { Upgrade: 'websocket' } }));
}

/** ปักหมุด: { seq, notify } · เลิกปักหมุด: { seq: null } — กลุ่ม/ชาเนล เฉพาะเจ้าของ/แอดมินห้อง · แชท 1:1 ทั้งสองคน */
async function pinMessage(c: Ctx) {
  const { room, role } = await requireMember(c.env, c.params.id, c.user!.id);
  if (room.type !== 'dm' && role !== 'owner' && role !== 'admin') {
    throw new ApiError(403, 'NOT_ROOM_ADMIN', 'เฉพาะเจ้าของ/แอดมินของห้องเท่านั้นที่ปักหมุดได้');
  }
  const body = await readJson<{ seq?: unknown; notify?: unknown }>(c.req);
  const stub = roomStub(c.env, c.params.id);
  const now = nowThai();
  if (body.seq === null) {
    await db('เลิกปักหมุด', () =>
      c.env.DB.prepare(`UPDATE rooms SET pinned_seq = NULL, pinned_text = NULL, pinned_sender = NULL, pinned_by = NULL, pinned_at = NULL WHERE id = ?`)
        .bind(c.params.id).run(),
    );
  } else {
    if (typeof body.seq !== 'number' || !Number.isInteger(body.seq)) throw new ApiError(400, 'BAD_SEQ', 'ระบุข้อความที่จะปักหมุดไม่ถูกต้อง');
    const res = await stub.fetch(new Request(`https://room/message?seq=${body.seq}`, { headers: { 'X-Room-Id': c.params.id } }));
    const j = (await res.json()) as { ok: boolean; data?: { message: { senderName: string }; preview: string }; error?: { code: string; message: string } };
    if (!j.ok || !j.data) throw new ApiError(404, j.error?.code ?? 'MESSAGE_NOT_FOUND', j.error?.message ?? 'ไม่พบข้อความนี้');
    await db('ปักหมุดข้อความ', () =>
      c.env.DB.prepare(`UPDATE rooms SET pinned_seq = ?, pinned_text = ?, pinned_sender = ?, pinned_by = ?, pinned_at = ? WHERE id = ?`)
        .bind(body.seq, j.data!.preview.slice(0, 300), j.data!.message.senderName, c.user!.id, now, c.params.id).run(),
    );
    // เลือกแจ้งทุกคน → โพสต์ข้อความ "ปักหมุด" (คนในห้องได้แจ้งเตือนตามปกติ)
    if (body.notify === true) {
      await postToRoom(c.env, c.params.id, c.user!, { kind: 'text', body: `📌 ปักหมุด: ${j.data.preview.slice(0, 200)}` });
    }
  }
  // บอกคนที่เปิดห้องอยู่ให้โหลดแถบปักหมุดใหม่ (ไม่สำเร็จไม่เป็นไร — เปิดห้องใหม่ก็เห็น)
  try {
    await stub.fetch(new Request('https://room/broadcast', { method: 'POST', headers: { 'X-Room-Id': c.params.id } }));
  } catch (err) {
    console.error('แจ้งอัปเดตปักหมุดให้คนในห้องไม่สำเร็จ', err);
  }
  return ok({ pinned: body.seq ?? null });
}

// ---------- channels ----------
async function listChannels(c: Ctx) {
  const rows = await db('อ่านรายการชาเนล', () =>
    c.env.DB.prepare(
      `SELECT r.id, r.title, r.description, r.visibility, r.last_message_at, r.created_at,
              (SELECT COUNT(*) FROM room_members x WHERE x.room_id = r.id) AS member_count,
              (SELECT m.role FROM room_members m WHERE m.room_id = r.id AND m.user_id = ?1) AS my_role
       FROM rooms r
       WHERE r.type = 'channel'
         AND (r.visibility = 'public' OR EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = r.id AND m.user_id = ?1))
       ORDER BY COALESCE(r.last_message_at, r.created_at) DESC`,
    ).bind(c.user!.id).all<{
      id: string; title: string; description: string | null; visibility: 'public' | 'private';
      last_message_at: string | null; created_at: string; member_count: number; my_role: string | null;
    }>(),
  );
  return ok({
    channels: rows.results.map((r) => ({
      id: r.id, title: r.title, description: r.description, visibility: r.visibility,
      lastMessageAt: r.last_message_at, createdAt: r.created_at, memberCount: r.member_count, joined: r.my_role !== null, myRole: r.my_role,
    })),
  });
}

async function createChannel(c: Ctx) {
  const body = await readJson<{ title?: unknown; description?: unknown; visibility?: unknown; memberIds?: unknown }>(c.req);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 80) throw new ApiError(400, 'BAD_TITLE', 'ชื่อชาเนลต้องมี 1–80 ตัวอักษร');
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
  if (body.visibility !== 'public' && body.visibility !== 'private') {
    throw new ApiError(400, 'BAD_VISIBILITY', 'เลือกชนิดชาเนล: สาธารณะ หรือ ส่วนตัว');
  }
  const memberIds = Array.isArray(body.memberIds) ? [...new Set((body.memberIds as unknown[]).filter((x): x is string => typeof x === 'string'))] : [];
  const ids = memberIds.filter((x) => x !== c.user!.id);
  if (ids.length) {
    const active = await activeUserIds(c.env, ids);
    const missing = ids.filter((x) => !active.has(x));
    if (missing.length) throw new ApiError(400, 'MEMBERS_NOT_ACTIVE', `มีสมาชิก ${missing.length} คนที่ไม่พบหรือยังไม่ได้รับอนุมัติ`);
  }
  const id = newId();
  const now = nowThai();
  await db('สร้างชาเนล', () =>
    c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO rooms (id, type, title, description, visibility, created_by, created_at) VALUES (?, 'channel', ?, ?, ?, ?, ?)`,
      ).bind(id, title, description || null, body.visibility, c.user!.id, now),
      c.env.DB.prepare(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`)
        .bind(id, c.user!.id, now),
      ...ids.map((uid) =>
        c.env.DB.prepare(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
          .bind(id, uid, now)),
    ]),
  );
  return ok({ roomId: id }, 201);
}

async function joinChannel(c: Ctx) {
  const room = await db('อ่านข้อมูลชาเนล', () =>
    c.env.DB.prepare(`SELECT type, visibility, last_seq FROM rooms WHERE id = ?`).bind(c.params.id)
      .first<{ type: string; visibility: string | null; last_seq: number }>(),
  );
  if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'ไม่พบชาเนลนี้');
  if (room.type !== 'channel') throw new ApiError(400, 'NOT_CHANNEL', 'กดติดตามได้เฉพาะชาเนล');
  if (room.visibility !== 'public') throw new ApiError(403, 'PRIVATE_CHANNEL', 'ชาเนลส่วนตัว ต้องให้เจ้าของหรือแอดมินชาเนลเพิ่มให้');
  // คนใหม่เห็นโพสต์เก่าได้ แต่ไม่นับเป็น "ยังไม่อ่าน"
  await db('ติดตามชาเนล', () =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at, last_read_seq) VALUES (?, ?, 'member', ?, ?)`,
    ).bind(c.params.id, c.user!.id, nowThai(), room.last_seq).run(),
  );
  return ok({ joined: true });
}

async function leaveChannel(c: Ctx) {
  const { room, role } = await requireMember(c.env, c.params.id, c.user!.id);
  if (room.type !== 'channel') throw new ApiError(400, 'NOT_CHANNEL', 'เลิกติดตามได้เฉพาะชาเนล');
  if (role === 'owner') throw new ApiError(400, 'OWNER_CANNOT_LEAVE', 'เจ้าของชาเนลเลิกติดตามไม่ได้');
  await db('เลิกติดตามชาเนล', () =>
    c.env.DB.prepare(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`).bind(c.params.id, c.user!.id).run(),
  );
  return ok({ left: true });
}

/** เจ้าของชาเนล/กลุ่ม ตั้งหรือถอดแอดมินของห้อง */
async function setMemberRole(c: Ctx) {
  const { room, role } = await requireMember(c.env, c.params.id, c.user!.id);
  if (room.type === 'dm') throw new ApiError(400, 'NOT_GROUP', 'แชท 1:1 ไม่มีแอดมิน');
  if (role !== 'owner') throw new ApiError(403, 'NOT_OWNER', 'เฉพาะเจ้าของห้องเท่านั้นที่ตั้งแอดมินได้');
  const body = await readJson<{ role?: unknown }>(c.req);
  if (body.role !== 'admin' && body.role !== 'member') throw new ApiError(400, 'BAD_ROLE', 'ตำแหน่งต้องเป็น admin หรือ member');
  if (c.params.userId === c.user!.id) throw new ApiError(400, 'SELF', 'เปลี่ยนตำแหน่งตัวเองไม่ได้');
  const res = await db('เปลี่ยนตำแหน่งสมาชิก', () =>
    c.env.DB.prepare(`UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ? AND role <> 'owner'`)
      .bind(body.role, c.params.id, c.params.userId).run(),
  );
  if (res.meta.changes !== 1) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'ไม่พบสมาชิกคนนี้ในห้อง');
  return ok({ userId: c.params.userId, role: body.role });
}

// ---------- messages ----------
async function history(c: Ctx) {
  await requireMember(c.env, c.params.id, c.user!.id);
  const before = c.url.searchParams.get('before') ?? '';
  const limit = c.url.searchParams.get('limit') ?? String(HISTORY_LIMIT);
  const stub = roomStub(c.env, c.params.id);
  return stub.fetch(new Request(`https://room/history?before=${encodeURIComponent(before)}&limit=${encodeURIComponent(limit)}`, {
    headers: { 'X-Room-Id': c.params.id },
  }));
}

async function openSocket(c: Ctx) {
  if (c.req.headers.get('Upgrade') !== 'websocket') {
    throw new ApiError(426, 'NOT_WEBSOCKET', 'ต้องเชื่อมต่อแบบ WebSocket');
  }
  await requireMember(c.env, c.params.id, c.user!.id);
  const stub = roomStub(c.env, c.params.id);
  return stub.fetch(new Request('https://room/ws', {
    headers: {
      Upgrade: 'websocket',
      'X-Room-Id': c.params.id,
      'X-User-Id': c.user!.id,
      'X-User-Name': encodeURIComponent(c.user!.displayName),
    },
  }));
}

// ---------- files ----------
/**
 * อัปโหลด: body = ตัวไฟล์ดิบ (ไม่ใช่ form) · Content-Type = ชนิดไฟล์ · ต้องมี Content-Length
 * หัวเพิ่ม: X-File-Kind (image/file/voice), X-File-Name (encodeURIComponent), X-Width, X-Height, X-Duration-Ms
 * ลำดับ: เขียน R2 → บันทึก D1 (ไม่สำเร็จ → ลบไฟล์ใน R2 คืน แล้วตอบ error)
 */
async function uploadFile(c: Ctx) {
  const { room, role } = await requireMember(c.env, c.params.id, c.user!.id);
  requirePoster(room.type, role);
  const h = c.req.headers;
  const kind = h.get('X-File-Kind') as FileKind | null;
  if (kind !== 'image' && kind !== 'file' && kind !== 'voice') {
    throw new ApiError(400, 'BAD_KIND', 'ชนิดไฟล์ต้องเป็น image, file หรือ voice');
  }
  const size = Number(h.get('Content-Length'));
  if (!Number.isFinite(size) || size <= 0) throw new ApiError(411, 'NO_LENGTH', 'ไม่ทราบขนาดไฟล์ หรือไฟล์ว่าง');
  if (size > MAX_BYTES[kind]) {
    throw new ApiError(413, 'TOO_LARGE', `ไฟล์ใหญ่เกิน ${Math.round(MAX_BYTES[kind] / 1024 / 1024)}MB`);
  }
  const mime = (h.get('Content-Type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (kind === 'image' && !IMAGE_MIMES.includes(mime)) {
    throw new ApiError(415, 'BAD_IMAGE_TYPE', 'รองรับเฉพาะรูป JPG, PNG, WEBP, GIF — ชนิดอื่นให้ "ส่งเป็นไฟล์"');
  }
  if (kind === 'voice' && !VOICE_MIMES.includes(mime)) {
    throw new ApiError(415, 'BAD_VOICE_TYPE', `ชนิดไฟล์เสียงไม่รองรับ (${mime})`);
  }
  let name: string;
  try {
    name = decodeURIComponent(h.get('X-File-Name') || '').trim();
  } catch {
    throw new ApiError(400, 'BAD_NAME', 'ชื่อไฟล์ไม่ถูกต้อง');
  }
  if (!name) name = kind === 'voice' ? 'ข้อความเสียง' : kind === 'image' ? 'รูปภาพ' : 'ไฟล์';
  name = name.replace(/[\\/\r\n\t]/g, '_').slice(0, 200);
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);
  const width = num(h.get('X-Width'));
  const height = num(h.get('X-Height'));
  const durationMs = num(h.get('X-Duration-Ms'));
  if (kind === 'voice' && durationMs !== null && durationMs > (MAX_VOICE_SECONDS + 5) * 1000) {
    throw new ApiError(413, 'TOO_LONG', `ข้อความเสียงยาวเกิน ${MAX_VOICE_SECONDS / 60} นาที`);
  }
  if (!c.req.body) throw new ApiError(400, 'NO_BODY', 'ไม่พบตัวไฟล์ที่ส่งมา');

  const id = newId();
  const key = `rooms/${c.params.id}/${id}`;
  try {
    await c.env.FILES.put(key, c.req.body, { httpMetadata: { contentType: mime } });
  } catch (err) {
    console.error('เขียนไฟล์ลง R2 ไม่สำเร็จ', err);
    throw new ApiError(502, 'R2_FAILED', 'อัปโหลดไฟล์ไม่สำเร็จ (ที่เก็บไฟล์ขัดข้องหรือเน็ตหลุดระหว่างอัป) กรุณาลองใหม่');
  }

  const now = nowThai();
  const expiresAt = thaiAfter(FILE_RETENTION_DAYS * 86400_000);
  try {
    await c.env.DB.prepare(
      `INSERT INTO files (id, room_id, uploader_id, r2_key, kind, mime, name, size, width, height, duration_ms,
                          status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
    ).bind(id, c.params.id, c.user!.id, key, kind, mime, name, size, width, height, durationMs, now, expiresAt).run();
  } catch (err) {
    console.error('บันทึกไฟล์ลง D1 ไม่สำเร็จ', err);
    try {
      await c.env.FILES.delete(key);
    } catch (delErr) {
      console.error('ลบไฟล์ที่ค้างใน R2 ไม่สำเร็จ (cron จะไม่เห็นเพราะไม่มีแถวใน D1)', key, delErr);
    }
    throw new ApiError(500, 'DB_FAILED', 'บันทึกข้อมูลไฟล์ไม่สำเร็จ กรุณาลองใหม่');
  }
  return ok({ fileId: id, name, size, mime, expiresAt }, 201);
}

/** เปิด/ดาวน์โหลดไฟล์ — สมาชิกห้องเท่านั้น · รองรับ Range (iPhone ต้องใช้ตอนเล่นเสียง) */
async function downloadFile(c: Ctx) {
  const f = await db('อ่านข้อมูลไฟล์', () =>
    c.env.DB.prepare(`SELECT room_id, r2_key, kind, mime, name, status, expires_at FROM files WHERE id = ?`)
      .bind(c.params.fileId)
      .first<{ room_id: string; r2_key: string; kind: FileKind; mime: string; name: string; status: string; expires_at: string }>(),
  );
  if (!f) throw new ApiError(404, 'FILE_NOT_FOUND', 'ไม่พบไฟล์นี้');
  await requireMember(c.env, f.room_id, c.user!.id);
  if (f.status === 'expired' || f.expires_at < nowThai()) {
    throw new ApiError(410, 'FILE_EXPIRED', `ไฟล์หมดอายุแล้ว (เก็บไว้ ${FILE_RETENTION_DAYS} วัน)`);
  }

  let obj: R2ObjectBody | R2Object | null;
  try {
    obj = await c.env.FILES.get(f.r2_key, { range: c.req.headers, onlyIf: c.req.headers });
  } catch (err) {
    console.error('อ่านไฟล์จาก R2 ไม่สำเร็จ', err);
    throw new ApiError(502, 'R2_FAILED', 'เปิดไฟล์ไม่สำเร็จ (ที่เก็บไฟล์ขัดข้อง) กรุณาลองใหม่');
  }
  if (!obj) throw new ApiError(404, 'FILE_MISSING', 'ไม่พบตัวไฟล์ในที่เก็บ (อาจถูกลบไปแล้ว)');

  const headers = new Headers();
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=86400');
  headers.set('X-Content-Type-Options', 'nosniff');
  // ไฟล์ทั่วไปบังคับดาวน์โหลด และไม่ให้เบราว์เซอร์ตีความเป็นหน้าเว็บ (กันไฟล์ HTML/SVG ฝังสคริปต์)
  if (f.kind === 'file') {
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  } else {
    headers.set('Content-Type', f.mime);
    headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  }
  if (!('body' in obj)) return new Response(null, { status: 304, headers }); // ไม่เปลี่ยน (If-None-Match)

  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && c.req.headers.has('Range')) {
    const offset = range.offset ?? (range.suffix !== undefined ? obj.size - range.suffix : 0);
    const length = range.length ?? obj.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

// ---------- push ----------
async function pushKey(c: Ctx) {
  try {
    return ok({ publicKey: (await getVapidKeys(c.env)).publicKey });
  } catch (err) {
    console.error('สร้าง/อ่านกุญแจ VAPID ไม่สำเร็จ', err);
    throw new ApiError(500, 'VAPID_FAILED', 'เตรียมระบบแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่');
  }
}

async function pushSubscribe(c: Ctx) {
  const body = await readJson<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; label?: unknown }>(c.req);
  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) {
    throw new ApiError(400, 'BAD_ENDPOINT', 'ข้อมูลเครื่องรับแจ้งเตือนไม่ถูกต้อง (endpoint)');
  }
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) {
    throw new ApiError(400, 'BAD_KEYS', 'ข้อมูลเครื่องรับแจ้งเตือนไม่ถูกต้อง (keys)');
  }
  const label = typeof body.label === 'string' ? body.label.slice(0, 80) : null;
  const now = nowThai();
  // เครื่องเดิม (endpoint เดิม) → อัปเดตเจ้าของ/กุญแจ แทนการเพิ่มซ้ำ
  await db('บันทึกเครื่องรับแจ้งเตือน', () =>
    c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, device_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         device_label = excluded.device_label, last_error = NULL, fail_count = 0`,
    ).bind(newId(), c.user!.id, endpoint, p256dh, auth, label, now).run(),
  );
  return ok({ subscribed: true });
}

async function pushUnsubscribe(c: Ctx) {
  const body = await readJson<{ endpoint?: unknown; id?: unknown }>(c.req);
  if (typeof body.endpoint !== 'string' && typeof body.id !== 'string') {
    throw new ApiError(400, 'BAD_DEVICE', 'ระบุเครื่องที่จะยกเลิก');
  }
  const res = await db('ยกเลิกเครื่องรับแจ้งเตือน', () =>
    (typeof body.id === 'string'
      ? c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?`).bind(body.id, c.user!.id)
      : c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`).bind(body.endpoint, c.user!.id)
    ).run(),
  );
  return ok({ removed: res.meta.changes });
}

async function pushDevices(c: Ctx) {
  const rows = await db('อ่านรายการเครื่อง', () =>
    c.env.DB.prepare(
      `SELECT id, endpoint, device_label, created_at, last_success_at, last_error, last_error_at, fail_count
       FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC`,
    ).bind(c.user!.id).all<{
      id: string; endpoint: string; device_label: string | null; created_at: string; last_success_at: string | null;
      last_error: string | null; last_error_at: string | null; fail_count: number;
    }>(),
  );
  return ok({
    devices: rows.results.map((r) => ({
      id: r.id, endpoint: r.endpoint, label: r.device_label, createdAt: r.created_at, lastSuccessAt: r.last_success_at,
      lastError: r.last_error, lastErrorAt: r.last_error_at, failCount: r.fail_count,
    })),
  });
}

/** ส่งแจ้งเตือนทดสอบถึงทุกเครื่องของตัวเอง (ส่งตรง ไม่ผ่าน Queue) → ตอบผลพร้อมเหตุผลทันที */
async function pushTest(c: Ctx) {
  let r: { sent: number; failed: number; errors: string[] };
  try {
    r = await sendToUsers(c.env, [c.user!.id], {
      title: 'ทดสอบแจ้งเตือน', body: `ระบบแจ้งเตือนใช้งานได้ (${nowThai().slice(11, 16)} น.)`, url: '/settings', tag: 'test',
    });
  } catch (err) {
    console.error('ส่งแจ้งเตือนทดสอบไม่สำเร็จ', err);
    throw new ApiError(500, 'PUSH_FAILED', 'ส่งแจ้งเตือนทดสอบไม่สำเร็จ (ระบบขัดข้อง)');
  }
  if (r.sent === 0 && r.failed === 0) throw new ApiError(400, 'NO_DEVICE', 'ยังไม่มีเครื่องที่เปิดรับแจ้งเตือน');
  return ok(r);
}

// ---------- bots (แอดมิน) ----------
type BotRow = {
  id: string; display_name: string; picture_url: string | null; token_hint: string; webhook_url: string | null;
  webhook_secret: string; enabled: number; created_at: string; last_delivery_at: string | null;
  last_error: string | null; last_error_at: string | null; fail_count: number; notify_scope: 'contacted' | 'all';
};
const botOut = (b: BotRow) => ({
  notifyScope: b.notify_scope,
  id: b.id, name: b.display_name, tokenHint: b.token_hint, webhookUrl: b.webhook_url, webhookSecret: b.webhook_secret,
  enabled: b.enabled === 1, createdAt: b.created_at, lastDeliveryAt: b.last_delivery_at, lastError: b.last_error,
  lastErrorAt: b.last_error_at, failCount: b.fail_count,
});

function checkWebhookUrl(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || v.length > 500) throw new ApiError(400, 'BAD_WEBHOOK', 'webhook URL ไม่ถูกต้อง');
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ApiError(400, 'BAD_WEBHOOK', 'webhook URL ไม่ถูกต้อง');
  }
  if (u.protocol !== 'https:') throw new ApiError(400, 'BAD_WEBHOOK', 'webhook URL ต้องขึ้นต้นด้วย https://');
  return u.toString();
}

function checkBotName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!/^[\p{L}\p{M}\p{N}_ .-]{2,40}$/u.test(name)) {
    throw new ApiError(400, 'BAD_NAME', 'ชื่อบอทต้องมี 2–40 ตัวอักษร (ตัวอักษร ตัวเลข _ . - เว้นวรรค)');
  }
  return name;
}

const newBotToken = () => `bot_${randomToken(32)}`;

async function adminListBots(c: Ctx) {
  const rows = await db('อ่านรายการบอท', () =>
    c.env.DB.prepare(
      `SELECT b.*, u.display_name, u.picture_url FROM bots b JOIN users u ON u.id = b.id ORDER BY b.created_at DESC`,
    ).all<BotRow>(),
  );
  return ok({ bots: rows.results.map(botOut) });
}

async function adminCreateBot(c: Ctx) {
  const body = await readJson<{ name?: unknown; webhookUrl?: unknown }>(c.req);
  const name = checkBotName(body.name);
  const webhookUrl = checkWebhookUrl(body.webhookUrl);
  const id = newId();
  const token = newBotToken();
  const now = nowThai();
  await db('สร้างบอท', async () =>
    c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, line_user_id, display_name, picture_url, status, role, is_bot, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'active', 'member', 1, ?, ?)`,
      ).bind(id, `bot:${id}`, name, now, now),
      c.env.DB.prepare(
        `INSERT INTO bots (id, token_hash, token_hint, webhook_url, webhook_secret, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, await sha256(token), token.slice(-4), webhookUrl, randomToken(24), c.user!.id, now),
    ]),
  );
  // token เต็มแสดงครั้งเดียว — ระบบเก็บแค่ hash
  return ok({ id, token }, 201);
}

async function adminUpdateBot(c: Ctx) {
  const body = await readJson<{ name?: unknown; webhookUrl?: unknown; enabled?: unknown; notifyScope?: unknown }>(c.req);
  const stmts: D1PreparedStatement[] = [];
  if (body.notifyScope !== undefined) {
    if (body.notifyScope !== 'contacted' && body.notifyScope !== 'all') {
      throw new ApiError(400, 'BAD_SCOPE', 'ขอบเขตแจ้งเตือนต้องเป็น contacted หรือ all');
    }
    stmts.push(c.env.DB.prepare(`UPDATE bots SET notify_scope = ? WHERE id = ?`).bind(body.notifyScope, c.params.id));
  }
  if (body.name !== undefined) {
    stmts.push(c.env.DB.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ? AND is_bot = 1`)
      .bind(checkBotName(body.name), nowThai(), c.params.id));
  }
  if (body.webhookUrl !== undefined) {
    stmts.push(c.env.DB.prepare(`UPDATE bots SET webhook_url = ? WHERE id = ?`).bind(checkWebhookUrl(body.webhookUrl), c.params.id));
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'BAD_ENABLED', 'ค่าเปิด/ปิดต้องเป็น true หรือ false');
    stmts.push(c.env.DB.prepare(`UPDATE bots SET enabled = ? WHERE id = ?`).bind(body.enabled ? 1 : 0, c.params.id));
  }
  if (stmts.length === 0) throw new ApiError(400, 'NOTHING', 'ไม่มีข้อมูลที่จะแก้');
  const exists = await db('หาบอท', () => c.env.DB.prepare(`SELECT 1 AS x FROM bots WHERE id = ?`).bind(c.params.id).first());
  if (!exists) throw new ApiError(404, 'BOT_NOT_FOUND', 'ไม่พบบอทนี้');
  await db('แก้ไขบอท', () => c.env.DB.batch(stmts));
  return ok({ id: c.params.id });
}

async function adminRegenToken(c: Ctx) {
  const token = newBotToken();
  const res = await db('สร้าง token ใหม่', async () =>
    c.env.DB.prepare(`UPDATE bots SET token_hash = ?, token_hint = ? WHERE id = ?`)
      .bind(await sha256(token), token.slice(-4), c.params.id).run(),
  );
  if (res.meta.changes !== 1) throw new ApiError(404, 'BOT_NOT_FOUND', 'ไม่พบบอทนี้');
  return ok({ id: c.params.id, token });
}

/** ส่งข้อความทดสอบไป webhook ของบอททันที แล้วบอกผลพร้อมเหตุผล */
async function adminTestWebhook(c: Ctx) {
  const r = await deliverWebhook(c.env, c.params.id, {
    type: 'test', message: { body: `ทดสอบจากหน้าแอดมิน (${nowThai().slice(11, 16)} น.)` },
  });
  if (r === 'skip') throw new ApiError(400, 'NO_WEBHOOK', 'บอทนี้ยังไม่ได้ใส่ webhook URL หรือถูกปิดอยู่');
  if (r === 'retry') {
    const b = await db('อ่านผลส่ง', () => c.env.DB.prepare(`SELECT last_error FROM bots WHERE id = ?`).bind(c.params.id).first<{ last_error: string }>());
    throw new ApiError(502, 'WEBHOOK_FAILED', `ส่งไม่สำเร็จ: ${b?.last_error ?? 'ไม่ทราบสาเหตุ'}`);
  }
  return ok({ delivered: true });
}

// ---------- bot-api ----------
async function botMe(c: Ctx) {
  return ok({ id: c.user!.id, name: c.user!.displayName });
}

async function botRooms(c: Ctx) {
  const rows = await db('อ่านห้องของบอท', () =>
    c.env.DB.prepare(
      `SELECT r.id, r.type, r.title, m.role FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.user_id = ? ORDER BY r.created_at`,
    ).bind(c.user!.id).all<{ id: string; type: string; title: string | null; role: string }>(),
  );
  return ok({ rooms: rows.results });
}

/** ส่งข้อความเข้าห้องในนามผู้ส่ง ผ่าน Durable Object (ตรวจสิทธิ์ซ้ำในห้อง) → คืนผลหรือ ApiError พร้อมเหตุผล */
async function postToRoom(env: Env, roomId: string, sender: User, p: { kind: string; body: string; extra?: unknown }) {
  const res = await roomStub(env, roomId).fetch(new Request('https://room/post', {
    method: 'POST',
    headers: { 'X-Room-Id': roomId, 'content-type': 'application/json' },
    body: JSON.stringify({ senderId: sender.id, senderName: sender.displayName, ...p }),
  }));
  const json = (await res.json()) as { ok: boolean; data?: { message: unknown; warnings: string[] }; error?: { code: string; message: string } };
  if (!json.ok) throw new ApiError(res.status, json.error?.code ?? 'SEND_FAILED', json.error?.message ?? 'ส่งข้อความไม่สำเร็จ');
  return json.data!;
}

async function botSendMessage(c: Ctx) {
  const body = await readJson<{ roomId?: unknown; text?: unknown; silent?: unknown }>(c.req);
  if (typeof body.roomId !== 'string') throw new ApiError(400, 'NO_ROOM', 'ต้องระบุ roomId');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new ApiError(400, 'EMPTY', 'ต้องระบุ text');
  await requireMember(c.env, body.roomId, c.user!.id);
  return ok(await postToRoom(c.env, body.roomId, c.user!, { kind: 'text', body: body.text, extra: body.silent === true ? { silent: true } : undefined }));
}

async function botSendForm(c: Ctx) {
  const body = await readJson<{ roomId?: unknown; formId?: unknown; text?: unknown; silent?: unknown }>(c.req);
  if (typeof body.roomId !== 'string') throw new ApiError(400, 'NO_ROOM', 'ต้องระบุ roomId');
  if (typeof body.formId !== 'string') throw new ApiError(400, 'NO_FORM', 'ต้องระบุ formId');
  await requireMember(c.env, body.roomId, c.user!.id);
  return ok(await postToRoom(c.env, body.roomId, c.user!, {
    kind: 'form', body: typeof body.text === 'string' ? body.text : '',
    extra: { formId: body.formId, ...(body.silent === true ? { silent: true } : {}) },
  }));
}

/**
 * บอทส่งแจ้งเตือนหาผู้ใช้โดยตรง: { userIds: [...], text, silent? } (ไม่เกิน 100 คนต่อครั้ง)
 * ส่งเป็นข้อความในแชท 1:1 กับบอท → ผู้รับได้แจ้งเตือนตามกติกาปกติ
 * notify_scope = contacted → ส่งได้เฉพาะคนที่มีแชท 1:1 กับบอทอยู่แล้ว · all → สร้างแชท 1:1 ให้ถ้ายังไม่มี
 * คืนผลรายคน: sent / failed + เหตุผล
 */
async function botNotify(c: Ctx) {
  const body = await readJson<{ userIds?: unknown; text?: unknown; silent?: unknown }>(c.req);
  if (!Array.isArray(body.userIds) || body.userIds.length === 0 || body.userIds.some((x) => typeof x !== 'string')) {
    throw new ApiError(400, 'NO_USERS', 'ต้องระบุ userIds เป็นรายการรหัสผู้ใช้');
  }
  const userIds = [...new Set(body.userIds as string[])];
  if (userIds.length > 100) throw new ApiError(400, 'TOO_MANY', 'ส่งได้ไม่เกิน 100 คนต่อครั้ง');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new ApiError(400, 'EMPTY', 'ต้องระบุ text');
  const bot = c.user!;
  const cfg = await db('อ่านขอบเขตบอท', () =>
    c.env.DB.prepare(`SELECT notify_scope FROM bots WHERE id = ?`).bind(bot.id).first<{ notify_scope: 'contacted' | 'all' }>(),
  );
  const active = await activeUserIds(c.env, userIds);
  const sent: { userId: string; roomId: string }[] = [];
  const failed: { userId: string; code: string; reason: string }[] = [];
  for (const uid of userIds) {
    if (!active.has(uid)) { failed.push({ userId: uid, code: 'USER_NOT_ACTIVE', reason: 'ไม่พบผู้ใช้ หรือยังไม่ได้รับอนุมัติ' }); continue; }
    const dmKey = [bot.id, uid].sort().join(':');
    let room = await db('หาแชทกับบอท', () => c.env.DB.prepare(`SELECT id FROM rooms WHERE dm_key = ?`).bind(dmKey).first<{ id: string }>());
    if (!room) {
      if (cfg?.notify_scope !== 'all') {
        failed.push({ userId: uid, code: 'NOT_CONTACTED', reason: 'ผู้ใช้ยังไม่เคยแชทกับบอทนี้ (บอทตั้งให้ส่งได้เฉพาะคนที่เคยคุยแล้ว)' });
        continue;
      }
      const id = newId();
      const now = nowThai();
      await db('สร้างแชทกับบอท', () =>
        c.env.DB.batch([
          c.env.DB.prepare(`INSERT INTO rooms (id, type, title, dm_key, created_by, created_at) VALUES (?, 'dm', NULL, ?, ?, ?)`).bind(id, dmKey, bot.id, now),
          c.env.DB.prepare(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`).bind(id, bot.id, now),
          c.env.DB.prepare(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`).bind(id, uid, now),
        ]),
      );
      room = { id };
    }
    try {
      await postToRoom(c.env, room.id, bot, { kind: 'text', body: body.text, extra: body.silent === true ? { silent: true } : undefined });
      sent.push({ userId: uid, roomId: room.id });
    } catch (err) {
      failed.push({ userId: uid, code: err instanceof ApiError ? err.code : 'SEND_FAILED', reason: err instanceof Error ? err.message : 'ส่งไม่สำเร็จ' });
    }
  }
  return ok({ sent, failed });
}

async function botOrders(c: Ctx) {
  const status = c.url.searchParams.get('status');
  if (status && !(status in ORDER_STATUS_TH)) throw new ApiError(400, 'BAD_STATUS', 'สถานะไม่ถูกต้อง');
  // บอทเห็นเฉพาะออเดอร์ของฟอร์มที่ผูกกับบอทตัวนี้
  const rows = await db('อ่านออเดอร์', () =>
    c.env.DB.prepare(
      `${ORDER_SELECT} WHERE f.bot_id = ? ${status ? 'AND o.status = ?' : ''} ORDER BY o.id DESC LIMIT 200`,
    ).bind(...(status ? [c.user!.id, status] : [c.user!.id])).all<OrderRow>(),
  );
  return ok({ orders: rows.results.map(orderOut) });
}

async function botSetOrderStatus(c: Ctx) {
  const own = await db('ตรวจออเดอร์ของบอท', () =>
    c.env.DB.prepare(`SELECT 1 AS x FROM orders o JOIN forms f ON f.id = o.form_id WHERE o.id = ? AND f.bot_id = ?`)
      .bind(Number(c.params.orderId), c.user!.id).first(),
  );
  if (!own) throw new ApiError(404, 'ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้ หรือไม่ใช่ออเดอร์ของฟอร์มที่ผูกกับบอทนี้');
  return setOrderStatus(c, c.user!);
}

// ---------- forms ----------
type FormRow = {
  id: string; title: string; description: string | null; fields_json: string; bot_id: string | null; active: number;
  created_at: string; updated_at: string;
};
const formOut = (f: FormRow) => ({
  id: f.id, title: f.title, description: f.description, fields: JSON.parse(f.fields_json) as FormField[],
  botId: f.bot_id, active: f.active === 1, createdAt: f.created_at, updatedAt: f.updated_at,
});

async function adminListForms(c: Ctx) {
  const rows = await db('อ่านรายการฟอร์ม', () => c.env.DB.prepare(`SELECT * FROM forms ORDER BY updated_at DESC`).all<FormRow>());
  return ok({ forms: rows.results.map(formOut) });
}

/** สร้าง (ไม่มี formId) หรือแก้ฟอร์ม — ตรวจโครงด้วย checkFormDef ก่อนบันทึก */
async function adminSaveForm(c: Ctx) {
  const body = await readJson<{ title?: unknown; description?: unknown; fields?: unknown; botId?: unknown; active?: unknown }>(c.req);
  const errs = checkFormDef(body.title, body.fields);
  if (errs.length) throw new ApiError(400, 'BAD_FORM', errs.join(' · '));
  const fields = (body.fields as FormField[]).map((f) => ({
    id: f.id, label: f.label.trim(), type: f.type, required: f.required,
    ...(f.type === 'select' ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
    ...(f.type === 'number' && typeof f.min === 'number' ? { min: f.min } : {}),
    ...(f.type === 'number' && typeof f.max === 'number' ? { max: f.max } : {}),
  }));
  const botId = typeof body.botId === 'string' && body.botId ? body.botId : null;
  if (botId) {
    const b = await db('ตรวจบอท', () => c.env.DB.prepare(`SELECT 1 AS x FROM bots WHERE id = ?`).bind(botId).first());
    if (!b) throw new ApiError(400, 'BOT_NOT_FOUND', 'ไม่พบบอทที่เลือกให้รับออเดอร์');
  }
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : null;
  const active = body.active === false ? 0 : 1;
  const now = nowThai();
  if (c.params.formId) {
    const res = await db('แก้ฟอร์ม', () =>
      c.env.DB.prepare(`UPDATE forms SET title = ?, description = ?, fields_json = ?, bot_id = ?, active = ?, updated_at = ? WHERE id = ?`)
        .bind((body.title as string).trim(), description, JSON.stringify(fields), botId, active, now, c.params.formId).run(),
    );
    if (res.meta.changes !== 1) throw new ApiError(404, 'FORM_NOT_FOUND', 'ไม่พบฟอร์มนี้');
    return ok({ id: c.params.formId });
  }
  const id = newId();
  await db('สร้างฟอร์ม', () =>
    c.env.DB.prepare(
      `INSERT INTO forms (id, title, description, fields_json, bot_id, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, (body.title as string).trim(), description, JSON.stringify(fields), botId, active, c.user!.id, now, now).run(),
  );
  return ok({ id }, 201);
}

async function loadForm(env: Env, formId: string) {
  const f = await db('อ่านฟอร์ม', () => env.DB.prepare(`SELECT * FROM forms WHERE id = ?`).bind(formId).first<FormRow>());
  if (!f) throw new ApiError(404, 'FORM_NOT_FOUND', 'ไม่พบฟอร์มนี้');
  return formOut(f);
}

async function getForm(c: Ctx) {
  const f = await loadForm(c.env, c.params.formId);
  return ok({ form: { id: f.id, title: f.title, description: f.description, fields: f.fields, active: f.active } });
}

async function submitForm(c: Ctx) {
  const body = await readJson<{ roomId?: unknown; values?: unknown }>(c.req);
  if (typeof body.roomId !== 'string') throw new ApiError(400, 'NO_ROOM', 'ไม่ทราบว่ากรอกจากห้องไหน');
  await requireMember(c.env, body.roomId, c.user!.id);
  const form = await loadForm(c.env, c.params.formId);
  if (!form.active) throw new ApiError(400, 'FORM_INACTIVE', 'ฟอร์มนี้ปิดรับแล้ว');
  const { values, errors } = checkSubmission(form.fields, body.values);
  if (Object.keys(errors).length) {
    const msg = form.fields.filter((f) => errors[f.id]).map((f) => `${f.label}: ${errors[f.id]}`).join(' · ');
    throw new ApiError(400, 'BAD_VALUES', msg);
  }
  const now = nowThai();
  const snapshot = { title: form.title, fields: form.fields };
  const row = await db('บันทึกออเดอร์', () =>
    c.env.DB.prepare(
      `INSERT INTO orders (form_id, room_id, user_id, data_json, form_snapshot, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'new', ?, ?) RETURNING id`,
    ).bind(form.id, body.roomId, c.user!.id, JSON.stringify(values), JSON.stringify(snapshot), now, now).first<{ id: number }>(),
  );
  if (!row) throw new ApiError(500, 'DB_FAILED', 'บันทึกออเดอร์ไม่สำเร็จ');
  const warnings: string[] = [];
  // ข้อความในห้องให้ร้านเห็น (ส่งในนามลูกค้า) — ไม่สำเร็จไม่ยกเลิกออเดอร์ แต่บอกให้รู้
  try {
    await postToRoom(c.env, body.roomId, c.user!, {
      kind: 'text', body: `📝 ส่งออเดอร์ #${row.id} (${form.title}) แล้ว`, extra: { orderId: row.id },
    });
  } catch (err) {
    console.error('โพสต์ข้อความแจ้งออเดอร์ในห้องไม่สำเร็จ', err);
    warnings.push(`บันทึกออเดอร์แล้ว แต่โพสต์ข้อความแจ้งในห้องไม่สำเร็จ (${err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ'})`);
  }
  if (form.botId) await queueOrderEvent(c.env, form.botId, 'order', row.id, warnings);
  return ok({ orderId: row.id, warnings }, 201);
}

// ---------- orders ----------
const ORDER_SELECT = `SELECT o.*, u.display_name AS user_name, r.title AS room_title, f.bot_id
  FROM orders o JOIN users u ON u.id = o.user_id JOIN rooms r ON r.id = o.room_id JOIN forms f ON f.id = o.form_id`;
type OrderRow = {
  id: number; form_id: string; room_id: string; user_id: string; data_json: string; form_snapshot: string;
  status: OrderStatus; status_note: string | null; created_at: string; updated_at: string; user_name: string; room_title: string | null;
};
function orderOut(o: OrderRow) {
  const snap = JSON.parse(o.form_snapshot) as { title: string; fields: FormField[] };
  const data = JSON.parse(o.data_json) as Record<string, string | number>;
  return {
    id: o.id, formId: o.form_id, formTitle: snap.title, roomId: o.room_id, roomTitle: o.room_title,
    userId: o.user_id, userName: o.user_name, status: o.status, statusText: ORDER_STATUS_TH[o.status], statusNote: o.status_note,
    items: snap.fields.map((f) => ({ id: f.id, label: f.label, value: data[f.id] ?? null })),
    createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

async function listOrders(c: Ctx) {
  const status = c.url.searchParams.get('status');
  if (status && !(status in ORDER_STATUS_TH)) throw new ApiError(400, 'BAD_STATUS', 'สถานะไม่ถูกต้อง');
  const isAdmin = c.user!.role === 'admin';
  const where: string[] = [];
  const binds: unknown[] = [];
  if (!isAdmin) { where.push('o.user_id = ?'); binds.push(c.user!.id); } // ผู้ใช้ทั่วไปเห็นเฉพาะของตัวเอง
  if (status) { where.push('o.status = ?'); binds.push(status); }
  const rows = await db('อ่านออเดอร์', () =>
    c.env.DB.prepare(`${ORDER_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 300`)
      .bind(...binds).all<OrderRow>(),
  );
  return ok({ orders: rows.results.map(orderOut), isAdmin });
}

async function adminSetOrderStatus(c: Ctx) {
  return setOrderStatus(c, c.user!);
}

/** เปลี่ยนสถานะ → บันทึก → แจ้งลูกค้าในห้องเดิม (ลูกค้าได้แจ้งเตือนตามปกติ) → ส่งให้บอทของฟอร์ม */
async function setOrderStatus(c: Ctx, actor: User) {
  const body = await readJson<{ status?: unknown; note?: unknown }>(c.req);
  if (typeof body.status !== 'string' || !(body.status in ORDER_STATUS_TH)) {
    throw new ApiError(400, 'BAD_STATUS', 'สถานะต้องเป็น new, in_progress, done หรือ cancelled');
  }
  const status = body.status as OrderStatus;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null;
  const id = Number(c.params.orderId);
  const order = await db('อ่านออเดอร์', () =>
    c.env.DB.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(id).first<OrderRow & { bot_id: string | null }>(),
  );
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้');
  await db('เปลี่ยนสถานะออเดอร์', () =>
    c.env.DB.prepare(`UPDATE orders SET status = ?, status_note = ?, updated_at = ? WHERE id = ?`).bind(status, note, nowThai(), id).run(),
  );
  const warnings: string[] = [];
  try {
    await postToRoom(c.env, order.room_id, actor, {
      kind: 'text', body: `📦 ออเดอร์ #${id}: ${ORDER_STATUS_TH[status]}${note ? ` — ${note}` : ''}`, extra: { orderId: id },
    });
  } catch (err) {
    console.error('แจ้งสถานะออเดอร์ในห้องไม่สำเร็จ', err);
    warnings.push(`เปลี่ยนสถานะแล้ว แต่แจ้งลูกค้าในห้องไม่สำเร็จ (${err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ'})`);
  }
  if (order.bot_id && !actor.isBot) await queueOrderEvent(c.env, order.bot_id, 'order_status', id, warnings);
  return ok({ id, status, warnings });
}

/** ส่งเหตุการณ์ออเดอร์ให้บอทของฟอร์ม (ผ่าน Queue → webhook) */
async function queueOrderEvent(env: Env, botId: string, type: 'order' | 'order_status', orderId: number, warnings: string[]) {
  try {
    const o = await env.DB.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(orderId).first<OrderRow>();
    if (!o) return;
    await env.PUSH_QUEUE.send({ type: 'webhook', botId, update: { type, order: orderOut(o) } });
  } catch (err) {
    console.error('ส่งออเดอร์ให้บอทไม่สำเร็จ', err);
    warnings.push('บันทึกแล้ว แต่ส่งข้อมูลออเดอร์ให้บอทไม่สำเร็จ');
  }
}

// ---------- invites ----------
const INVITE_EXPIRY: Record<string, number | null> = { '1d': 1, '7d': 7, '30d': 30, never: null };

/** สร้าง/ดู/ยกเลิกลิงก์ได้เฉพาะเจ้าของหรือแอดมินของกลุ่ม/ชาเนล */
async function requireRoomAdmin(c: Ctx) {
  const { room, role } = await requireMember(c.env, c.params.id, c.user!.id);
  if (room.type === 'dm') throw new ApiError(400, 'NOT_GROUP', 'แชท 1:1 ใช้ลิงก์เชิญไม่ได้');
  if (role !== 'owner' && role !== 'admin') throw new ApiError(403, 'NOT_ROOM_ADMIN', 'เฉพาะเจ้าของ/แอดมินของห้องเท่านั้นที่จัดการลิงก์เชิญได้');
  return room;
}

async function listInvites(c: Ctx) {
  await requireRoomAdmin(c);
  const links = await db('อ่านลิงก์เชิญ', () =>
    c.env.DB.prepare(
      `SELECT i.*, u.display_name AS creator_name FROM invite_links i JOIN users u ON u.id = i.created_by
       WHERE i.room_id = ? ORDER BY i.created_at DESC`,
    ).bind(c.params.id).all<InviteRow & { creator_name: string }>(),
  );
  const uses = await db('อ่านคนที่เข้าผ่านลิงก์', () =>
    c.env.DB.prepare(
      `SELECT iu.code, iu.used_at, u.display_name FROM invite_uses iu JOIN invite_links i ON i.code = iu.code
       JOIN users u ON u.id = iu.user_id WHERE i.room_id = ? ORDER BY iu.used_at DESC`,
    ).bind(c.params.id).all<{ code: string; used_at: string; display_name: string }>(),
  );
  return ok({
    invites: links.results.map((i) => ({
      code: i.code, url: `${c.env.APP_URL}/join/${i.code}`, createdBy: i.creator_name, createdAt: i.created_at,
      expiresAt: i.expires_at, maxUses: i.max_uses, useCount: i.use_count, revokedAt: i.revoked_at,
      problem: inviteProblem(i)?.message ?? null,
      joined: uses.results.filter((u) => u.code === i.code).map((u) => ({ name: u.display_name, at: u.used_at })),
    })),
  });
}

async function createInvite(c: Ctx) {
  await requireRoomAdmin(c);
  const body = await readJson<{ expiresIn?: unknown; maxUses?: unknown }>(c.req);
  const expiresIn = typeof body.expiresIn === 'string' ? body.expiresIn : '7d';
  if (!(expiresIn in INVITE_EXPIRY)) throw new ApiError(400, 'BAD_EXPIRY', 'อายุลิงก์ต้องเป็น 1d, 7d, 30d หรือ never');
  let maxUses: number | null = null;
  if (body.maxUses !== null && body.maxUses !== undefined && body.maxUses !== '') {
    const n = Number(body.maxUses);
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new ApiError(400, 'BAD_MAX_USES', 'จำนวนคนต้องเป็นจำนวนเต็ม 1–10,000 (หรือเว้นว่าง = ไม่จำกัด)');
    maxUses = n;
  }
  const days = INVITE_EXPIRY[expiresIn];
  const code = randomToken(9); // 12 ตัวอักษร
  const now = nowThai();
  await db('สร้างลิงก์เชิญ', () =>
    c.env.DB.prepare(
      `INSERT INTO invite_links (code, room_id, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(code, c.params.id, c.user!.id, now, days ? thaiAfter(days * 86400_000) : null, maxUses).run(),
  );
  return ok({ code, url: `${c.env.APP_URL}/join/${code}` }, 201);
}

async function revokeInvite(c: Ctx) {
  await requireRoomAdmin(c);
  const res = await db('ยกเลิกลิงก์เชิญ', () =>
    c.env.DB.prepare(`UPDATE invite_links SET revoked_at = ? WHERE code = ? AND room_id = ? AND revoked_at IS NULL`)
      .bind(nowThai(), c.params.code, c.params.id).run(),
  );
  if (res.meta.changes !== 1) throw new ApiError(404, 'INVITE_NOT_FOUND', 'ไม่พบลิงก์นี้ หรือถูกยกเลิกไปแล้ว');
  return ok({ revoked: true });
}

/** ข้อมูลห้องของลิงก์ (ไม่ต้องล็อกอิน) — แสดงในหน้า /join ก่อนกดเข้าร่วม */
async function inviteInfo(c: Ctx) {
  const inv = await loadInvite(c.env, c.params.code);
  const problem = inviteProblem(inv);
  if (!inv) return ok({ valid: false, problem: problem!.message, problemCode: problem!.code });
  const room = await db('อ่านห้องของลิงก์', () =>
    c.env.DB.prepare(
      `SELECT r.type, r.title, r.description, (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS member_count
       FROM rooms r WHERE r.id = ?`,
    ).bind(inv.room_id).first<{ type: string; title: string | null; description: string | null; member_count: number }>(),
  );
  if (!room) return ok({ valid: false, problem: 'ห้องของลิงก์นี้ไม่มีแล้ว', problemCode: 'INVITE_NOT_FOUND' });
  return ok({
    valid: !problem, problem: problem?.message ?? null, problemCode: problem?.code ?? null,
    room: { type: room.type, title: room.title ?? (room.type === 'channel' ? 'ชาเนล' : 'กลุ่ม'), description: room.description, memberCount: room.member_count },
    expiresAt: inv.expires_at,
  });
}

async function joinByInvite(c: Ctx) {
  const r = await redeemInvite(c.env, c.params.code, c.user!);
  return ok(r);
}

// =====================================================================
// 3. ตัวช่วยเรื่องห้อง
// =====================================================================
// เฟส 5 — ค่าที่ผู้ใช้เลือก · เพื่อน · สติกเกอร์ · โน้ต
// =====================================================================

// ---------- prefs: ธีม + ขนาดตัวอักษร (จำต่อบัญชี) ----------
const THEMES = ['system', 'light', 'dark'] as const;

async function getPrefs(c: Ctx) {
  const r = await db('อ่านค่าที่เลือกไว้', () =>
    c.env.DB.prepare(`SELECT theme, font_level FROM user_prefs WHERE user_id = ?`).bind(c.user!.id)
      .first<{ theme: string; font_level: number }>(),
  );
  return ok({ prefs: { theme: r?.theme ?? 'system', fontLevel: r?.font_level ?? 3 } });
}

async function savePrefs(c: Ctx) {
  const body = await readJson<{ theme?: unknown; fontLevel?: unknown }>(c.req);
  if (typeof body.theme !== 'string' || !(THEMES as readonly string[]).includes(body.theme)) {
    throw new ApiError(400, 'BAD_THEME', 'ธีมต้องเป็น system, light หรือ dark');
  }
  if (typeof body.fontLevel !== 'number' || !Number.isInteger(body.fontLevel) || body.fontLevel < 1 || body.fontLevel > 5) {
    throw new ApiError(400, 'BAD_FONT_LEVEL', 'ขนาดตัวอักษรต้องเป็นระดับ 1–5');
  }
  await db('บันทึกธีม/ขนาดตัวอักษร', () =>
    c.env.DB.prepare(
      `INSERT INTO user_prefs (user_id, theme, font_level, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, font_level = excluded.font_level, updated_at = excluded.updated_at`,
    ).bind(c.user!.id, body.theme, body.fontLevel, nowThai()).run(),
  );
  return ok({ prefs: { theme: body.theme, fontLevel: body.fontLevel } });
}

// ---------- friends: ส่งคำขอ → อีกฝ่ายกดยอมรับ · ปฏิเสธ/ยกเลิก/เลิกเป็นเพื่อน = ลบแถว ----------
type FriendRow = {
  id: string; display_name: string; picture_url: string | null;
  status: 'pending' | 'accepted'; requested_by: string; created_at: string; accepted_at: string | null;
};

async function listFriends(c: Ctx) {
  const me = c.user!.id;
  const rows = await db('อ่านรายชื่อเพื่อน', () =>
    c.env.DB.prepare(
      `SELECT u.id, u.display_name, u.picture_url, f.status, f.requested_by, f.created_at, f.accepted_at
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_low = ?1 THEN f.user_high ELSE f.user_low END
       WHERE (f.user_low = ?1 OR f.user_high = ?1) AND u.status = 'active'
       ORDER BY u.display_name`,
    ).bind(me).all<FriendRow>(),
  );
  const out = (r: FriendRow) => ({ id: r.id, displayName: r.display_name, pictureUrl: r.picture_url, since: r.accepted_at ?? r.created_at });
  return ok({
    friends: rows.results.filter((r) => r.status === 'accepted').map(out),
    incoming: rows.results.filter((r) => r.status === 'pending' && r.requested_by !== me).map(out),
    outgoing: rows.results.filter((r) => r.status === 'pending' && r.requested_by === me).map(out),
  });
}

async function readFriendship(env: Env, a: string, b: string) {
  const [low, high] = friendPair(a, b);
  return db('อ่านสถานะเพื่อน', () =>
    env.DB.prepare(`SELECT status, requested_by FROM friendships WHERE user_low = ? AND user_high = ?`)
      .bind(low, high).first<{ status: 'pending' | 'accepted'; requested_by: string }>(),
  );
}

async function requestFriend(c: Ctx) {
  const body = await readJson<{ userId?: unknown }>(c.req);
  const peerId = body.userId;
  if (typeof peerId !== 'string' || !peerId) throw new ApiError(400, 'NO_USER', 'กรุณาเลือกคนที่จะเพิ่มเป็นเพื่อน');
  if (peerId === c.user!.id) throw new ApiError(400, 'SELF', 'เพิ่มตัวเองเป็นเพื่อนไม่ได้');
  const peer = await db('อ่านข้อมูลผู้ใช้', () =>
    c.env.DB.prepare(`SELECT id, status, is_bot FROM users WHERE id = ?`).bind(peerId)
      .first<{ id: string; status: string; is_bot: number }>(),
  );
  if (!peer || peer.status !== 'active') throw new ApiError(404, 'USER_NOT_ACTIVE', 'ไม่พบผู้ใช้นี้ หรือยังไม่ได้รับอนุมัติ');
  if (peer.is_bot) throw new ApiError(400, 'IS_BOT', 'บอทไม่ต้องเพิ่มเป็นเพื่อน — ทักแชทได้เลย');

  const cur = await readFriendship(c.env, c.user!.id, peerId);
  if (cur?.status === 'accepted') throw new ApiError(409, 'ALREADY_FRIEND', 'เป็นเพื่อนกันอยู่แล้ว');
  if (cur && cur.requested_by === c.user!.id) throw new ApiError(409, 'ALREADY_REQUESTED', 'ส่งคำขอไปแล้ว รออีกฝ่ายกดยอมรับ');
  const [low, high] = friendPair(c.user!.id, peerId);
  const now = nowThai();
  if (cur) {
    // อีกฝ่ายส่งคำขอมาก่อนแล้ว → ถือว่ายอมรับเลย
    await db('ยอมรับคำขอเป็นเพื่อน', () =>
      c.env.DB.prepare(`UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_low = ? AND user_high = ?`)
        .bind(now, low, high).run(),
    );
    return ok({ status: 'accepted' });
  }
  await db('ส่งคำขอเป็นเพื่อน', () =>
    c.env.DB.prepare(
      `INSERT INTO friendships (user_low, user_high, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)`,
    ).bind(low, high, c.user!.id, now).run(),
  );
  // แจ้งอีกฝ่าย — ส่งไม่ถึงไม่ทำให้คำขอล้ม (คำขอบันทึกแล้ว) แต่บอกผู้ส่งว่าแจ้งเตือนได้หรือไม่
  let notified = false;
  try {
    const r = await sendToUsers(c.env, [peerId], {
      title: 'คำขอเป็นเพื่อน', body: `${c.user!.displayName} ขอเป็นเพื่อนกับคุณ`, url: '/friends', tag: 'friend-requests',
    });
    notified = r.sent > 0;
  } catch (err) {
    console.error('แจ้งเตือนคำขอเป็นเพื่อนไม่สำเร็จ', err);
  }
  return ok({ status: 'pending', notified }, 201);
}

async function acceptFriend(c: Ctx) {
  const cur = await readFriendship(c.env, c.user!.id, c.params.userId);
  if (!cur) throw new ApiError(404, 'NO_REQUEST', 'ไม่พบคำขอเป็นเพื่อนนี้ (อาจถูกยกเลิกแล้ว)');
  if (cur.status === 'accepted') throw new ApiError(409, 'ALREADY_FRIEND', 'เป็นเพื่อนกันอยู่แล้ว');
  if (cur.requested_by === c.user!.id) throw new ApiError(400, 'OWN_REQUEST', 'คำขอนี้คุณเป็นคนส่ง รออีกฝ่ายกดยอมรับ');
  const [low, high] = friendPair(c.user!.id, c.params.userId);
  const r = await db('ยอมรับคำขอเป็นเพื่อน', () =>
    c.env.DB.prepare(
      `UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_low = ? AND user_high = ? AND status = 'pending'`,
    ).bind(nowThai(), low, high).run(),
  );
  if (r.meta.changes !== 1) throw new ApiError(409, 'CHANGED', 'สถานะคำขอเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่');
  return ok({ status: 'accepted' });
}

/** ปฏิเสธคำขอ / ยกเลิกคำขอที่ส่งไป / เลิกเป็นเพื่อน (แชท 1:1 เดิมยังอ่านได้ แต่ส่งต่อไม่ได้) */
async function removeFriend(c: Ctx) {
  const cur = await readFriendship(c.env, c.user!.id, c.params.userId);
  if (!cur) throw new ApiError(404, 'NOT_FRIEND', 'ไม่ได้เป็นเพื่อนหรือมีคำขอค้างกับผู้ใช้นี้');
  const [low, high] = friendPair(c.user!.id, c.params.userId);
  await db('ลบความเป็นเพื่อน', () =>
    c.env.DB.prepare(`DELETE FROM friendships WHERE user_low = ? AND user_high = ?`).bind(low, high).run(),
  );
  const was = cur.status === 'accepted' ? 'unfriended' : cur.requested_by === c.user!.id ? 'cancelled' : 'declined';
  return ok({ removed: was });
}

// ---------- stickers: แอดมินระบบเพิ่มชุด/ภาพ · ทุกคนส่งได้ · ภาพเก็บถาวร (ไม่ลบตาม 180 วัน) ----------
const STICKER_MIMES = ['image/png', 'image/webp', 'image/gif'];
const STICKER_MAX_BYTES = 512 * 1024;

type PackRow = { id: string; name: string; active: number; sort: number };
type StickerRow = { id: string; pack_id: string; mime: string; size: number; sort: number; active: number };

async function loadStickerPacks(env: Env, onlyActive: boolean) {
  const packs = await db('อ่านชุดสติกเกอร์', () =>
    env.DB.prepare(`SELECT id, name, active, sort FROM sticker_packs ${onlyActive ? 'WHERE active = 1' : ''} ORDER BY sort, created_at`)
      .all<PackRow>(),
  );
  const stickers = await db('อ่านสติกเกอร์', () =>
    env.DB.prepare(`SELECT id, pack_id, mime, size, sort, active FROM stickers ${onlyActive ? 'WHERE active = 1' : ''} ORDER BY sort, created_at`)
      .all<StickerRow>(),
  );
  return packs.results.map((p) => ({
    id: p.id, name: p.name, active: p.active === 1,
    stickers: stickers.results.filter((s) => s.pack_id === p.id).map((s) => ({ id: s.id, active: s.active === 1, size: s.size })),
  }));
}

async function listStickers(c: Ctx) {
  return ok({ packs: (await loadStickerPacks(c.env, true)).filter((p) => p.stickers.length > 0) });
}

/** ภาพสติกเกอร์ — สติกเกอร์ที่ปิดใช้แล้วยังเปิดได้ (ข้อความเก่าในแชทต้องแสดงได้) */
async function stickerImage(c: Ctx) {
  const s = await db('อ่านสติกเกอร์', () =>
    c.env.DB.prepare(`SELECT r2_key, mime FROM stickers WHERE id = ?`).bind(c.params.stickerId).first<{ r2_key: string; mime: string }>(),
  );
  if (!s) throw new ApiError(404, 'STICKER_NOT_FOUND', 'ไม่พบสติกเกอร์นี้');
  let obj: R2ObjectBody | null;
  try {
    obj = await c.env.FILES.get(s.r2_key);
  } catch (err) {
    console.error('อ่านสติกเกอร์จาก R2 ไม่สำเร็จ', err);
    throw new ApiError(502, 'R2_FAILED', 'เปิดสติกเกอร์ไม่สำเร็จ (ที่เก็บไฟล์ขัดข้อง)');
  }
  if (!obj) throw new ApiError(404, 'STICKER_MISSING', 'ไม่พบภาพสติกเกอร์ในที่เก็บ');
  return new Response(obj.body, {
    headers: {
      'Content-Type': s.mime, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable', // ภาพสติกเกอร์ไม่เปลี่ยน (เปลี่ยน = ไอดีใหม่)
    },
  });
}

async function adminListStickers(c: Ctx) {
  return ok({ packs: await loadStickerPacks(c.env, false) });
}

function packName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (name.length < 1 || name.length > 40) throw new ApiError(400, 'BAD_NAME', 'ชื่อชุดสติกเกอร์ต้องมี 1–40 ตัวอักษร');
  return name;
}

async function adminCreatePack(c: Ctx) {
  const body = await readJson<{ name?: unknown }>(c.req);
  const id = newId();
  await db('สร้างชุดสติกเกอร์', () =>
    c.env.DB.prepare(`INSERT INTO sticker_packs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`)
      .bind(id, packName(body.name), c.user!.id, nowThai()).run(),
  );
  return ok({ packId: id }, 201);
}

async function adminUpdatePack(c: Ctx) {
  const body = await readJson<{ name?: unknown; active?: unknown }>(c.req);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(packName(body.name)); }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw new ApiError(400, 'BAD_ACTIVE', 'ค่าเปิดใช้ต้องเป็น true หรือ false');
    sets.push('active = ?'); vals.push(body.active ? 1 : 0);
  }
  if (!sets.length) throw new ApiError(400, 'NOTHING', 'ไม่มีอะไรให้แก้');
  const r = await db('แก้ชุดสติกเกอร์', () =>
    c.env.DB.prepare(`UPDATE sticker_packs SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, c.params.packId).run(),
  );
  if (r.meta.changes !== 1) throw new ApiError(404, 'PACK_NOT_FOUND', 'ไม่พบชุดสติกเกอร์นี้');
  return ok({ updated: true });
}

/** อัปภาพสติกเกอร์: body = ภาพดิบ · Content-Type = image/png, image/webp หรือ image/gif · ไม่เกิน 512 KB */
async function adminUploadSticker(c: Ctx) {
  const pack = await db('อ่านชุดสติกเกอร์', () =>
    c.env.DB.prepare(`SELECT id FROM sticker_packs WHERE id = ?`).bind(c.params.packId).first(),
  );
  if (!pack) throw new ApiError(404, 'PACK_NOT_FOUND', 'ไม่พบชุดสติกเกอร์นี้');
  const mime = (c.req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!STICKER_MIMES.includes(mime)) throw new ApiError(415, 'BAD_STICKER_TYPE', 'สติกเกอร์รองรับเฉพาะ PNG, WEBP, GIF');
  const size = Number(c.req.headers.get('Content-Length'));
  if (!Number.isFinite(size) || size <= 0) throw new ApiError(411, 'NO_LENGTH', 'ไม่ทราบขนาดไฟล์ หรือไฟล์ว่าง');
  if (size > STICKER_MAX_BYTES) throw new ApiError(413, 'TOO_LARGE', 'ภาพสติกเกอร์ต้องไม่เกิน 512 KB');
  if (!c.req.body) throw new ApiError(400, 'NO_BODY', 'ไม่พบตัวไฟล์ที่ส่งมา');

  const id = newId();
  const key = `stickers/${c.params.packId}/${id}`;
  try {
    await c.env.FILES.put(key, c.req.body, { httpMetadata: { contentType: mime } });
  } catch (err) {
    console.error('เขียนสติกเกอร์ลง R2 ไม่สำเร็จ', err);
    throw new ApiError(502, 'R2_FAILED', 'อัปโหลดสติกเกอร์ไม่สำเร็จ กรุณาลองใหม่');
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO stickers (id, pack_id, r2_key, mime, size, sort, created_at)
       VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM stickers WHERE pack_id = ?), ?)`,
    ).bind(id, c.params.packId, key, mime, size, c.params.packId, nowThai()).run();
  } catch (err) {
    console.error('บันทึกสติกเกอร์ลง D1 ไม่สำเร็จ', err);
    try {
      await c.env.FILES.delete(key);
    } catch (delErr) {
      console.error('ลบสติกเกอร์ที่ค้างใน R2 ไม่สำเร็จ', key, delErr);
    }
    throw new ApiError(500, 'DB_FAILED', 'บันทึกสติกเกอร์ไม่สำเร็จ กรุณาลองใหม่');
  }
  return ok({ stickerId: id }, 201);
}

async function adminUpdateSticker(c: Ctx) {
  const body = await readJson<{ active?: unknown }>(c.req);
  if (typeof body.active !== 'boolean') throw new ApiError(400, 'BAD_ACTIVE', 'ค่าเปิดใช้ต้องเป็น true หรือ false');
  const r = await db('แก้สติกเกอร์', () =>
    c.env.DB.prepare(`UPDATE stickers SET active = ? WHERE id = ?`).bind(body.active ? 1 : 0, c.params.stickerId).run(),
  );
  if (r.meta.changes !== 1) throw new ApiError(404, 'STICKER_NOT_FOUND', 'ไม่พบสติกเกอร์นี้');
  return ok({ updated: true });
}

// ---------- notes: โน้ตในห้อง (สมาชิกเห็นทุกคน + คอมเมนต์) และโน้ตส่วนตัว ----------
const NOTE_MAX = 5000;
const COMMENT_MAX = 1000;
const MY_NOTE_MAX = 10000;

function noteText(v: unknown, max: number, what: string): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) throw new ApiError(400, 'EMPTY', `${what}ว่าง บันทึกไม่ได้`);
  if (t.length > max) throw new ApiError(400, 'TOO_LONG', `${what}ยาวเกิน ${max.toLocaleString('th-TH')} ตัวอักษร`);
  return t;
}

type NoteRow = {
  id: string; room_id: string; author_id: string; author_name: string; author_picture: string | null;
  body: string; created_at: string; updated_at: string; comments: number;
};
const noteOut = (n: NoteRow) => ({
  id: n.id, roomId: n.room_id, authorId: n.author_id, authorName: n.author_name, authorPicture: n.author_picture,
  body: n.body, createdAt: n.created_at, updatedAt: n.updated_at, comments: n.comments,
});
const NOTE_SELECT = `SELECT n.id, n.room_id, n.author_id, u.display_name AS author_name, u.picture_url AS author_picture,
                            n.body, n.created_at, n.updated_at,
                            (SELECT COUNT(*) FROM note_comments k WHERE k.note_id = n.id) AS comments
                     FROM room_notes n JOIN users u ON u.id = n.author_id`;

async function listRoomNotes(c: Ctx) {
  await requireMember(c.env, c.params.id, c.user!.id);
  const rows = await db('อ่านโน้ตในห้อง', () =>
    c.env.DB.prepare(`${NOTE_SELECT} WHERE n.room_id = ? ORDER BY n.created_at DESC LIMIT 200`).bind(c.params.id).all<NoteRow>(),
  );
  return ok({ notes: rows.results.map(noteOut) });
}

async function createRoomNote(c: Ctx) {
  const { room, role } = await requireMember(c.env, c.params.id, c.user!.id);
  requirePoster(room.type, role); // ชาเนล: เฉพาะเจ้าของ/แอดมินชาเนลสร้างโน้ตได้
  const body = await readJson<{ body?: unknown }>(c.req);
  const text = noteText(body.body, NOTE_MAX, 'โน้ต');
  const id = newId();
  const now = nowThai();
  await db('บันทึกโน้ต', () =>
    c.env.DB.prepare(`INSERT INTO room_notes (id, room_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, c.params.id, c.user!.id, text, now, now).run(),
  );
  // แจ้งในห้องว่ามีโน้ตใหม่ (แบบ LINE) — โน้ตบันทึกแล้ว ถ้าแจ้งไม่สำเร็จให้ตอบคำเตือนพร้อมเหตุผล
  const firstLine = text.split('\n')[0].slice(0, 80);
  let warning: string | null = null;
  try {
    await postToRoom(c.env, c.params.id, c.user!, { kind: 'text', body: `📝 โน้ตใหม่: ${firstLine}`, extra: { noteId: id } });
  } catch (err) {
    console.error('แจ้งโน้ตใหม่ในห้องไม่สำเร็จ', err);
    warning = `บันทึกโน้ตแล้ว แต่แจ้งในห้องไม่สำเร็จ: ${err instanceof ApiError ? err.message : 'ระบบขัดข้อง'}`;
  }
  return ok({ noteId: id, warning }, 201);
}

/** โหลดโน้ต + ตรวจว่าเป็นสมาชิกห้องของโน้ต · canManage = ผู้เขียน หรือเจ้าของ/แอดมินห้อง */
async function loadNote(c: Ctx) {
  const n = await db('อ่านโน้ต', () =>
    c.env.DB.prepare(`${NOTE_SELECT} WHERE n.id = ?`).bind(c.params.noteId).first<NoteRow>(),
  );
  if (!n) throw new ApiError(404, 'NOTE_NOT_FOUND', 'ไม่พบโน้ตนี้ (อาจถูกลบแล้ว)');
  const { role } = await requireMember(c.env, n.room_id, c.user!.id);
  const roomAdmin = role === 'owner' || role === 'admin';
  return { note: n, roomAdmin, canManage: n.author_id === c.user!.id || roomAdmin };
}

async function getNote(c: Ctx) {
  const { note, roomAdmin, canManage } = await loadNote(c);
  const comments = await db('อ่านคอมเมนต์', () =>
    c.env.DB.prepare(
      `SELECT k.id, k.author_id, u.display_name AS author_name, u.picture_url AS author_picture, k.body, k.created_at
       FROM note_comments k JOIN users u ON u.id = k.author_id WHERE k.note_id = ? ORDER BY k.created_at`,
    ).bind(note.id).all<{ id: string; author_id: string; author_name: string; author_picture: string | null; body: string; created_at: string }>(),
  );
  return ok({
    note: { ...noteOut(note), canManage },
    comments: comments.results.map((k) => ({
      id: k.id, authorId: k.author_id, authorName: k.author_name, authorPicture: k.author_picture, body: k.body, createdAt: k.created_at,
      canDelete: k.author_id === c.user!.id || roomAdmin,
    })),
  });
}

async function updateNote(c: Ctx) {
  const { note, canManage } = await loadNote(c);
  if (!canManage) throw new ApiError(403, 'NOT_NOTE_OWNER', 'แก้ได้เฉพาะผู้เขียนโน้ต หรือเจ้าของ/แอดมินห้อง');
  const body = await readJson<{ body?: unknown }>(c.req);
  const text = noteText(body.body, NOTE_MAX, 'โน้ต');
  await db('แก้โน้ต', () =>
    c.env.DB.prepare(`UPDATE room_notes SET body = ?, updated_at = ? WHERE id = ?`).bind(text, nowThai(), note.id).run(),
  );
  return ok({ updated: true });
}

async function deleteNote(c: Ctx) {
  const { note, canManage } = await loadNote(c);
  if (!canManage) throw new ApiError(403, 'NOT_NOTE_OWNER', 'ลบได้เฉพาะผู้เขียนโน้ต หรือเจ้าของ/แอดมินห้อง');
  await db('ลบโน้ต', () => c.env.DB.prepare(`DELETE FROM room_notes WHERE id = ?`).bind(note.id).run());
  return ok({ deleted: true });
}

async function addNoteComment(c: Ctx) {
  const { note } = await loadNote(c);
  const body = await readJson<{ body?: unknown }>(c.req);
  const text = noteText(body.body, COMMENT_MAX, 'คอมเมนต์');
  const id = newId();
  await db('บันทึกคอมเมนต์', () =>
    c.env.DB.prepare(`INSERT INTO note_comments (id, note_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, note.id, c.user!.id, text, nowThai()).run(),
  );
  return ok({ commentId: id }, 201);
}

async function deleteNoteComment(c: Ctx) {
  const k = await db('อ่านคอมเมนต์', () =>
    c.env.DB.prepare(`SELECT k.author_id, n.room_id FROM note_comments k JOIN room_notes n ON n.id = k.note_id WHERE k.id = ?`)
      .bind(c.params.commentId).first<{ author_id: string; room_id: string }>(),
  );
  if (!k) throw new ApiError(404, 'COMMENT_NOT_FOUND', 'ไม่พบคอมเมนต์นี้');
  const { role } = await requireMember(c.env, k.room_id, c.user!.id);
  if (k.author_id !== c.user!.id && role !== 'owner' && role !== 'admin') {
    throw new ApiError(403, 'NOT_COMMENT_OWNER', 'ลบได้เฉพาะผู้เขียนคอมเมนต์ หรือเจ้าของ/แอดมินห้อง');
  }
  await db('ลบคอมเมนต์', () => c.env.DB.prepare(`DELETE FROM note_comments WHERE id = ?`).bind(c.params.commentId).run());
  return ok({ deleted: true });
}

async function listMyNotes(c: Ctx) {
  const rows = await db('อ่านโน้ตส่วนตัว', () =>
    c.env.DB.prepare(`SELECT id, body, created_at, updated_at FROM user_notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500`)
      .bind(c.user!.id).all<{ id: string; body: string; created_at: string; updated_at: string }>(),
  );
  return ok({ notes: rows.results.map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at, updatedAt: n.updated_at })) });
}

async function createMyNote(c: Ctx) {
  const body = await readJson<{ body?: unknown }>(c.req);
  const text = noteText(body.body, MY_NOTE_MAX, 'โน้ต');
  const id = newId();
  const now = nowThai();
  await db('บันทึกโน้ตส่วนตัว', () =>
    c.env.DB.prepare(`INSERT INTO user_notes (id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, c.user!.id, text, now, now).run(),
  );
  return ok({ noteId: id }, 201);
}

async function updateMyNote(c: Ctx) {
  const body = await readJson<{ body?: unknown }>(c.req);
  const text = noteText(body.body, MY_NOTE_MAX, 'โน้ต');
  const r = await db('แก้โน้ตส่วนตัว', () =>
    c.env.DB.prepare(`UPDATE user_notes SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(text, nowThai(), c.params.noteId, c.user!.id).run(),
  );
  if (r.meta.changes !== 1) throw new ApiError(404, 'NOTE_NOT_FOUND', 'ไม่พบโน้ตนี้ (อาจถูกลบแล้ว)');
  return ok({ updated: true });
}

async function deleteMyNote(c: Ctx) {
  const r = await db('ลบโน้ตส่วนตัว', () =>
    c.env.DB.prepare(`DELETE FROM user_notes WHERE id = ? AND user_id = ?`).bind(c.params.noteId, c.user!.id).run(),
  );
  if (r.meta.changes !== 1) throw new ApiError(404, 'NOTE_NOT_FOUND', 'ไม่พบโน้ตนี้ (อาจถูกลบแล้ว)');
  return ok({ deleted: true });
}

// =====================================================================
/** ชาเนล: โพสต์ได้เฉพาะเจ้าของ/แอดมินชาเนล (ห้องอื่นสมาชิกทุกคนโพสต์ได้) */
function requirePoster(type: string, role: string) {
  if (type === 'channel' && role !== 'owner' && role !== 'admin') {
    throw new ApiError(403, 'NOT_CHANNEL_ADMIN', 'ชาเนลนี้โพสต์ได้เฉพาะเจ้าของและแอดมินชาเนล');
  }
}

function roomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
}

async function requireMember(env: Env, roomId: string, userId: string) {
  const row = await db('ตรวจสิทธิ์ในห้อง', () =>
    env.DB.prepare(
      `SELECT r.id, r.type, r.title, r.last_seq, r.last_message_at, r.last_message_preview, r.last_sender_name,
              r.created_at, r.visibility, r.description, m.last_read_seq, m.role AS my_role, m.muted, m.muted_until,
              r.pinned_seq, r.pinned_text, r.pinned_sender, r.pinned_at,
              (SELECT u.display_name FROM room_members m2 JOIN users u ON u.id = m2.user_id
                 WHERE m2.room_id = r.id AND m2.user_id <> ?2 LIMIT 1) AS peer_name,
              (SELECT u.picture_url FROM room_members m2 JOIN users u ON u.id = m2.user_id
                 WHERE m2.room_id = r.id AND m2.user_id <> ?2 LIMIT 1) AS peer_picture
       FROM rooms r LEFT JOIN room_members m ON m.room_id = r.id AND m.user_id = ?2
       WHERE r.id = ?1`,
    ).bind(roomId, userId).first<RoomListRow & { my_role: string | null }>(),
  );
  if (!row) throw new ApiError(404, 'ROOM_NOT_FOUND', 'ไม่พบห้องนี้');
  if (!row.my_role) throw new ApiError(403, 'NOT_MEMBER', 'คุณไม่ได้เป็นสมาชิกห้องนี้');
  return { room: row, role: row.my_role };
}

// =====================================================================
// 4. Entry point
// =====================================================================
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return route(req, env);
    return env.ASSETS.fetch(req);
  },

  // ทุกวัน 03:00 เวลาไทย (ดู wrangler.jsonc → triggers)
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupFiles(env));
  },

  // Queue chat-push: ส่งแจ้งเตือนบนมือถือ (ห้องแชทใส่งานไว้ ดู worker/room.ts → queuePush)
  async queue(batch: MessageBatch<PushJob>, env: Env) {
    await handlePushQueue(batch, env);
  },
} satisfies ExportedHandler<Env, PushJob>;
