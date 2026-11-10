// =====================================================================
// shared/protocol.ts — รูปแบบข้อความระหว่างหน้าเว็บ ↔ ห้องแชท (WebSocket) ใช้ร่วมกันทั้งสองฝั่ง
// =====================================================================

export const MAX_MESSAGE_CHARS = 4000;
export const SYNC_LIMIT = 200;
export const HISTORY_LIMIT = 50;

// ---------- ไฟล์ (เฟส 2) ----------
export type FileKind = 'image' | 'file' | 'voice';
export const FILE_RETENTION_DAYS = 180;
export const MAX_BYTES: Record<FileKind, number> = {
  image: 10 * 1024 * 1024,  // 10MB
  file: 25 * 1024 * 1024,   // 25MB
  voice: 8 * 1024 * 1024,   // 8MB (เสียง 5 นาทีใช้ราว 2–5MB)
};
export const MAX_VOICE_SECONDS = 300;
export const IMAGE_MAX_SIDE = 1600;
/** ชนิดรูปที่รับ (ไม่รับ SVG เพราะฝังสคริปต์ได้) */
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
/** ชนิดเสียงที่รับ (ตัด ;codecs=... ออกก่อนเทียบ) */
export const VOICE_MIMES = ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/aac'];

export interface FileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  expiresAt: string;    // เวลาไทย ISO — เลยแล้ว = ไฟล์ถูกลบ
}

/** ข้อความ 1 รายการในห้อง */
export interface ChatMessage {
  seq: number;          // ลำดับในห้อง (เริ่ม 1)
  id: string;           // ไอดีที่หน้าเว็บสร้าง ใช้กันส่งซ้ำ
  senderId: string;
  senderName: string;
  kind: 'text' | FileKind;
  body: string;         // ข้อความ หรือคำบรรยายใต้ไฟล์ (ว่างได้ถ้าเป็นไฟล์)
  file: FileInfo | null;
  createdAt: string;    // เวลาไทย ISO
}

// ---------- หน้าเว็บ → ห้อง ----------
export type ClientFrame =
  | { type: 'send'; clientId: string; body: string; kind?: 'text' | FileKind; fileId?: string }
  | { type: 'sync'; afterSeq: number }
  | { type: 'read'; seq: number }
  | { type: 'presence'; visible: boolean } // เฟส 3: หน้าจอห้องนี้เปิดอยู่ไหม (เปิดอยู่ = ไม่ส่งแจ้งเตือน)
  | { type: 'ping' };

// ---------- ห้อง → หน้าเว็บ ----------
export type ServerFrame =
  | { type: 'message'; message: ChatMessage }
  | { type: 'ack'; clientId: string; seq: number }
  | { type: 'sync'; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'error'; clientId?: string; code: string; message: string }
  | { type: 'warning'; code: string; message: string }
  | { type: 'pong' };
