// =====================================================================
// room-links.ts — ลิงก์ของกลุ่ม/ชาเนล (2026-11-18)
//   ผู้ใช้เลือก: เจ้าของ/แอดมินห้องเพิ่ม/แก้/ลบ · สมาชิกดูและกด · กลุ่ม + ชาเนล · แถบด่วนในห้อง + หน้ารวม
//                ไอคอน 3 แบบ: ดึงจากเว็บอัตโนมัติ / อัปรูปเอง / อีโมจิ + สี (ดึงไม่ได้ → ตัวอักษร + แจ้งเหตุผล)
//   ไฟล์นี้ = ตรวจข้อมูล + อ่าน/เขียน D1 + ไอคอน · ตรวจสิทธิ์ในห้อง + แจ้งในห้องอยู่ที่ index.ts (requireLinkEditor)
//   ความปลอดภัย (BUGS-25): ลิงก์รับเฉพาะ http/https (กัน javascript: ที่กดแล้วรันสคริปต์บนโดเมนเรา)
// =====================================================================

import { nowThai } from '../shared/time';
import {
  LINK_CATEGORY_MAX, LINK_COLORS, LINK_TITLE_MAX, LinkColor, LinkIconKind, ROOM_LINKS_MAX, ROOM_LINKS_PINNED_MAX, RoomLink,
} from '../shared/protocol';
import { ApiError, Env, db, newId } from './lib';
import { fetchSiteIcon } from './link-preview';
import { dropPicture, pictureUrl, storePicture } from './profile';

type LinkRow = {
  id: string; room_id: string; title: string; url: string; category: string | null; icon_kind: LinkIconKind;
  icon_value: string | null; color: string | null; pinned: number; sort: number; created_by: string; created_at: string;
};

const isColor = (v: unknown): v is LinkColor => typeof v === 'string' && (LINK_COLORS as readonly string[]).includes(v);

export const linkOut = (r: LinkRow): RoomLink => ({
  id: r.id, title: r.title, url: r.url, category: r.category, pinned: r.pinned === 1,
  icon: {
    kind: r.icon_kind,
    pictureUrl: (r.icon_kind === 'auto' || r.icon_kind === 'upload') && r.icon_value ? pictureUrl(r.icon_value) : null,
    emoji: r.icon_kind === 'emoji' ? r.icon_value : null,
    color: isColor(r.color) ? r.color : 'blue',
  },
  createdBy: r.created_by, createdAt: r.created_at,
});

// ---------------------------------------------------------------------
// ตรวจข้อมูลที่ส่งมา
// ---------------------------------------------------------------------
const textLen = (s: string) => [...s].length;
const hasHidden = (s: string) => /[\p{Cc}\p{Cf}]/u.test(s.replace(/‍/g, ''));

/** ลิงก์ที่กดได้: http/https เท่านั้น (ห้าม javascript:, data:, file: ฯลฯ) · ไม่มีชื่อผู้ใช้/รหัสผ่านในลิงก์ */
export function cleanLinkUrl(v: unknown): string {
  const raw = typeof v === 'string' ? v.trim() : '';
  if (!raw) throw new ApiError(400, 'BAD_URL', 'กรุณาใส่ลิงก์');
  if (raw.length > 2000) throw new ApiError(400, 'BAD_URL', 'ลิงก์ยาวเกิน 2,000 ตัวอักษร');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(400, 'BAD_URL', 'ลิงก์ไม่ถูกต้อง — ต้องขึ้นต้นด้วย https:// หรือ http://');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ApiError(400, 'BAD_URL', 'รองรับเฉพาะลิงก์ที่ขึ้นต้นด้วย https:// หรือ http://');
  if (u.username || u.password) throw new ApiError(400, 'BAD_URL', 'ลิงก์ที่มีชื่อผู้ใช้/รหัสผ่านในตัวไม่รองรับ (ไม่ปลอดภัย)');
  return u.toString();
}

function cleanTitle(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/\s+/gu, ' ').trim() : '';
  if (!t) throw new ApiError(400, 'BAD_TITLE', 'กรุณาตั้งชื่อลิงก์');
  if (textLen(t) > LINK_TITLE_MAX) throw new ApiError(400, 'BAD_TITLE', `ชื่อลิงก์ยาวเกิน ${LINK_TITLE_MAX} ตัวอักษร`);
  if (hasHidden(t)) throw new ApiError(400, 'BAD_TITLE', 'ชื่อลิงก์มีอักขระพิเศษที่มองไม่เห็น');
  return t;
}

function cleanCategory(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = typeof v === 'string' ? v.replace(/\s+/gu, ' ').trim() : '';
  if (!t) return null;
  if (textLen(t) > LINK_CATEGORY_MAX) throw new ApiError(400, 'BAD_CATEGORY', `ชื่อหมวดยาวเกิน ${LINK_CATEGORY_MAX} ตัวอักษร`);
  if (hasHidden(t)) throw new ApiError(400, 'BAD_CATEGORY', 'ชื่อหมวดมีอักขระพิเศษที่มองไม่เห็น');
  return t;
}

