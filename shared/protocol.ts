// =====================================================================
// shared/protocol.ts — รูปแบบข้อความระหว่างหน้าเว็บ ↔ ห้องแชท (WebSocket) ใช้ร่วมกันทั้งสองฝั่ง
// =====================================================================

export const MAX_MESSAGE_CHARS = 4000;
export const SYNC_LIMIT = 200;
export const HISTORY_LIMIT = 50;

// ---------- ไฟล์ (เฟส 2) ----------
export type FileKind = 'image' | 'file' | 'voice' | 'video';  // video: 2026-11-17
export const FILE_RETENTION_DAYS = 180;
export const MAX_BYTES: Record<FileKind, number> = {
  image: 10 * 1024 * 1024,  // 10MB
  file: 25 * 1024 * 1024,   // 25MB
  voice: 8 * 1024 * 1024,   // 8MB (เสียง 5 นาทีใช้ราว 2–5MB)
  video: 50 * 1024 * 1024,  // 50MB ไม่ย่อ (ผู้ใช้เลือก 2026-11-17) — Worker รับได้ไม่เกิน 100MB ต่อคำขอ
};
export const MAX_VOICE_SECONDS = 300;
export const IMAGE_MAX_SIDE = 1600;
/** ชนิดรูปที่รับ (ไม่รับ SVG เพราะฝังสคริปต์ได้) */
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
/** ชนิดเสียงที่รับ (ตัด ;codecs=... ออกก่อนเทียบ) */
export const VOICE_MIMES = ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/aac'];
/** ชนิดวิดีโอที่รับ — .mov จาก iPhone (HEVC) Android บางรุ่นเล่นไม่ได้ → หน้าเว็บแสดงปุ่มดาวน์โหลดแทน */
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'];

// ---------- อัลบั้ม / โพล (2026-11-17) ----------
/** รูป/วิดีโอที่เลือกพร้อมกันได้ albumId เดียวกัน → หน้าเว็บรวมเป็นตารางในบับเบิลเดียว (แต่ละรูปยังเป็นข้อความแยก) */
export const ALBUM_MAX = 20;
export const POLL_MAX_OPTIONS = 10;
export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 100;
/** สร้างโพล: หน้าเว็บส่งมาใน extra.pollCreate (ห้องตรวจแล้วเก็บในตาราง polls — ไม่เก็บใน extra) */
export interface PollCreate { options: string[]; multi: boolean; closesAt: string | null }
/** สถานะโพลที่ห้องแนบไปกับข้อความ kind = 'poll' (body = คำถาม) — ผู้ใช้เลือก: เห็นชื่อคนโหวต */
export interface PollState {
  options: { text: string; voters: { id: string; name: string }[] }[];
  multi: boolean;
  closesAt: string | null;   // เวลาไทย — เลยแล้ว = ปิดโหวต
  closedAt: string | null;   // ปิดก่อนเวลาโดยคนสร้าง/แอดมิน
  createdBy: string;
}

// ---------- รีแอคชัน (2026-11-17): 6 ตัวตายตัวแบบ LINE · คนละ 1 อัน ----------
export const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'] as const;
export interface ReactionGroup { emoji: string; users: { id: string; name: string }[] }

/** อ่านแล้ว (2026-11-17): สมาชิกแต่ละคนอ่านถึงข้อความไหน · joinedAt ใช้ไม่นับคนที่เข้าห้องทีหลังข้อความ
 *  ชาเนล: ส่งให้เฉพาะเจ้าของ/แอดมิน และไม่ส่งชื่อ (ผู้ใช้เลือก: เห็นแค่จำนวน) */
export interface ReadState { userId: string; name?: string; seq: number; joinedAt: string }

/** ข้อความที่ถูกตอบกลับ (ห้องเติมข้อมูลจริงให้เอง หน้าเว็บส่งมาแค่ seq) */
export interface ReplyRef { seq: number; senderId?: string; senderName?: string; snippet?: string }

/** ข้อมูลเสริมของข้อความ — การ์ดฟอร์ม { formId, formTitle } · ออเดอร์ { orderId }
 *  แจ้งเตือน: silent = ส่งแบบเงียบ (ไม่เด้ง) · replyTo = ตอบกลับข้อความไหน */
export interface MessageExtra {
  formId?: string; formTitle?: string; orderId?: number; silent?: boolean; replyTo?: ReplyRef;
  stickerId?: string;   // เฟส 5: ข้อความชนิด sticker
  noteId?: string;      // เฟส 5: ข้อความแจ้ง "โน้ตใหม่" ในห้อง (แตะเพื่อเปิดโน้ต)
  forwardedFrom?: string; // ส่งต่อ: ชื่อผู้ส่งต้นฉบับ (worker ใส่ให้เท่านั้น — หน้าเว็บส่งมาเองไม่ได้)
  albumId?: string;       // อัลบั้ม: รูป/วิดีโอที่ส่งพร้อมกัน
  pollCreate?: PollCreate; // สร้างโพล (ขาเข้าเท่านั้น — ห้องไม่เก็บไว้ใน extra)
}

