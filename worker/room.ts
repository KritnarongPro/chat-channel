// =====================================================================
// worker/room.ts — ห้องแชท 1 ห้อง = Durable Object 1 ตัว (ChatRoom)
//
// สารบัญ
//   0. โครงตารางในห้อง (SQLite ของ Durable Object) + เวอร์ชัน
//   1. ทางเข้า HTTP จาก worker (/ws, /history) — เรียกได้จาก worker เท่านั้น ไม่เปิดสู่ภายนอก
//   2. WebSocket: รับข้อความ / sync / read / ping
//   3. งานเขียนลง D1 (ข้อความล่าสุดของห้อง, อ่านถึงไหน) — ล้มเหลว → แจ้งผู้ส่งเสมอ
//   4. แจ้งเตือนบนมือถือ (เฟส 3): หาผู้รับ → ใส่งานใน Queue chat-push (ไม่ส่งให้คนที่เปิดห้องนี้อยู่)
//
// worker ตรวจล็อกอิน + สิทธิ์สมาชิกห้องก่อนส่งต่อมาที่นี่ แล้วแนบหัว X-User-Id / X-User-Name / X-Room-Id
// =====================================================================

import { DurableObject } from 'cloudflare:workers';
import { nowThai } from '../shared/time';
import {
  ChatMessage, ClientFrame, MessageExtra, ServerFrame,
  HISTORY_LIMIT, MAX_MESSAGE_CHARS, SYNC_LIMIT,
} from '../shared/protocol';
import type { Env } from './lib';
import type { PushJob } from './push';

// =====================================================================
// 0. โครงตารางในห้อง — ต้องตรงกับ do-schema.sql (check:rules ตรวจเลขเวอร์ชัน)
// =====================================================================
export const DO_SCHEMA_VERSION = 3;

