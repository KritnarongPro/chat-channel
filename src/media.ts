// =====================================================================
// media.ts — งานไฟล์ฝั่งหน้าเว็บ: ย่อรูป, เลือกรูปแบบอัดเสียง, แสดงขนาดไฟล์
// =====================================================================

import { IMAGE_MAX_SIDE, IMAGE_MIMES, VIDEO_MIMES } from '../shared/protocol';

export interface PreparedImage { blob: Blob; mime: string; name: string; width: number; height: number }

/**
 * ย่อรูปให้ด้านยาวสุดไม่เกิน 1600px แล้วบันทึกเป็น JPEG
 * GIF ไม่ย่อ (จะเสียภาพเคลื่อนไหว) · ถ้าย่อแล้วใหญ่กว่าเดิม ใช้ไฟล์เดิม
 * อ่านรูปไม่ได้ (เช่น HEIC บนเครื่องที่ไม่รองรับ) → throw พร้อมเหตุผล
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('เครื่องนี้อ่านรูปนี้ไม่ได้ (อาจเป็น HEIC) — ลองกด "ส่งเป็นไฟล์" แทน');
  }
  const { width, height } = bmp;
  if (file.type === 'image/gif') {
    bmp.close();
    return { blob: file, mime: file.type, name: file.name, width, height };
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bmp.close(); throw new Error('ย่อรูปไม่ได้ (เบราว์เซอร์ไม่รองรับ canvas)'); }
  ctx.fillStyle = '#fff'; // PNG โปร่งใส → พื้นขาว
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  if (!blob) throw new Error('ย่อรูปไม่สำเร็จ — ลองกด "ส่งเป็นไฟล์" แทน');
  const base = file.name.replace(/\.[^.]+$/, '') || 'รูปภาพ';
  if (blob.size >= file.size && scale === 1 && IMAGE_MIMES.includes(file.type)) {
    return { blob: file, mime: file.type, name: file.name, width, height };
  }
  return { blob, mime: 'image/jpeg', name: `${base}.jpg`, width: w, height: h };
}

/** รูปแบบอัดเสียง: MP4 (AAC) ก่อน เพราะเล่นได้ทุกเครื่องรวม iPhone · ไม่มีจึงใช้ WebM/Ogg (Opus) */
export function pickVoiceMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function voiceExt(mime: string): string {
  return mime.startsWith('audio/mp4') ? 'm4a' : mime.startsWith('audio/ogg') ? 'ogg' : 'webm';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- วิดีโอ (2026-11-17): ไม่ย่อ (ผู้ใช้เลือก 50MB) — อ่านแค่ขนาดภาพ + ความยาว ----------
export interface PreparedVideo { blob: Blob; mime: string; name: string; width?: number; height?: number; durationMs?: number }

/** ตรวจชนิด + อ่านขนาด/ความยาว (อ่านไม่ได้ เช่น HEVC บน Android → ยังส่งได้ แค่ไม่มีข้อมูลขนาด) */
export async function prepareVideo(file: File): Promise<PreparedVideo> {
  const mime = (file.type || '').toLowerCase() || (file.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : '');
  if (!VIDEO_MIMES.includes(mime)) {
    throw new Error(`ชนิดวิดีโอไม่รองรับ (${mime || 'ไม่ทราบชนิด'}) — รองรับ MP4, MOV, WEBM, 3GP · ลองกด "ส่งเป็นไฟล์" แทน`);
  }
  const url = URL.createObjectURL(file);
  try {
    const meta = await new Promise<{ w: number; h: number; d: number } | null>((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const done = (r: { w: number; h: number; d: number } | null) => { clearTimeout(t); resolve(r); };
      const t = window.setTimeout(() => done(null), 5000);
      v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight, d: v.duration });
      v.onerror = () => done(null);
      v.src = url;
    });
    return {
      blob: file, mime, name: file.name || 'วิดีโอ',
      width: meta?.w || undefined, height: meta?.h || undefined,
      durationMs: meta && Number.isFinite(meta.d) ? Math.round(meta.d * 1000) : undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
