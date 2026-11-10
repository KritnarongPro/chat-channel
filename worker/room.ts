// =====================================================================
// worker/room.ts — ห้องแชท 1 ห้อง = Durable Object 1 ตัว (ChatRoom)
//
// สารบัญ
//   0. โครงตารางในห้อง (SQLite ของ Durable Object) + เวอร์ชัน
//   1. ทางเข้า HTTP จาก worker (/ws, /history) — เรียกได้จาก worker เท่านั้น ไม่เปิดสู่ภายนอก
//   2. WebSocket: รับข้อความ / sync / read / ping
//   3. งานเขียนลง D1 (ข้อความล่าสุดของห้อง, อ่านถึงไหน) — ล้มเหลว → แจ้งผู้ส่งเสมอ
//
// worker ตรวจล็อกอิน + สิทธิ์สมาชิกห้องก่อนส่งต่อมาที่นี่ แล้วแนบหัว X-User-Id / X-User-Name / X-Room-Id
// =====================================================================

import { DurableObject } from 'cloudflare:workers';
import { nowThai } from '../shared/time';
import {
  ChatMessage, ClientFrame, ServerFrame,
  HISTORY_LIMIT, MAX_MESSAGE_CHARS, SYNC_LIMIT,
} from '../shared/protocol';
import type { Env } from './lib';

// =====================================================================
// 0. โครงตารางในห้อง — ต้องตรงกับ do-schema.sql (check:rules ตรวจเลขเวอร์ชัน)
// =====================================================================
export const DO_SCHEMA_VERSION = 2;

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
};

type MsgRow = {
  seq: number; id: string; sender_id: string; sender_name: string;
  kind: ChatMessage['kind']; body: string; created_at: string;
  file_id: string | null; file_name: string | null; file_mime: string | null; file_size: number | null;
  file_width: number | null; file_height: number | null; file_duration_ms: number | null; file_expires_at: string | null;
};
const msgOut = (r: MsgRow): ChatMessage => ({
  seq: r.seq, id: r.id, senderId: r.sender_id, senderName: r.sender_name,
  kind: r.kind, body: r.body, createdAt: r.created_at,
  file: r.file_id
    ? {
        id: r.file_id, name: r.file_name ?? '', mime: r.file_mime ?? '', size: r.file_size ?? 0,
        width: r.file_width, height: r.file_height, durationMs: r.file_duration_ms, expiresAt: r.file_expires_at ?? '',
      }
    : null,
});

/** ข้อความย่อสำหรับหน้ารายการแชท */
const PREVIEW: Record<ChatMessage['kind'], string> = { text: '', image: '[รูปภาพ]', file: '[ไฟล์]', voice: '[ข้อความเสียง]' };
function previewOf(m: ChatMessage): string {
  if (m.kind === 'text') return m.body.slice(0, 120);
  const label = m.kind === 'file' && m.file ? `[ไฟล์] ${m.file.name}` : PREVIEW[m.kind];
  return (m.body ? `${label} ${m.body}` : label).slice(0, 120);
}

type FileRow = {
  id: string; room_id: string; uploader_id: string; kind: 'image' | 'file' | 'voice'; mime: string; name: string;
  size: number; width: number | null; height: number | null; duration_ms: number | null; status: string; expires_at: string;
};