/** อีโมจิ 1 ตัว (รวมแบบต่อกันด้วย ZWJ) — ต้องมีอีโมจิจริง ไม่รับตัวหนังสือ */
function cleanEmoji(v: unknown): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t || textLen(t) > 8 || !/\p{Extended_Pictographic}/u.test(t)) throw new ApiError(400, 'BAD_EMOJI', 'เลือกอีโมจิ 1 ตัว');
  return t;
}

export interface LinkInput {
  url: string; title: string; category: string | null; pinned: boolean;
  icon: { kind: 'auto' | 'emoji' | 'letter' | 'keep'; emoji?: string; color: LinkColor };
}

/** body: { url, title, category, pinned, icon: { kind: 'auto'|'emoji'|'letter'|'keep', emoji?, color? } } */
export function cleanLinkInput(body: Record<string, unknown>, editing: boolean): LinkInput {
  const icon = (body.icon ?? {}) as Record<string, unknown>;
  const kind = icon.kind ?? 'auto';
  if (kind !== 'auto' && kind !== 'emoji' && kind !== 'letter' && !(editing && kind === 'keep')) {
    throw new ApiError(400, 'BAD_ICON_KIND', 'ชนิดไอคอนไม่ถูกต้อง (อัปรูปใช้ปุ่มอัปโหลดแยก)');
  }
  if (icon.color !== undefined && !isColor(icon.color)) throw new ApiError(400, 'BAD_COLOR', 'สีไอคอนไม่ถูกต้อง');
  return {
    url: cleanLinkUrl(body.url),
    title: cleanTitle(body.title),
    category: cleanCategory(body.category),
    pinned: body.pinned === true,
    icon: { kind, emoji: kind === 'emoji' ? cleanEmoji(icon.emoji) : undefined, color: isColor(icon.color) ? icon.color : 'blue' },
  };
}

// ---------------------------------------------------------------------
// อ่าน / เขียน
// ---------------------------------------------------------------------
export async function listLinks(env: Env, roomId: string): Promise<RoomLink[]> {
  const rows = await db('อ่านลิงก์ของกลุ่ม', () =>
    env.DB.prepare(`SELECT * FROM room_links WHERE room_id = ? ORDER BY sort, created_at`).bind(roomId).all<LinkRow>(),
  );
  return rows.results.map(linkOut);
}

async function loadLink(env: Env, roomId: string, linkId: string): Promise<LinkRow> {
  const r = await db('อ่านลิงก์', () =>
    env.DB.prepare(`SELECT * FROM room_links WHERE id = ? AND room_id = ?`).bind(linkId, roomId).first<LinkRow>(),
  );
  if (!r) throw new ApiError(404, 'LINK_NOT_FOUND', 'ไม่พบลิงก์นี้ (อาจถูกลบไปแล้ว)');
  return r;
}

/** ดึงไอคอนจากเว็บแล้วเก็บ R2 → { id } · ไม่สำเร็จ → { warning } (ผู้เรียกใช้ตัวอักษรแทน และแจ้งผู้ใช้) */
async function autoIcon(env: Env, url: string): Promise<{ id: string } | { warning: string }> {
  try {
    const icon = await fetchSiteIcon(url);
    return { id: await storePicture(env, icon) };
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('ดึงไอคอนเว็บไม่สำเร็จ', url, err);
    return { warning: `บันทึกลิงก์แล้ว แต่${err instanceof ApiError ? err.message : 'ดึงไอคอนจากเว็บไม่สำเร็จ'} — ใช้ไอคอนตัวอักษรแทน (เปลี่ยนได้ที่แก้ไขลิงก์)` };
  }
}

/** จองที่ในคำสั่งเดียว (กดพร้อมกันไม่เกิน 50 ลิงก์ / 8 หมุด — เหมือน BUGS-09) */
export async function createLink(env: Env, roomId: string, userId: string, inp: LinkInput) {
  const id = newId();
  const now = nowThai();
  let icon: { kind: LinkIconKind; value: string | null } = inp.icon.kind === 'emoji'
    ? { kind: 'emoji', value: inp.icon.emoji ?? null } : { kind: 'letter', value: null };
  let warning: string | null = null;
  if (inp.icon.kind === 'auto') {
    const r = await autoIcon(env, inp.url);
    if ('id' in r) icon = { kind: 'auto', value: r.id }; else warning = r.warning;
  }
  const res = await db('บันทึกลิงก์', () =>
    env.DB.prepare(
      `INSERT INTO room_links (id, room_id, title, url, category, icon_kind, icon_value, color, pinned, sort, created_by, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, COALESCE((SELECT MAX(sort) FROM room_links WHERE room_id = ?2), 0) + 1, ?10, ?11, ?11
       WHERE (SELECT COUNT(*) FROM room_links WHERE room_id = ?2) < ?12
         AND (?9 = 0 OR (SELECT COUNT(*) FROM room_links WHERE room_id = ?2 AND pinned = 1) < ?13)`,
    ).bind(id, roomId, inp.title, inp.url, inp.category, icon.kind, icon.value, inp.icon.color, inp.pinned ? 1 : 0,
      userId, now, ROOM_LINKS_MAX, ROOM_LINKS_PINNED_MAX).run(),
  );
  if (res.meta.changes !== 1) {
    if (icon.kind === 'auto') await dropPicture(env, icon.value);
    throw await limitError(env, roomId);
  }
  return { link: linkOut(await loadLink(env, roomId, id)), warning };
}

