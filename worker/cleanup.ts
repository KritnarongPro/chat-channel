// =====================================================================
// worker/cleanup.ts — งานตามเวลา (ทุกวัน 03:00 เวลาไทย)
//   1. ไฟล์ครบ 180 วัน → ลบตัวไฟล์ใน R2 + ตั้ง status = 'expired' (เก็บแถวไว้เป็นประวัติ)
//   2. ไฟล์ที่อัปแล้วไม่ได้ส่งเป็นข้อความเกิน 1 วัน → ลบตัวไฟล์ใน R2 + ลบแถว
// ผิดพลาด → console.error พร้อมเหตุผล (ดูได้ใน Workers → Logs) แล้วรอบหน้าจะลองใหม่เอง
// =====================================================================

import { nowThai, toThaiIso } from '../shared/time';
import type { Env } from './lib';

const BATCH = 500;

export async function cleanupFiles(env: Env) {
  const now = nowThai();
  const dayAgo = toThaiIso(Date.now() - 86400_000);
  let expired = 0;
  let orphans = 0;

  // ---------- 1. ครบ 180 วัน ----------
  try {
    const rows = await env.DB.prepare(
      `SELECT id, r2_key FROM files WHERE status <> 'expired' AND expires_at < ? LIMIT ?`,
    ).bind(now, BATCH).all<{ id: string; r2_key: string }>();
    if (rows.results.length) {
      await env.FILES.delete(rows.results.map((r) => r.r2_key));
      await env.DB.batch(rows.results.map((r) =>
        env.DB.prepare(`UPDATE files SET status = 'expired' WHERE id = ?`).bind(r.id)));
      expired = rows.results.length;
    }
  } catch (err) {
    console.error('cleanup: ลบไฟล์ครบ 180 วันไม่สำเร็จ', err);
  }

  // ---------- 2. อัปแล้วไม่ได้ส่ง ----------
  try {
    const rows = await env.DB.prepare(
      `SELECT id, r2_key FROM files WHERE status = 'uploaded' AND created_at < ? LIMIT ?`,
    ).bind(dayAgo, BATCH).all<{ id: string; r2_key: string }>();
    if (rows.results.length) {
      await env.FILES.delete(rows.results.map((r) => r.r2_key));
      await env.DB.batch(rows.results.map((r) =>
        env.DB.prepare(`DELETE FROM files WHERE id = ? AND status = 'uploaded'`).bind(r.id)));
      orphans = rows.results.length;
    }
  } catch (err) {
    console.error('cleanup: ลบไฟล์ที่อัปแล้วไม่ได้ส่งไม่สำเร็จ', err);
  }

  console.log(`cleanup ${now}: หมดอายุ ${expired} ไฟล์, ค้างไม่ได้ส่ง ${orphans} ไฟล์`);
}