interface SocketInfo { userId: string; userName: string }

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
      server.serializeAttachment({ userId, userName: decodeURIComponent(userName) } satisfies SocketInfo);
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
      case 'send':
        await this.handleSend(ws, info, frame.clientId, frame.body, frame.kind ?? 'text', frame.fileId);
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
    ws: WebSocket, info: SocketInfo, clientId: unknown, body: unknown, kind: unknown, fileId: unknown,
  ) {
    // ---------- ตรวจข้อมูล ----------
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) {
      this.send(ws, { type: 'error', code: 'BAD_CLIENT_ID', message: 'รหัสข้อความไม่ถูกต้อง' });
      return;
    }
    if (kind !== 'text' && kind !== 'image' && kind !== 'file' && kind !== 'voice') {
      this.send(ws, { type: 'error', clientId, code: 'BAD_KIND', message: 'ชนิดข้อความไม่ถูกต้อง' });
      return;
    }
    if (typeof body !== 'string') {
      this.send(ws, { type: 'error', clientId, code: 'BAD_BODY', message: 'ข้อความไม่ถูกต้อง' });
      return;
    }
    if (kind === 'text' && body.trim() === '') {
      this.send(ws, { type: 'error', clientId, code: 'EMPTY', message: 'ข้อความว่าง ส่งไม่ได้' });
      return;
    }
    if (body.length > MAX_MESSAGE_CHARS) {
      this.send(ws, { type: 'error', clientId, code: 'TOO_LONG', message: `ข้อความยาวเกิน ${MAX_MESSAGE_CHARS} ตัวอักษร` });
      return;
    }
    if (kind !== 'text' && (typeof fileId !== 'string' || !fileId)) {
      this.send(ws, { type: 'error', clientId, code: 'NO_FILE', message: 'ไม่พบไฟล์ที่จะส่ง กรุณาอัปโหลดใหม่' });
      return;
    }

    // ---------- ส่งซ้ำ (เช่นกดส่งใหม่หลังเน็ตหลุด) → ตอบลำดับเดิม ไม่บันทึกซ้ำ ----------
    const existing = this.sql.exec<{ seq: number }>(`SELECT seq FROM messages WHERE id = ?`, clientId).toArray()[0];
    if (existing) {
      this.send(ws, { type: 'ack', clientId, seq: existing.seq });
      return;
    }

    // ---------- ไฟล์: ตรวจใน D1 แล้วจองไว้ (uploaded → attached) ก่อนบันทึกข้อความ ----------
    let file: FileRow | null = null;
    if (kind !== 'text') {
      file = await this.claimFile(ws, clientId, info, kind, fileId as string);
      if (!file) return;
    }

    // ---------- บันทึก ----------
    let row: MsgRow;
    try {
      row = this.sql.exec<MsgRow>(
        `INSERT INTO messages (id, sender_id, sender_name, kind, body, created_at,
           file_id, file_name, file_mime, file_size, file_width, file_height, file_duration_ms, file_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        clientId, info.userId, info.userName, kind, body, nowThai(),
        file?.id ?? null, file?.name ?? null, file?.mime ?? null, file?.size ?? null,
        file?.width ?? null, file?.height ?? null, file?.duration_ms ?? null, file?.expires_at ?? null,
      ).one();
    } catch (err) {
      console.error('บันทึกข้อความไม่สำเร็จ', err);
      if (file) await this.releaseFile(file.id);
      this.send(ws, { type: 'error', clientId, code: 'SAVE_FAILED', message: 'บันทึกข้อความไม่สำเร็จ กรุณากดส่งใหม่' });
      return;
    }

    const message = msgOut(row);
    this.send(ws, { type: 'ack', clientId, seq: message.seq });
    this.broadcast({ type: 'message', message });

    // ---------- อัปเดต D1: ลำดับข้อความของไฟล์ + หน้ารายการแชท ----------
    if (file) await this.setFileSeq(ws, file.id, message.seq);
    await this.updateRoomSummary(ws, message);
  }

  // =====================================================================
  // 3. งานเขียนลง D1
  // =====================================================================
  /** ตรวจว่าไฟล์เป็นของห้องนี้ + ผู้ส่งเป็นคนอัป + ยังไม่ถูกใช้ แล้วเปลี่ยนเป็น attached — ไม่ผ่านคืน null พร้อมแจ้งเหตุผล */
  private async claimFile(ws: WebSocket, clientId: string, info: SocketInfo, kind: string, fileId: string): Promise<FileRow | null> {
    const roomId = this.roomId;
    let f: FileRow | null;
    try {
      f = await this.env.DB.prepare(`SELECT * FROM files WHERE id = ?`).bind(fileId).first<FileRow>();
    } catch (err) {
      console.error('อ่านข้อมูลไฟล์จาก D1 ไม่สำเร็จ', err);
      this.send(ws, { type: 'error', clientId, code: 'DB_FAILED', message: 'ตรวจไฟล์ไม่สำเร็จ (ฐานข้อมูลขัดข้อง) กรุณากดส่งใหม่' });
      return null;
    }
    const bad = (code: string, message: string) => { this.send(ws, { type: 'error', clientId, code, message }); return null; };
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

  private async setFileSeq(ws: WebSocket, fileId: string, seq: number) {
    try {
      await this.env.DB.prepare(`UPDATE files SET message_seq = ? WHERE id = ?`).bind(seq, fileId).run();
    } catch (err) {
      console.error('บันทึกลำดับข้อความของไฟล์ไม่สำเร็จ', err);
      this.send(ws, { type: 'warning', code: 'FILE_SEQ_FAILED', message: 'ส่งไฟล์แล้ว แต่บันทึกข้อมูลอ้างอิงของไฟล์ไม่ครบ (ไฟล์ยังเปิดได้ตามปกติ)' });
    }
  }

  private async updateRoomSummary(ws: WebSocket, m: ChatMessage) {
    const roomId = this.roomId;
    if (!roomId) {
      this.send(ws, { type: 'warning', code: 'NO_ROOM_ID', message: 'ส่งข้อความแล้ว แต่ไม่รู้รหัสห้อง จึงอัปเดตรายการแชทไม่ได้' });
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
      this.send(ws, {
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
}