async function limitError(env: Env, roomId: string): Promise<ApiError> {
  const n = await db('นับลิงก์', () =>
    env.DB.prepare(`SELECT COUNT(*) AS total, SUM(pinned) AS pinned FROM room_links WHERE room_id = ?`).bind(roomId)
      .first<{ total: number; pinned: number | null }>(),
  );
  if ((n?.total ?? 0) >= ROOM_LINKS_MAX) return new ApiError(409, 'LINK_LIMIT', `ห้องนี้มีลิงก์ครบ ${ROOM_LINKS_MAX} อันแล้ว — ลบอันที่ไม่ใช้ก่อน`);
  return new ApiError(409, 'PINNED_LIMIT', `แถบลิงก์ด่วนปักได้สูงสุด ${ROOM_LINKS_PINNED_MAX} อัน — เลิกปักอันอื่นก่อน หรือบันทึกแบบไม่ปัก`);
}

export async function updateLink(env: Env, roomId: string, linkId: string, inp: LinkInput) {
  const old = await loadLink(env, roomId, linkId);
  let icon: { kind: LinkIconKind; value: string | null } = { kind: old.icon_kind, value: old.icon_value };
  let warning: string | null = null;
  if (inp.icon.kind === 'emoji') icon = { kind: 'emoji', value: inp.icon.emoji ?? null };
  else if (inp.icon.kind === 'letter') icon = { kind: 'letter', value: null };
  else if (inp.icon.kind === 'auto' && (old.icon_kind !== 'auto' || old.url !== inp.url)) {
    const r = await autoIcon(env, inp.url);  // เปลี่ยนเป็นอัตโนมัติ หรือเปลี่ยนลิงก์ → ดึงไอคอนใหม่
    if ('id' in r) icon = { kind: 'auto', value: r.id }; else { icon = { kind: 'letter', value: null }; warning = r.warning; }
  }
  const res = await db('แก้ลิงก์', () =>
    env.DB.prepare(
      `UPDATE room_links SET title = ?1, url = ?2, category = ?3, icon_kind = ?4, icon_value = ?5, color = ?6, pinned = ?7, updated_at = ?8
       WHERE id = ?9 AND room_id = ?10
         AND (?7 = 0 OR pinned = 1 OR (SELECT COUNT(*) FROM room_links WHERE room_id = ?10 AND pinned = 1) < ?11)`,
    ).bind(inp.title, inp.url, inp.category, icon.kind, icon.value, inp.icon.color, inp.pinned ? 1 : 0, nowThai(),
      linkId, roomId, ROOM_LINKS_PINNED_MAX).run(),
  );
  if (res.meta.changes !== 1) {
    if (icon.value !== old.icon_value && (icon.kind === 'auto')) await dropPicture(env, icon.value);
    throw await limitError(env, roomId);
  }
  // รูปไอคอนเดิมไม่ได้ใช้แล้ว → ลบ
  if ((old.icon_kind === 'auto' || old.icon_kind === 'upload') && old.icon_value !== icon.value) await dropPicture(env, old.icon_value);
  return { link: linkOut(await loadLink(env, roomId, linkId)), warning };
}

export async function deleteLink(env: Env, roomId: string, linkId: string) {
  const old = await loadLink(env, roomId, linkId);
  await db('ลบลิงก์', () => env.DB.prepare(`DELETE FROM room_links WHERE id = ? AND room_id = ?`).bind(linkId, roomId).run());
  if (old.icon_kind === 'auto' || old.icon_kind === 'upload') await dropPicture(env, old.icon_value);
  return old.title;
}

/** อัปรูปไอคอนเอง (ครอปแล้วจากหน้าเว็บ) */
export async function setLinkIcon(env: Env, roomId: string, linkId: string, pic: { bytes: Uint8Array; mime: string }) {
  const old = await loadLink(env, roomId, linkId);
  const id = await storePicture(env, pic);
  try {
    await env.DB.prepare(`UPDATE room_links SET icon_kind = 'upload', icon_value = ?, updated_at = ? WHERE id = ? AND room_id = ?`)
      .bind(id, nowThai(), linkId, roomId).run();
  } catch (err) {
    console.error('บันทึกไอคอนลิงก์ลง D1 ไม่สำเร็จ', err);
    await dropPicture(env, id);
    throw new ApiError(500, 'DB_FAILED', 'บันทึกไอคอนไม่สำเร็จ กรุณาลองใหม่');
  }
  if (old.icon_kind === 'auto' || old.icon_kind === 'upload') await dropPicture(env, old.icon_value);
  return linkOut(await loadLink(env, roomId, linkId));
}
