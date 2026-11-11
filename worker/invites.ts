// =====================================================================
// worker/invites.ts — ลิงก์เชิญเข้าชาเนล/กลุ่ม (ใช้ทั้ง API และตอนล็อกอิน LINE ผ่านลิงก์)
//   - ตรวจลิงก์: ไม่พบ / ถูกยกเลิก / หมดอายุ / คนเต็ม → ตอบเหตุผลภาษาไทย
//   - ใช้ลิงก์: คนรออนุมัติ → อนุมัติทันที (ตามที่เลือกไว้) + เข้าห้องทันที · เป็นสมาชิกอยู่แล้ว → พาไปห้องเฉย ๆ
// =====================================================================

import { nowThai } from '../shared/time';
import { ApiError, Env, User, db } from './lib';

export interface InviteRow {
  code: string; room_id: string; created_by: string; created_at: string; expires_at: string | null;
  max_uses: number | null; use_count: number; revoked_at: string | null;
}

/** สถานะลิงก์ — null = ใช้ได้ · ไม่ใช่ null = รหัส + เหตุผล */
export function inviteProblem(inv: InviteRow | null): { code: string; message: string } | null {
  if (!inv) return { code: 'INVITE_NOT_FOUND', message: 'ไม่พบลิงก์เชิญนี้ (พิมพ์ผิดหรือถูกลบแล้ว)' };
  if (inv.revoked_at) return { code: 'INVITE_REVOKED', message: 'ลิงก์เชิญนี้ถูกยกเลิกแล้ว ขอลิงก์ใหม่จากแอดมินของห้อง' };
  if (inv.expires_at && inv.expires_at < nowThai()) return { code: 'INVITE_EXPIRED', message: 'ลิงก์เชิญนี้หมดอายุแล้ว ขอลิงก์ใหม่จากแอดมินของห้อง' };
  if (inv.max_uses !== null && inv.use_count >= inv.max_uses) return { code: 'INVITE_FULL', message: 'ลิงก์เชิญนี้มีคนใช้ครบจำนวนแล้ว ขอลิงก์ใหม่จากแอดมินของห้อง' };
  return null;
}

export async function loadInvite(env: Env, code: string): Promise<InviteRow | null> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return null;
  return db('อ่านลิงก์เชิญ', () => env.DB.prepare(`SELECT * FROM invite_links WHERE code = ?`).bind(code).first<InviteRow>());
}

/** ใช้ลิงก์เชิญ → คืน roomId · ไม่ผ่านเงื่อนไข → ApiError พร้อมเหตุผล */
export async function redeemInvite(env: Env, code: string, user: Pick<User, 'id' | 'status'>): Promise<{ roomId: string; already: boolean }> {
  if (user.status === 'blocked') throw new ApiError(403, 'BLOCKED', 'บัญชีนี้ถูกระงับการใช้งาน');
  const inv = await loadInvite(env, code);
  if (!inv) { const p = inviteProblem(null)!; throw new ApiError(410, p.code, p.message); }
  const room = await db('อ่านห้องของลิงก์', () =>
    env.DB.prepare(`SELECT id, type, last_seq FROM rooms WHERE id = ?`).bind(inv.room_id).first<{ id: string; type: string; last_seq: number }>(),
  );
  if (!room || room.type === 'dm') throw new ApiError(410, 'INVITE_NOT_FOUND', 'ห้องของลิงก์นี้ไม่มีแล้ว');

  // เป็นสมาชิกอยู่แล้ว → พาไปห้องเลย แม้ลิงก์จะเต็ม/หมดอายุ/ถูกยกเลิกแล้วก็ตาม (ต้องตรวจก่อน inviteProblem — BUGS-10)
  const member = await db('ตรวจสมาชิก', () =>
    env.DB.prepare(`SELECT 1 AS x FROM room_members WHERE room_id = ? AND user_id = ?`).bind(room.id, user.id).first(),
  );
  if (member) {
    if (user.status === 'pending') await approve(env, user.id); // เป็นสมาชิกแต่ยังรออนุมัติ (กรณีพิเศษ) → อนุมัติด้วย
    return { roomId: room.id, already: true };
  }

  const problem = inviteProblem(inv);
  if (problem) throw new ApiError(410, problem.code, problem.message);

  // จองที่ในลิงก์ก่อน (มีเงื่อนไขในคำสั่งเดียว กันคนกดพร้อมกันเกินจำนวน)
  const now = nowThai();
  const claim = await db('จองที่ในลิงก์เชิญ', () =>
    env.DB.prepare(
      `UPDATE invite_links SET use_count = use_count + 1
       WHERE code = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at >= ?) AND (max_uses IS NULL OR use_count < max_uses)`,
    ).bind(code, now).run(),
  );
  if (claim.meta.changes !== 1) throw new ApiError(410, 'INVITE_FULL', 'ลิงก์เชิญนี้ใช้ไม่ได้แล้ว (คนเต็มหรือหมดอายุพอดี) ขอลิงก์ใหม่จากแอดมินของห้อง');

  try {
    await env.DB.batch([
      ...(user.status === 'pending'
        ? [env.DB.prepare(`UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(now, user.id)]
        : []),
      // คนใหม่เห็นข้อความเก่าได้ แต่ไม่นับเป็น "ยังไม่อ่าน"
      env.DB.prepare(
        `INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at, last_read_seq) VALUES (?, ?, 'member', ?, ?)`,
      ).bind(room.id, user.id, now, room.last_seq),
      env.DB.prepare(`INSERT OR IGNORE INTO invite_uses (code, user_id, used_at) VALUES (?, ?, ?)`).bind(code, user.id, now),
    ]);
  } catch (err) {
    console.error('เข้าห้องผ่านลิงก์ไม่สำเร็จ', err);
    // คืนที่ที่จองไว้
    try {
      await env.DB.prepare(`UPDATE invite_links SET use_count = use_count - 1 WHERE code = ? AND use_count > 0`).bind(code).run();
    } catch (err2) {
      console.error('คืนจำนวนการใช้ลิงก์ไม่สำเร็จ', err2);
    }
    throw new ApiError(500, 'DB_FAILED', 'เข้าห้องไม่สำเร็จ (ฐานข้อมูลขัดข้อง) กรุณากดลิงก์อีกครั้ง');
  }
  return { roomId: room.id, already: false };
}

async function approve(env: Env, userId: string) {
  await db('อนุมัติผู้ใช้จากลิงก์เชิญ', () =>
    env.DB.prepare(`UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(nowThai(), userId).run(),
  );
}
