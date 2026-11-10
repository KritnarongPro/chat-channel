// =====================================================================
// shared/protocol.ts — รูปแบบข้อความระหว่างหน้าเว็บ ↔ ห้องแชท (WebSocket) ใช้ร่วมกันทั้งสองฝั่ง
// =====================================================================

export const MAX_MESSAGE_CHARS = 4000;
export const SYNC_LIMIT = 200;
export const HISTORY_LIMIT = 50;

/** ข้อความ 1 รายการในห้อง */
export interface ChatMessage {
  seq: number;          // ลำดับในห้อง (เริ่ม 1)
  id: string;           // ไอดีที่หน้าเว็บสร้าง ใช้กันส่งซ้ำ
  senderId: string;
  senderName: string;
  kind: 'text';         // เฟส 2 จะเพิ่ม image / file / voice
  body: string;
  createdAt: string;    // เวลาไทย ISO
}

// ---------- หน้าเว็บ → ห้อง ----------
export type ClientFrame =
  | { type: 'send'; clientId: string; body: string }
  | { type: 'sync'; afterSeq: number }
  | { type: 'read'; seq: number }
  | { type: 'ping' };

// ---------- ห้อง → หน้าเว็บ ----------
export type ServerFrame =
  | { type: 'message'; message: ChatMessage }
  | { type: 'ack'; clientId: string; seq: number }
  | { type: 'sync'; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'error'; clientId?: string; code: string; message: string }
  | { type: 'warning'; code: string; message: string }
  | { type: 'pong' };