/** สิ่งที่ส่งถึงแอปของผู้ใช้ (UserHub) เมื่อมีข้อความใหม่ในห้องที่ไม่ได้เปิดดูอยู่ */
export interface ActivityFrame {
  type: 'activity';
  roomId: string;
  notify: boolean;        // ควรเด้งแบนเนอร์ในแอปไหม (ผ่านกฎปิดเสียง/ตั้งค่าแล้ว)
  title: string;
  body: string;
  unread: number;         // ยังไม่อ่านรวมทุกห้อง (ไม่นับห้องที่ปิดเสียง) — ใช้ทำตัวเลขบนไอคอน
}

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
  kind: 'text' | FileKind | 'form' | 'sticker' | 'poll';  // form = การ์ดฟอร์มรับออเดอร์ (เฟส 4) · sticker (เฟส 5) · poll (DO v7)
  body: string;         // ข้อความ หรือคำบรรยายใต้ไฟล์ (ว่างได้ถ้าเป็นไฟล์)
  file: FileInfo | null;
  extra: MessageExtra | null;
  createdAt: string;    // เวลาไทย ISO
  /** ลบแล้ว (ยกเลิกส่งโดยผู้ส่ง / ลบโดยแอดมินห้อง) — body/file/extra ถูกล้าง เหลือแค่ร่องรอย */
  deleted?: { at: string; by: 'sender' | 'admin' } | null;
  /** รีแอคชัน (DO v6) — ว่าง = ยังไม่มีใครกด */
  reactions?: ReactionGroup[];
  /** โพล (DO v7) — มีเมื่อ kind = 'poll' */
  poll?: PollState;
}

// ---------- หน้าเว็บ → ห้อง ----------
export type ClientFrame =
  | { type: 'send'; clientId: string; body: string; kind?: ChatMessage['kind']; fileId?: string; extra?: MessageExtra }
  | { type: 'sync'; afterSeq: number }
  | { type: 'read'; seq: number }
  | { type: 'presence'; visible: boolean } // เฟส 3: หน้าจอห้องนี้เปิดอยู่ไหม (เปิดอยู่ = ไม่ส่งแจ้งเตือน)
  | { type: 'presence-app'; visible: boolean }  // UserHub: แอปเปิดอยู่บนจอไหม (ใช้แทนแจ้งเตือนมือถือ)
  | { type: 'react'; seq: number; emoji: string | null }  // null = เอารีแอคชันของตัวเองออก
  | { type: 'typing' }                                   // กำลังพิมพ์ (หน้าเว็บส่งไม่เกินทุก 3 วิ)
  | { type: 'vote'; seq: number; options: number[] }    // โหวต: แทนที่คำตอบเดิมทั้งหมด ([] = ถอนโหวต)
  | { type: 'poll_close'; seq: number }                 // ปิดโหวตก่อนเวลา (คนสร้าง / เจ้าของ-แอดมินห้อง)
  | { type: 'hide'; seq: number }                       // ลบข้อความเฉพาะฝั่งฉัน (คนอื่นยังเห็น)
  | { type: 'ping' };

// ---------- ห้อง → หน้าเว็บ ----------
export type ServerFrame =
  | { type: 'message'; message: ChatMessage }
  | { type: 'ack'; clientId: string; seq: number }
  | { type: 'sync'; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'error'; clientId?: string; code: string; message: string }
  | { type: 'warning'; code: string; message: string }
  | { type: 'pong' }
  | { type: 'room_update' }   // ข้อมูลห้องเปลี่ยน (เช่น ปักหมุด) → หน้าเว็บโหลดข้อมูลห้องใหม่
  | { type: 'reads'; reads: ReadState[] }          // อ่านแล้ว: ทั้งห้อง (ส่งหลัง sync)
  | { type: 'read'; userId: string; seq: number }  // อ่านแล้ว: มีคนอ่านเพิ่ม
  | { type: 'reactions'; seq: number; reactions: ReactionGroup[] }
  | { type: 'typing'; userId: string; name: string }
  | { type: 'poll'; seq: number; poll: PollState }
  | { type: 'hidden'; seq: number }                     // ลบเฉพาะฝั่งฉันแล้ว → ส่งให้ทุกเครื่องของคนนี้
  | ActivityFrame;