const DO_MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS messages (
       seq         INTEGER PRIMARY KEY AUTOINCREMENT,
       id          TEXT NOT NULL UNIQUE,
       sender_id   TEXT NOT NULL,
       sender_name TEXT NOT NULL,
       kind        TEXT NOT NULL CHECK (kind IN ('text')),
       body        TEXT NOT NULL,
       created_at  TEXT NOT NULL
     )`,
  ],
  // v2 (เฟส 2): เพิ่มชนิด image/file/voice + ข้อมูลไฟล์ — SQLite แก้ CHECK เดิมไม่ได้ จึงสร้างตารางใหม่แล้วย้ายข้อมูล
  2: [
    `CREATE TABLE messages_v2 (
       seq             INTEGER PRIMARY KEY AUTOINCREMENT,
       id              TEXT NOT NULL UNIQUE,
       sender_id       TEXT NOT NULL,
       sender_name     TEXT NOT NULL,
       kind            TEXT NOT NULL CHECK (kind IN ('text', 'image', 'file', 'voice')),
       body            TEXT NOT NULL,
       created_at      TEXT NOT NULL,
       file_id         TEXT,
       file_name       TEXT,
       file_mime       TEXT,
       file_size       INTEGER,
       file_width      INTEGER,
       file_height     INTEGER,
       file_duration_ms INTEGER,
       file_expires_at TEXT
     )`,
    `INSERT INTO messages_v2 (seq, id, sender_id, sender_name, kind, body, created_at)
       SELECT seq, id, sender_id, sender_name, kind, body, created_at FROM messages`,
    `DROP TABLE messages`,
    `ALTER TABLE messages_v2 RENAME TO messages`,
  ],
  // v3 (เฟส 4): เพิ่มชนิด form (การ์ดฟอร์ม) + คอลัมน์ extra (JSON) — สร้างตารางใหม่แล้วย้ายข้อมูลเหมือน v2
  3: [
    `CREATE TABLE messages_v3 (
       seq             INTEGER PRIMARY KEY AUTOINCREMENT,
       id              TEXT NOT NULL UNIQUE,
       sender_id       TEXT NOT NULL,
       sender_name     TEXT NOT NULL,
       kind            TEXT NOT NULL CHECK (kind IN ('text', 'image', 'file', 'voice', 'form')),
       body            TEXT NOT NULL,
       created_at      TEXT NOT NULL,
       file_id         TEXT,
       file_name       TEXT,
       file_mime       TEXT,
       file_size       INTEGER,
       file_width      INTEGER,
       file_height     INTEGER,
       file_duration_ms INTEGER,
       file_expires_at TEXT,
       extra           TEXT
     )`,
    `INSERT INTO messages_v3 (seq, id, sender_id, sender_name, kind, body, created_at, file_id, file_name, file_mime,
                              file_size, file_width, file_height, file_duration_ms, file_expires_at)
       SELECT seq, id, sender_id, sender_name, kind, body, created_at, file_id, file_name, file_mime,
              file_size, file_width, file_height, file_duration_ms, file_expires_at FROM messages`,
    `DROP TABLE messages`,
    `ALTER TABLE messages_v3 RENAME TO messages`,
  ],
};

type MsgRow = {
  seq: number; id: string; sender_id: string; sender_name: string;
  kind: ChatMessage['kind']; body: string; created_at: string;
  file_id: string | null; file_name: string | null; file_mime: string | null; file_size: number | null;
  file_width: number | null; file_height: number | null; file_duration_ms: number | null; file_expires_at: string | null;
  extra: string | null;
};
function parseExtra(raw: string | null): MessageExtra | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MessageExtra;
  } catch (err) {
    console.error('อ่าน extra ของข้อความไม่ได้', err);
    return null;
  }
}
const msgOut = (r: MsgRow): ChatMessage => ({
  seq: r.seq, id: r.id, senderId: r.sender_id, senderName: r.sender_name,
  kind: r.kind, body: r.body, createdAt: r.created_at,
  file: r.file_id
    ? {
        id: r.file_id, name: r.file_name ?? '', mime: r.file_mime ?? '', size: r.file_size ?? 0,
        width: r.file_width, height: r.file_height, durationMs: r.file_duration_ms, expiresAt: r.file_expires_at ?? '',
      }
    : null,
  extra: parseExtra(r.extra),
});

/** ข้อความย่อสำหรับหน้ารายการแชท */
const PREVIEW: Record<ChatMessage['kind'], string> = { text: '', image: '[รูปภาพ]', file: '[ไฟล์]', voice: '[ข้อความเสียง]', form: '[ฟอร์ม]' };
function previewOf(m: ChatMessage): string {
  if (m.kind === 'text') return m.body.slice(0, 120);
  if (m.kind === 'form') return `[ฟอร์ม] ${m.extra?.formTitle ?? ''}`.slice(0, 120);
  const label = m.kind === 'file' && m.file ? `[ไฟล์] ${m.file.name}` : PREVIEW[m.kind];
  return (m.body ? `${label} ${m.body}` : label).slice(0, 120);
}

interface RoomInfo { type: 'dm' | 'group' | 'channel'; title: string | null; senderIsBot: boolean; senderSysRole: string | null }

type FileRow = {
  id: string; room_id: string; uploader_id: string; kind: 'image' | 'file' | 'voice'; mime: string; name: string;
  size: number; width: number | null; height: number | null; duration_ms: number | null; status: string; expires_at: string;
};

/** ช่องทางตอบผู้ส่ง: WebSocket ของคนส่ง หรือ ตัวเก็บผลสำหรับคำขอ HTTP จากบอท/ระบบ */
type Reply = (frame: ServerFrame) => void;

interface SocketInfo { userId: string; userName: string; visible: boolean }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export class ChatRoom extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  /** สร้าง/อัปเดตตารางในห้องตามเวอร์ชัน */
  private migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0];
    let current = row ? Number(row.value) : 0;
    while (current < DO_SCHEMA_VERSION) {
      const next = current + 1;
      for (const stmt of DO_MIGRATIONS[next] ?? []) this.sql.exec(stmt);
      this.sql.exec(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        String(next),
      );
      current = next;
    }
  }

  private get roomId(): string | null {
    const r = this.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'room_id'`).toArray()[0];
    return r ? r.value : null;
  }

  private rememberRoomId(id: string) {
    this.sql.exec(
      `INSERT INTO meta (key, value) VALUES ('room_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, id,
    );
  }

  // =====================================================================
  // 1. ทางเข้า HTTP จาก worker
  // =====================================================================
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const roomId = req.headers.get('X-Room-Id');
    if (roomId) this.rememberRoomId(roomId);

    // ---------- เปิด WebSocket ----------
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return json({ ok: false, error: { code: 'NOT_WEBSOCKET', message: 'ต้องเชื่อมต่อแบบ WebSocket' } }, 426);
      }
      const userId = req.headers.get('X-User-Id');
      const userName = req.headers.get('X-User-Name');
      if (!userId || !userName) {
        return json({ ok: false, error: { code: 'NO_USER', message: 'ไม่พบข้อมูลผู้ใช้ที่ส่งมาจาก worker' } }, 400);
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ userId, userName: decodeURIComponent(userName), visible: true } satisfies SocketInfo);
      return new Response(null, { status: 101, webSocket: client });
    }

    // ---------- ประวัติย้อนหลัง (เลื่อนขึ้นดูข้อความเก่า) ----------
    if (url.pathname === '/history') {
      const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
      const limit = Math.min(Number(url.searchParams.get('limit') || HISTORY_LIMIT), HISTORY_LIMIT);
      if (!Number.isFinite(before) || !Number.isFinite(limit) || limit < 1) {
        return json({ ok: false, error: { code: 'BAD_QUERY', message: 'ค่า before/limit ไม่ถูกต้อง' } }, 400);
      }
      const rows = this.sql.exec<MsgRow>(
        `SELECT * FROM messages WHERE seq < ? ORDER BY seq DESC LIMIT ?`, before, limit + 1,
      ).toArray();
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse().map(msgOut);
      return json({ ok: true, data: { messages, hasMore } });
    }

    // ---------- อ่านข้อความเดียว (ใช้ตอนปักหมุด) ----------
    if (url.pathname === '/message') {
      const seq = Number(url.searchParams.get('seq'));
      const row = Number.isInteger(seq) ? this.sql.exec<MsgRow>(`SELECT * FROM messages WHERE seq = ?`, seq).toArray()[0] : undefined;
      if (!row) return json({ ok: false, error: { code: 'MESSAGE_NOT_FOUND', message: 'ไม่พบข้อความนี้ในห้อง' } }, 404);
      const m = msgOut(row);
      return json({ ok: true, data: { message: m, preview: previewOf(m) } });
    }

    // ---------- บอกทุกคนที่เปิดห้องอยู่ว่าข้อมูลห้องเปลี่ยน (เช่น ปักหมุด) ----------
    if (url.pathname === '/broadcast' && req.method === 'POST') {
      this.broadcast({ type: 'room_update' });
      return json({ ok: true, data: { sent: this.ctx.getWebSockets().length } });
    }

    // ---------- ส่งข้อความจาก worker (บอทผ่าน Bot API / ระบบแจ้งสถานะออเดอร์) ----------
    // ตรวจสิทธิ์ซ้ำในห้องเหมือนคนส่งผ่าน WebSocket (checkPoster) — ผิดเงื่อนไขตอบ error พร้อมเหตุผล
    if (url.pathname === '/post' && req.method === 'POST') {
      let p: { senderId?: string; senderName?: string; clientId?: string; kind?: string; body?: string; fileId?: string; extra?: unknown };
      try {
        p = await req.json();
      } catch {
        return json({ ok: false, error: { code: 'BAD_JSON', message: 'ข้อมูลที่ส่งมาไม่ใช่ JSON' } }, 400);
      }
      if (!p.senderId || !p.senderName) return json({ ok: false, error: { code: 'NO_SENDER', message: 'ไม่ระบุผู้ส่ง' } }, 400);
      const frames: ServerFrame[] = [];
      const message = await this.handleSend(
        (f) => frames.push(f), { userId: p.senderId, userName: p.senderName, visible: false },
        p.clientId ?? crypto.randomUUID().replace(/-/g, ''), p.body ?? '', p.kind ?? 'text', p.fileId, p.extra,
      );
      const err = frames.find((f) => f.type === 'error');
      const warnings = frames.filter((f) => f.type === 'warning').map((f) => (f as { message: string }).message);
      if (!message) {
        const ack = frames.find((f) => f.type === 'ack') as { seq: number } | undefined;
        if (ack && !err) return json({ ok: true, data: { seq: ack.seq, duplicate: true, warnings } });
        const e = err as { code: string; message: string } | undefined;
        const status = e?.code === 'NOT_MEMBER' || e?.code?.startsWith('NOT_') ? 403 : e?.code === 'DB_FAILED' || e?.code === 'SAVE_FAILED' ? 500 : 400;
        return json({ ok: false, error: { code: e?.code ?? 'SEND_FAILED', message: e?.message ?? 'ส่งข้อความไม่สำเร็จ' } }, status);
      }
      return json({ ok: true, data: { message, warnings } });
    }

    return json({ ok: false, error: { code: 'NOT_FOUND', message: 'ไม่พบเส้นทางในห้องแชท' } }, 404);
  }

  // =====================================================================
  // 2. WebSocket
  // =====================================================================
  private send(ws: WebSocket, frame: ServerFrame) {
    try {
      ws.send(JSON.stringify(frame));
    } catch (err) {
      console.error('ส่งข้อมูลให้ผู้ใช้ไม่สำเร็จ (socket อาจปิดแล้ว)', err);
    }
  }

  private broadcast(frame: ServerFrame) {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, frame);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const info = ws.deserializeAttachment() as SocketInfo | null;
    if (!info) {
      this.send(ws, { type: 'error', code: 'NO_SESSION', message: 'ไม่พบข้อมูลผู้ใช้ของการเชื่อมต่อนี้ กรุณาเปิดห้องใหม่' });
      return;
    }
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS * 4 + 500) {
      this.send(ws, { type: 'error', code: 'BAD_FRAME', message: 'ข้อมูลที่ส่งมาไม่ถูกต้องหรือใหญ่เกินไป' });
      return;
    }
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw) as ClientFrame;
    } catch {
      this.send(ws, { type: 'error', code: 'BAD_JSON', message: 'อ่านข้อมูลที่ส่งมาไม่ได้ (JSON ไม่ถูกต้อง)' });
      return;
    }

    switch (frame.type) {
      case 'ping':
        this.send(ws, { type: 'pong' });
        return;
      case 'sync':
        this.handleSync(ws, frame.afterSeq);
        return;
      case 'read':
        await this.handleRead(ws, info, frame.seq);
        return;
      case 'presence':
        ws.serializeAttachment({ ...info, visible: frame.visible === true } satisfies SocketInfo);
        return;
      case 'send':
        await this.handleSend((f) => this.send(ws, f), info, frame.clientId, frame.body, frame.kind ?? 'text', frame.fileId, frame.extra);
        return;
      default:
        this.send(ws, { type: 'error', code: 'UNKNOWN_TYPE', message: 'ไม่รู้จักคำสั่งนี้' });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch (err) {
      console.log('socket ปิดไปแล้ว', err);
    }
  }

  async webSocketError(_ws: WebSocket, err: unknown) {
    console.error('WebSocket ผิดพลาด', err);
  }

  private handleSync(ws: WebSocket, afterSeq: number) {
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      this.send(ws, { type: 'error', code: 'BAD_SYNC', message: 'ค่าลำดับข้อความสำหรับดึงข้อมูลไม่ถูกต้อง' });
      return;
    }
    let rows: MsgRow[];
    if (afterSeq === 0) {
      // เปิดห้องครั้งแรก → เอาข้อความล่าสุดชุดเดียว
      rows = this.sql.exec<MsgRow>(`SELECT * FROM messages ORDER BY seq DESC LIMIT ?`, HISTORY_LIMIT).toArray().reverse();
      const total = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM messages`).one().n;
      this.send(ws, { type: 'sync', messages: rows.map(msgOut), hasMore: total > rows.length });
      return;
    }
    rows = this.sql.exec<MsgRow>(
      `SELECT * FROM messages WHERE seq > ? ORDER BY seq ASC LIMIT ?`, afterSeq, SYNC_LIMIT + 1,
    ).toArray();
    this.send(ws, { type: 'sync', messages: rows.slice(0, SYNC_LIMIT).map(msgOut), hasMore: rows.length > SYNC_LIMIT });
  }

  private async handleSend(
    out: Reply, info: SocketInfo, clientId: unknown, body: unknown, kind: unknown, fileId: unknown, extra?: unknown,
  ): Promise<ChatMessage | null> {
    // ---------- ตรวจข้อมูล ----------
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) {
      out({ type: 'error', code: 'BAD_CLIENT_ID', message: 'รหัสข้อความไม่ถูกต้อง' });
      return null;
    }
    if (kind !== 'text' && kind !== 'image' && kind !== 'file' && kind !== 'voice' && kind !== 'form') {
      out({ type: 'error', clientId, code: 'BAD_KIND', message: 'ชนิดข้อความไม่ถูกต้อง' });
      return null;
    }
    if (typeof body !== 'string') {
      out({ type: 'error', clientId, code: 'BAD_BODY', message: 'ข้อความไม่ถูกต้อง' });
      return null;
    }
    if (kind === 'text' && body.trim() === '') {
      out({ type: 'error', clientId, code: 'EMPTY', message: 'ข้อความว่าง ส่งไม่ได้' });
      return null;
    }
    if (body.length > MAX_MESSAGE_CHARS) {
      out({ type: 'error', clientId, code: 'TOO_LONG', message: `ข้อความยาวเกิน ${MAX_MESSAGE_CHARS} ตัวอักษร` });
      return null;
    }
    if (kind === 'form' && (typeof extra !== 'object' || extra === null || typeof (extra as MessageExtra).formId !== 'string')) {
      out({ type: 'error', clientId, code: 'NO_FORM', message: 'ไม่ได้ระบุฟอร์มที่จะส่ง' });
      return null;
    }
    if ((kind === 'image' || kind === 'file' || kind === 'voice') && (typeof fileId !== 'string' || !fileId)) {
      out({ type: 'error', clientId, code: 'NO_FILE', message: 'ไม่พบไฟล์ที่จะส่ง กรุณาอัปโหลดใหม่' });
      return null;
    }

    // ---------- ส่งซ้ำ (เช่นกดส่งใหม่หลังเน็ตหลุด) → ตอบลำดับเดิม ไม่บันทึกซ้ำ ----------
    const existing = this.sql.exec<{ seq: number }>(`SELECT seq FROM messages WHERE id = ?`, clientId).toArray()[0];
    if (existing) {
      out({ type: 'ack', clientId, seq: existing.seq });
      return null;
    }

    // ---------- สิทธิ์: ยังเป็นสมาชิกอยู่ไหม + ชาเนลโพสต์ได้เฉพาะเจ้าของ/แอดมินชาเนล ----------
    const room = await this.checkPoster(out, clientId, info);
    if (!room) return null;

    // ---------- ไฟล์: ตรวจใน D1 แล้วจองไว้ (uploaded → attached) ก่อนบันทึกข้อความ ----------
    let file: FileRow | null = null;
    if (kind === 'image' || kind === 'file' || kind === 'voice') {
      file = await this.claimFile(out, clientId, info, kind, fileId as string);
      if (!file) return null;
    }

    // ---------- การ์ดฟอร์ม (เฟส 4): ส่งได้เฉพาะแอดมินระบบหรือบอท + ฟอร์มต้องมีอยู่และเปิดใช้ ----------
    let extraOut: MessageExtra | null = null;
    if (kind === 'form') {
      if (!room.senderIsBot && room.senderSysRole !== 'admin') {
        out({ type: 'error', clientId, code: 'NOT_ADMIN', message: 'ส่งการ์ดฟอร์มได้เฉพาะแอดมินระบบหรือบอท' });
        return null;
      }
      const formId = (extra as MessageExtra).formId!;
      let form: { title: string; active: number } | null;
      try {
        form = await this.env.DB.prepare(`SELECT title, active FROM forms WHERE id = ?`).bind(formId).first();
      } catch (err) {
        console.error('อ่านฟอร์มไม่สำเร็จ', err);
        out({ type: 'error', clientId, code: 'DB_FAILED', message: 'ตรวจฟอร์มไม่สำเร็จ (ฐานข้อมูลขัดข้อง)' });
        return null;
      }
      if (!form) { out({ type: 'error', clientId, code: 'FORM_NOT_FOUND', message: 'ไม่พบฟอร์มนี้' }); return null; }
      if (!form.active) { out({ type: 'error', clientId, code: 'FORM_INACTIVE', message: 'ฟอร์มนี้ปิดรับแล้ว' }); return null; }
      extraOut = { formId, formTitle: form.title };
    } else if (extra && typeof extra === 'object' && typeof (extra as MessageExtra).orderId === 'number') {
      extraOut = { orderId: (extra as MessageExtra).orderId }; // ข้อความแจ้งสถานะออเดอร์ (ระบบใส่ให้)
    }

    // ---------- แจ้งเตือน: ส่งแบบเงียบ + ตอบกลับ (ห้องเติมข้อมูลข้อความที่ถูกตอบเองจากของจริง ไม่เชื่อหน้าเว็บ) ----------
    const ex = (extra && typeof extra === 'object' ? extra : {}) as MessageExtra;
    if (ex.silent === true) extraOut = { ...(extraOut ?? {}), silent: true };
    if (ex.replyTo && typeof ex.replyTo === 'object') {
      const seq = Number(ex.replyTo.seq);
      const target = Number.isInteger(seq)
        ? this.sql.exec<MsgRow>(`SELECT * FROM messages WHERE seq = ?`, seq).toArray()[0]
        : undefined;
      if (!target) {
        out({ type: 'error', clientId, code: 'REPLY_NOT_FOUND', message: 'ไม่พบข้อความที่จะตอบกลับ (อาจถูกลบหรืออยู่คนละห้อง)' });
        return null;
      }
      const t = msgOut(target);
      extraOut = {
        ...(extraOut ?? {}),
        replyTo: { seq: t.seq, senderId: t.senderId, senderName: t.senderName, snippet: previewOf(t).slice(0, 80) },
      };
    }

    // ---------- บันทึก ----------
    let row: MsgRow;
    try {
      row = this.sql.exec<MsgRow>(
        `INSERT INTO messages (id, sender_id, sender_name, kind, body, created_at,
           file_id, file_name, file_mime, file_size, file_width, file_height, file_duration_ms, file_expires_at, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        clientId, info.userId, info.userName, kind, body, nowThai(),
        file?.id ?? null, file?.name ?? null, file?.mime ?? null, file?.size ?? null,
        file?.width ?? null, file?.height ?? null, file?.duration_ms ?? null, file?.expires_at ?? null,
        extraOut ? JSON.stringify(extraOut) : null,
      ).one();
    } catch (err) {
      console.error('บันทึกข้อความไม่สำเร็จ', err);
      if (file) await this.releaseFile(file.id);
      out({ type: 'error', clientId, code: 'SAVE_FAILED', message: 'บันทึกข้อความไม่สำเร็จ กรุณากดส่งใหม่' });
      return null;
    }

    const message = msgOut(row);
    out({ type: 'ack', clientId, seq: message.seq });
    this.broadcast({ type: 'message', message });

    // ---------- อัปเดต D1: ลำดับข้อความของไฟล์ + หน้ารายการแชท ----------
    if (file) await this.setFileSeq(out, file.id, message.seq);
    await this.updateRoomSummary(out, message);
    await this.queuePush(out, message, room);
    if (!room.senderIsBot) await this.queueBots(out, message, room); // บอทไม่เห็นข้อความของบอทด้วยกัน (กันวนลูป)
    return message;
  }

  /** อ่านชนิดห้อง + ตำแหน่งผู้ส่งจาก D1 ทุกครั้งที่ส่ง (คนที่ถูกเอาออก/ถูกถอดแอดมินระหว่างเปิดห้องค้างไว้จะส่งไม่ได้) */
  private async checkPoster(out: Reply, clientId: string, info: SocketInfo): Promise<RoomInfo | null> {
    const roomId = this.roomId;
    let r: { type: RoomInfo['type']; title: string | null; role: string | null; is_bot: number | null; sys_role: string | null } | null;
    try {
      r = await this.env.DB.prepare(
        `SELECT r.type, r.title, m.role, u.is_bot, u.role AS sys_role
         FROM rooms r LEFT JOIN room_members m ON m.room_id = r.id AND m.user_id = ?1
         LEFT JOIN users u ON u.id = ?1
         WHERE r.id = ?2`,
      ).bind(info.userId, roomId).first();
    } catch (err) {
      console.error('ตรวจสิทธิ์ส่งข้อความไม่สำเร็จ', err);
      out({ type: 'error', clientId, code: 'DB_FAILED', message: 'ตรวจสิทธิ์ไม่สำเร็จ (ฐานข้อมูลขัดข้อง) กรุณากดส่งใหม่' });
      return null;
    }
    if (!r) {
      out({ type: 'error', clientId, code: 'ROOM_NOT_FOUND', message: 'ไม่พบห้องนี้แล้ว' });
      return null;
    }
    if (!r.role) {
      out({ type: 'error', clientId, code: 'NOT_MEMBER', message: 'คุณไม่ได้เป็นสมาชิกห้องนี้แล้ว' });
      return null;
    }
    if (r.type === 'channel' && r.role !== 'owner' && r.role !== 'admin') {
      out({ type: 'error', clientId, code: 'NOT_CHANNEL_ADMIN', message: 'ชาเนลนี้โพสต์ได้เฉพาะเจ้าของและแอดมินชาเนล' });
      return null;
    }
    return { type: r.type, title: r.title, senderIsBot: r.is_bot === 1, senderSysRole: r.sys_role };
  }

  // =====================================================================
  // 3. งานเขียนลง D1
  // =====================================================================
  /** ตรวจว่าไฟล์เป็นของห้องนี้ + ผู้ส่งเป็นคนอัป + ยังไม่ถูกใช้ แล้วเปลี่ยนเป็น attached — ไม่ผ่านคืน null พร้อมแจ้งเหตุผล */
  private async claimFile(out: Reply, clientId: string, info: SocketInfo, kind: string, fileId: string): Promise<FileRow | null> {
    const roomId = this.roomId;
    let f: FileRow | null;
    try {
      f = await this.env.DB.prepare(`SELECT * FROM files WHERE id = ?`).bind(fileId).first<FileRow>();
    } catch (err) {
      console.error('อ่านข้อมูลไฟล์จาก D1 ไม่สำเร็จ', err);
      out({ type: 'error', clientId, code: 'DB_FAILED', message: 'ตรวจไฟล์ไม่สำเร็จ (ฐานข้อมูลขัดข้อง) กรุณากดส่งใหม่' });
      return null;
    }
    const bad = (code: string, message: string) => { out({ type: 'error', clientId, code, message }); return null; };
    if (!f) return bad('FILE_NOT_FOUND', 'ไม่พบไฟล์ (อาจอัปไม่สำเร็จหรือถูกลบแล้ว) กรุณาเลือกไฟล์ใหม่');
    if (f.room_id !== roomId) return bad('FILE_OTHER_ROOM', 'ไฟล์นี้อัปไว้ในห้องอื่น');
    if (f.uploader_id !== info.userId) return bad('FILE_NOT_YOURS', 'ส่งได้เฉพาะไฟล์ที่คุณอัปเอง');
    if (f.kind !== kind) return bad('FILE_KIND', 'ชนิดไฟล์ไม่ตรงกับข้อความ');
    if (f.status !== 'uploaded') return bad('FILE_USED', 'ไฟล์นี้ถูกส่งไปแล้วหรือหมดอายุ');
    try {
      const res = await this.env.DB.prepare(`UPDATE files SET status = 'attached' WHERE id = ? AND status = 'uploaded'`).bind(f.id).run();
      if (res.meta.changes !== 1) return bad('FILE_USED', 'ไฟล์นี้ถูกส่งไปแล้ว');
    } catch (err) {
      console.error('จองไฟล์ใน D1 ไม่สำเร็จ', err);
      return bad('DB_FAILED', 'บันทึกสถานะไฟล์ไม่สำเร็จ กรุณากดส่งใหม่');
    }
    return f;
  }

  /** บันทึกข้อความไม่สำเร็จ → คืนสถานะไฟล์ให้ส่งใหม่ได้ */
  private async releaseFile(fileId: string) {
    try {
      await this.env.DB.prepare(`UPDATE files SET status = 'uploaded' WHERE id = ? AND status = 'attached' AND message_seq IS NULL`).bind(fileId).run();
    } catch (err) {
      console.error('คืนสถานะไฟล์ไม่สำเร็จ (ไฟล์จะถูกเก็บกวาดภายหลัง)', fileId, err);
    }
  }

  private async setFileSeq(out: Reply, fileId: string, seq: number) {
    try {
      await this.env.DB.prepare(`UPDATE files SET message_seq = ? WHERE id = ?`).bind(seq, fileId).run();
    } catch (err) {
      console.error('บันทึกลำดับข้อความของไฟล์ไม่สำเร็จ', err);
      out({ type: 'warning', code: 'FILE_SEQ_FAILED', message: 'ส่งไฟล์แล้ว แต่บันทึกข้อมูลอ้างอิงของไฟล์ไม่ครบ (ไฟล์ยังเปิดได้ตามปกติ)' });
    }
  }

  private async updateRoomSummary(out: Reply, m: ChatMessage) {
    const roomId = this.roomId;
    if (!roomId) {
      out({ type: 'warning', code: 'NO_ROOM_ID', message: 'ส่งข้อความแล้ว แต่ไม่รู้รหัสห้อง จึงอัปเดตรายการแชทไม่ได้' });
      return;
    }
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE rooms SET last_seq = ?, last_message_at = ?, last_message_preview = ?, last_sender_name = ?
           WHERE id = ? AND last_seq < ?`,
        ).bind(m.seq, m.createdAt, previewOf(m), m.senderName, roomId, m.seq),
        // ผู้ส่งถือว่าอ่านข้อความตัวเองแล้ว
        this.env.DB.prepare(
          `UPDATE room_members SET last_read_seq = MAX(last_read_seq, ?) WHERE room_id = ? AND user_id = ?`,
        ).bind(m.seq, roomId, m.senderId),
      ]);
    } catch (err) {
      console.error('อัปเดต rooms ใน D1 ไม่สำเร็จ', err);
      out({
        type: 'warning', code: 'SUMMARY_FAILED',
        message: 'ส่งข้อความแล้ว แต่อัปเดตหน้ารายการแชทไม่สำเร็จ (ข้อความล่าสุดอาจยังไม่ขึ้นในรายการ)',
      });
    }
  }

  private async handleRead(ws: WebSocket, info: SocketInfo, seq: unknown) {
    const roomId = this.roomId;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || !roomId) {
      this.send(ws, { type: 'error', code: 'BAD_READ', message: 'บันทึกสถานะอ่านแล้วไม่ได้ (ข้อมูลไม่ถูกต้อง)' });
      return;
    }
    try {
      await this.env.DB.prepare(
        `UPDATE room_members SET last_read_seq = MAX(last_read_seq, ?) WHERE room_id = ? AND user_id = ?`,
      ).bind(seq, roomId, info.userId).run();
    } catch (err) {
      console.error('บันทึกสถานะอ่านแล้วไม่สำเร็จ', err);
      this.send(ws, { type: 'warning', code: 'READ_FAILED', message: 'บันทึกสถานะ "อ่านแล้ว" ไม่สำเร็จ ตัวเลขยังไม่อ่านอาจไม่ตรง' });
    }
  }

  // =====================================================================
  // 4. แจ้งเตือนบนมือถือ
  // =====================================================================
  /** หาผู้รับ + คนที่ถูก @ชื่อ/ถูกตอบกลับ แล้วใส่งานลง Queue — การตัดสินใจรายคน (ปิดเสียง/ตั้งค่า/แอปเปิดอยู่) ทำใน worker/push.ts */
  private async queuePush(out: Reply, m: ChatMessage, room: RoomInfo) {
    const roomId = this.roomId;
    if (!roomId) return;
    // คนที่เปิดหน้าจอห้องนี้อยู่ ไม่ต้องแจ้งอะไรเลย (เห็นข้อความอยู่แล้ว)
    const viewing = new Set<string>();
    for (const s of this.ctx.getWebSockets()) {
      const i = s.deserializeAttachment() as SocketInfo | null;
      if (i?.visible) viewing.add(i.userId);
    }
    let members: { user_id: string; display_name: string }[];
    try {
      const rows = await this.env.DB.prepare(
        `SELECT m.user_id, u.display_name FROM room_members m JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.user_id <> ? AND u.status = 'active' AND u.is_bot = 0`,
      ).bind(roomId, m.senderId).all<{ user_id: string; display_name: string }>();
      members = rows.results.filter((r) => !viewing.has(r.user_id));
    } catch (err) {
      console.error('หาผู้รับแจ้งเตือนไม่สำเร็จ', err);
      out({ type: 'warning', code: 'PUSH_FAILED', message: 'ส่งข้อความแล้ว แต่ส่งแจ้งเตือนให้คนอื่นไม่สำเร็จ (ฐานข้อมูลขัดข้อง)' });
      return;
    }
    if (members.length === 0) return;

    // ถูก @ชื่อ (ไม่สนตัวพิมพ์เล็กใหญ่) หรือถูกตอบกลับ → แจ้งเตือนได้แม้ปิดเสียง (ถ้าผู้รับตั้งไว้)
    const lower = m.body.toLowerCase();
    const important = members
      .filter((x) => lower.includes(`@${x.display_name.toLowerCase()}`) || m.extra?.replyTo?.senderId === x.user_id)
      .map((x) => x.user_id);

    const text = m.kind === 'text' ? m.body
      : m.kind === 'image' ? `[รูปภาพ]${m.body ? ' ' + m.body : ''}`
      : m.kind === 'voice' ? '[ข้อความเสียง]'
      : m.kind === 'form' ? `[ฟอร์ม] ${m.extra?.formTitle ?? ''}`
      : `[ไฟล์] ${m.file?.name ?? ''}`;
    const title = room.type === 'dm' ? m.senderName : (room.title ?? (room.type === 'channel' ? 'ชาเนล' : 'กลุ่ม'));
    const body = (room.type === 'group' ? `${m.senderName}: ${text}` : text).slice(0, 200);
    const payload = { title, body, url: `/room/${roomId}`, tag: `room-${roomId}` };
    const base = { roomId, roomType: room.type, silent: m.extra?.silent === true, important, payload };

    // ชุดละ 100 คน · sendBatch ได้ครั้งละ 100 งาน
    const ids = members.map((x) => x.user_id);
    const jobs: { body: PushJob }[] = [];
    for (let i = 0; i < ids.length; i += 100) jobs.push({ body: { type: 'push', userIds: ids.slice(i, i + 100), ...base } });
    try {
      for (let i = 0; i < jobs.length; i += 100) await this.env.PUSH_QUEUE.sendBatch(jobs.slice(i, i + 100));
    } catch (err) {
      console.error('ใส่งานแจ้งเตือนลง Queue ไม่สำเร็จ', err);
      out({ type: 'warning', code: 'PUSH_FAILED', message: 'ส่งข้อความแล้ว แต่ส่งแจ้งเตือนให้คนอื่นไม่สำเร็จ (Queue ขัดข้อง)' });
    }
  }

  // =====================================================================
  // 5. ส่งข้อความถึงบอท (เฟส 4) — ใส่งานลง Queue แล้ว worker ส่งต่อไป webhook ของบอท (เช่น n8n)
  //    แชท 1:1 กับบอท = ทุกข้อความ · กลุ่ม/ชาเนล = เฉพาะข้อความที่ขึ้นต้นด้วย / หรือ @ชื่อบอท
  // =====================================================================
  private async queueBots(out: Reply, m: ChatMessage, room: RoomInfo) {
    const roomId = this.roomId;
    if (!roomId) return;
    let bots: { id: string; display_name: string }[];
    try {
      const rows = await this.env.DB.prepare(
        `SELECT u.id, u.display_name FROM room_members rm JOIN users u ON u.id = rm.user_id JOIN bots b ON b.id = u.id
         WHERE rm.room_id = ? AND u.is_bot = 1 AND b.enabled = 1 AND b.webhook_url IS NOT NULL AND u.id <> ?`,
      ).bind(roomId, m.senderId).all<{ id: string; display_name: string }>();
      bots = rows.results;
    } catch (err) {
      console.error('หาบอทในห้องไม่สำเร็จ', err);
      out({ type: 'warning', code: 'BOT_FAILED', message: 'ส่งข้อความแล้ว แต่ส่งต่อให้บอทไม่สำเร็จ (ฐานข้อมูลขัดข้อง)' });
      return;
    }
    const text = m.body.trim();
    const targets = bots.filter((b) =>
      room.type === 'dm' || text.startsWith('/') || text.toLowerCase().includes(`@${b.display_name.toLowerCase()}`));
    if (targets.length === 0) return;
    const update = {
      type: 'message' as const,
      room: { id: roomId, type: room.type, title: room.title },
      message: m,
    };
    try {
      await this.env.PUSH_QUEUE.sendBatch(targets.map((b) => ({ body: { type: 'webhook' as const, botId: b.id, update } })));
    } catch (err) {
      console.error('ใส่งานส่งถึงบอทลง Queue ไม่สำเร็จ', err);
      out({ type: 'warning', code: 'BOT_FAILED', message: 'ส่งข้อความแล้ว แต่ส่งต่อให้บอทไม่สำเร็จ (Queue ขัดข้อง)' });
    }
  }
}
