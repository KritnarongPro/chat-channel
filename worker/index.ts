// =====================================================================
// worker/index.ts — API ระบบแชท (Cloudflare Workers + D1 + Durable Objects)
// Deploy: GitHub Actions (merge เข้า main → migration + deploy) — ไม่ใช้ Workers Builds
//
// สารบัญ
//   1. Router + ตาราง endpoint แยกหมวด
//   2. Handlers: health / auth / setup / admin / users / rooms / messages
//   3. ตัวช่วยเรื่องห้อง (ตรวจสมาชิก)
//   4. Entry point
//
// กติกา: ข้อมูลไม่ผ่านเงื่อนไข หรือเขียน D1 ไม่สำเร็จ → ตอบ error พร้อมเหตุผลภาษาไทยเสมอ
// สิทธิ์ทุก endpoint ตรวจผ่าน requireUser() ใน lib.ts ที่เดียว
// =====================================================================

import { nowThai } from '../shared/time';
import { HISTORY_LIMIT } from '../shared/protocol';
import {
  ApiError, Env, Need, User, clearSessionCookie, db, fail, newId, ok, readCookie, readJson,
  requireUser, sha256, SESSION_COOKIE, userOut,
} from './lib';
import { lineCallback, lineConfigError, lineStart } from './auth-line';

export { ChatRoom } from './room';

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
  { method: 'GET',  pattern: '/api/auth/line/start',          need: 'public', handler: (c) => lineStart(c.env) },
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

  // ---------- messages (ส่งต่อไปที่ห้อง = Durable Object) ----------
  { method: 'GET',  pattern: '/api/rooms/:id/messages',       need: 'active', handler: history },
  { method: 'GET',  pattern: '/api/rooms/:id/ws',             need: 'active', handler: openSocket },
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

/** กันเว็บอื่นยิงคำสั่งแทนผู้ใช้ (CSRF / WebSocket hijack): POST และ WebSocket ต้องมาจากโดเมนของเราเท่านั้น */
function checkOrigin(req: Request, env: Env) {
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
      const user = r.need === 'public' ? null : await requireUser(req, env, r.need);
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
      ? c.env.DB.prepare(`SELECT * FROM users WHERE status = ? ORDER BY created_at DESC`).bind(status)
      : c.env.DB.prepare(`SELECT * FROM users ORDER BY status = 'pending' DESC, created_at DESC`)
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
    c.env.DB.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`).bind(status, nowThai(), c.params.id).run(),
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
async function listUsers(c: Ctx) {
  const rows = await db('อ่านรายชื่อผู้ใช้', () =>
    c.env.DB.prepare(
      `SELECT id, display_name, picture_url, status, role FROM users
       WHERE status = 'active' AND id <> ? ORDER BY display_name`,
    ).bind(c.user!.id).all<Parameters<typeof userOut>[0]>(),
  );
  return ok({ users: rows.results.map(userOut) });
}

// ---------- rooms ----------
type RoomListRow = {
  id: string; type: 'dm' | 'group' | 'channel'; title: string | null; last_seq: number;
  last_message_at: string | null; last_message_preview: string | null; last_sender_name: string | null;
  created_at: string; last_read_seq: number; my_role: string; peer_name: string | null; peer_picture: string | null;
};

async function listRooms(c: Ctx) {
  const rows = await db('อ่านรายการแชท', () =>
    c.env.DB.prepare(
      `SELECT r.id, r.type, r.title, r.last_seq, r.last_message_at, r.last_message_preview, r.last_sender_name,
              r.created_at, m.last_read_seq, m.role AS my_role,
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
    title: r.type === 'dm' ? (r.peer_name ?? 'แชท 1:1') : (r.title ?? 'กลุ่ม'),
    picture: r.type === 'dm' ? r.peer_picture : null,
    lastSeq: r.last_seq,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    lastSenderName: r.last_sender_name,
    createdAt: r.created_at,
    unread: Math.max(0, r.last_seq - r.last_read_seq),
    myRole: r.my_role,
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

async function openDm(c: Ctx) {
  const body = await readJson<{ userId?: unknown }>(c.req);
  const peerId = body.userId;
  if (typeof peerId !== 'string' || !peerId) throw new ApiError(400, 'NO_USER', 'กรุณาเลือกคนที่จะคุยด้วย');
  if (peerId === c.user!.id) throw new ApiError(400, 'SELF', 'เปิดแชท 1:1 กับตัวเองไม่ได้');
  if (!(await activeUserIds(c.env, [peerId])).has(peerId)) {
    throw new ApiError(404, 'USER_NOT_ACTIVE', 'ไม่พบผู้ใช้นี้ หรือยังไม่ได้รับอนุมัติ');
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
  if (room.type !== 'group') throw new ApiError(400, 'NOT_GROUP', 'เพิ่มสมาชิกได้เฉพาะห้องกลุ่ม');
  if (role !== 'owner' && role !== 'admin') throw new ApiError(403, 'NOT_ROOM_ADMIN', 'เฉพาะเจ้าของ/แอดมินกลุ่มเท่านั้นที่เพิ่มสมาชิกได้');
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

// =====================================================================
// 3. ตัวช่วยเรื่องห้อง
// =====================================================================
function roomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
}

async function requireMember(env: Env, roomId: string, userId: string) {
  const row = await db('ตรวจสิทธิ์ในห้อง', () =>
    env.DB.prepare(
      `SELECT r.id, r.type, r.title, r.last_seq, r.last_message_at, r.last_message_preview, r.last_sender_name,
              r.created_at, m.last_read_seq, m.role AS my_role,
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
} satisfies ExportedHandler<Env>;
