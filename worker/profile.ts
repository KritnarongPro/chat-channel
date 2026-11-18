// =====================================================================
// profile.ts — รูปโปรไฟล์ / ชื่อที่แสดง (2026-11-18 — ผู้ใช้เลือก: รูป + ชื่อ · ครอปวงกลมเอง · รูปกลุ่มด้วย · แอดมินรีเซ็ตรูปได้)
//
// เก็บ:  users.display_name / picture_url = ค่าที่แสดงจริง (จุดอื่นในระบบอ่านเหมือนเดิม ไม่ต้องแก้)
//        users.oauth_name / oauth_picture = ของ Gmail (หรือ LINE บัญชีเก่า) ล่าสุด → ปุ่ม "กลับไปใช้ของ Gmail"
//        users.name_custom = 1 / users.picture_id ไม่ว่าง → ล็อกอินห้ามเขียนทับ (auth-google.ts / auth-line.ts — BUGS-23)
//        รูปใน R2: pictures/<id> (ไม่อยู่ในตาราง files → cron 180 วันไม่ลบ) · เปลี่ยนรูป = ไอดีใหม่ → cache ได้ถาวร
// ไฟล์รูป: หน้าเว็บครอป + ย่อเป็น 256×256 JPEG ก่อนส่ง · เซิร์ฟเวอร์ตรวจชนิด (หัวไฟล์จริง ไม่เชื่อแค่ Content-Type) + ขนาด
// =====================================================================

import { nowThai } from '../shared/time';
import { PICTURE_MAX_BYTES, PICTURE_MIMES, PROFILE_NAME_MAX, PROFILE_NAME_MIN } from '../shared/protocol';
import { ApiError, Env, User, db, ok, readJson } from './lib';

interface PCtx { req: Request; env: Env; params: Record<string, string>; user: User | null }

export const pictureUrl = (id: string) => `/api/pictures/${id}`;
/** ชนิดที่เปิดเป็นรูปได้ = รูปโปรไฟล์ + ไอคอน .ico ของลิงก์ (room-links.ts) — ไม่มี SVG/HTML */
const SERVE_MIMES = [...PICTURE_MIMES, 'image/x-icon'];
const r2Key = (id: string) => `pictures/${id}`;
const ID_RE = /^[0-9a-f-]{36}$/;

// ---------------------------------------------------------------------
// ไฟล์รูป: อ่าน + ตรวจ → เก็บ R2 → ลบ
// ---------------------------------------------------------------------

/** หัวไฟล์จริงของ JPEG / PNG / WEBP — กันไฟล์อื่นที่แอบตั้ง Content-Type เป็นรูป */
function sniffImage(b: Uint8Array): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export async function readPicture(req: Request): Promise<{ bytes: Uint8Array; mime: string }> {
  const mime = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!PICTURE_MIMES.includes(mime)) throw new ApiError(415, 'BAD_PICTURE_TYPE', 'รูปโปรไฟล์รองรับเฉพาะ JPG, PNG, WEBP');
  const size = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(size) && size > PICTURE_MAX_BYTES) throw new ApiError(413, 'PICTURE_TOO_LARGE', `รูปใหญ่เกิน ${PICTURE_MAX_BYTES / 1024} KB`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch (err) {
    console.error('อ่านไฟล์รูปไม่สำเร็จ', err);
    throw new ApiError(400, 'NO_BODY', 'อ่านไฟล์รูปที่ส่งมาไม่ได้ กรุณาลองใหม่');
  }
  if (bytes.length === 0) throw new ApiError(400, 'NO_BODY', 'ไม่พบไฟล์รูปที่ส่งมา');
  if (bytes.length > PICTURE_MAX_BYTES) throw new ApiError(413, 'PICTURE_TOO_LARGE', `รูปใหญ่เกิน ${PICTURE_MAX_BYTES / 1024} KB`);
  const real = sniffImage(bytes);
  if (!real) throw new ApiError(415, 'NOT_AN_IMAGE', 'ไฟล์นี้ไม่ใช่รูป JPG / PNG / WEBP');
  return { bytes, mime: real };
}

export async function storePicture(env: Env, p: { bytes: Uint8Array; mime: string }): Promise<string> {
  const id = crypto.randomUUID();
  try {
    await env.FILES.put(r2Key(id), p.bytes, { httpMetadata: { contentType: p.mime } });
  } catch (err) {
    console.error('เขียนรูปลง R2 ไม่สำเร็จ', err);
    throw new ApiError(502, 'R2_FAILED', 'บันทึกรูปไม่สำเร็จ (ที่เก็บไฟล์ขัดข้อง) กรุณาลองใหม่');
  }
  return id;
}

/** ลบรูปเก่าที่ไม่ใช้แล้ว — ลบไม่ได้แค่บันทึก log (รูปใหม่บันทึกสำเร็จแล้ว ไม่ทำให้ผู้ใช้เห็นว่าล้ม) */
export async function dropPicture(env: Env, id: string | null | undefined) {
  if (!id) return;
  try {
    await env.FILES.delete(r2Key(id));
  } catch (err) {
    console.error('ลบรูปเก่าใน R2 ไม่สำเร็จ (ค้างไว้ในที่เก็บ)', id, err);
  }
}

// ---------------------------------------------------------------------
// GET /api/pictures/:pictureId — เปิดรูป (ต้องล็อกอิน) · nosniff + ชนิดจาก R2 ที่ตรวจแล้วตอนอัป (BUGS-04)
// ---------------------------------------------------------------------
export async function servePicture(c: PCtx) {
  const id = c.params.pictureId;
  if (!ID_RE.test(id)) throw new ApiError(404, 'PICTURE_NOT_FOUND', 'ไม่พบรูปนี้');
  let obj: R2ObjectBody | null;
  try {
    obj = await c.env.FILES.get(r2Key(id));
  } catch (err) {
    console.error('อ่านรูปจาก R2 ไม่สำเร็จ', err);
    throw new ApiError(502, 'R2_FAILED', 'เปิดรูปไม่สำเร็จ (ที่เก็บไฟล์ขัดข้อง)');
  }
  if (!obj) throw new ApiError(404, 'PICTURE_NOT_FOUND', 'ไม่พบรูปนี้ (อาจถูกเปลี่ยนแล้ว)');
  const mime = obj.httpMetadata?.contentType ?? '';
  return new Response(obj.body, {
    headers: {
      'Content-Type': SERVE_MIMES.includes(mime) ? mime : 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',  // เปลี่ยนรูป = ไอดีใหม่
    },
  });
}

// ---------------------------------------------------------------------
// โปรไฟล์ของฉัน
// ---------------------------------------------------------------------
type ProfileRow = { display_name: string; picture_url: string | null; oauth_name: string | null; oauth_picture: string | null; name_custom: number; picture_id: string | null };

async function loadProfile(env: Env, userId: string) {
  const r = await db('อ่านโปรไฟล์', () =>
    env.DB.prepare(`SELECT display_name, picture_url, oauth_name, oauth_picture, name_custom, picture_id FROM users WHERE id = ?`)
      .bind(userId).first<ProfileRow>(),
  );
  if (!r) throw new ApiError(404, 'USER_NOT_FOUND', 'ไม่พบบัญชีนี้');
  return r;
}

const profileOut = (r: ProfileRow) => ({
  displayName: r.display_name,
  pictureUrl: r.picture_url,
  nameCustom: r.name_custom === 1,
  pictureCustom: !!r.picture_id,
  oauthName: r.oauth_name,
  oauthPicture: r.oauth_picture,
});

export async function getMyProfile(c: PCtx) {
  return ok({ profile: profileOut(await loadProfile(c.env, c.user!.id)) });
}

/** ชื่อที่แสดง: ตัดช่องว่างหัวท้าย + ช่องว่างซ้อน · 2–40 ตัว (นับตามตัวอักษรจริง) · ห้ามอักขระควบคุม/ล่องหน */
export function cleanProfileName(v: unknown): string {
  if (typeof v !== 'string') throw new ApiError(400, 'BAD_NAME', 'กรุณาพิมพ์ชื่อ');
  const name = v.replace(/\s+/gu, ' ').trim();
  // \u200d (ZWJ) อยู่ในอีโมจิครอบครัว/อาชีพ → ยอมให้ผ่าน · อักขระควบคุม/ล่องหนอื่นไม่รับ
  if (/[\p{Cc}\p{Cf}]/u.test(name.replace(/\u200d/g, ''))) throw new ApiError(400, 'BAD_NAME', 'ชื่อมีอักขระพิเศษที่มองไม่เห็น กรุณาพิมพ์ใหม่');
  const len = [...name].length;
  if (len < PROFILE_NAME_MIN || len > PROFILE_NAME_MAX) {
    throw new ApiError(400, 'BAD_NAME', `ชื่อต้องมี ${PROFILE_NAME_MIN}–${PROFILE_NAME_MAX} ตัวอักษร (ตอนนี้ ${len})`);
  }
  return name;
}

/** POST /api/me/name { name: string | null } — null = กลับไปใช้ชื่อจาก Gmail */
export async function saveMyName(c: PCtx) {
  const body = await readJson<{ name?: unknown }>(c.req);
  const now = nowThai();
  if (body.name === null) {
    const r = await db('กลับไปใช้ชื่อจาก Gmail', () =>
      c.env.DB.prepare(`UPDATE users SET display_name = COALESCE(oauth_name, display_name), name_custom = 0, updated_at = ? WHERE id = ?`)
        .bind(now, c.user!.id).run(),
    );
    if (r.meta.changes !== 1) throw new ApiError(404, 'USER_NOT_FOUND', 'ไม่พบบัญชีนี้');
  } else {
    const name = cleanProfileName(body.name);
    const r = await db('บันทึกชื่อ', () =>
      c.env.DB.prepare(`UPDATE users SET display_name = ?, name_custom = 1, updated_at = ? WHERE id = ?`)
        .bind(name, now, c.user!.id).run(),
    );
    if (r.meta.changes !== 1) throw new ApiError(404, 'USER_NOT_FOUND', 'ไม่พบบัญชีนี้');
  }
  return ok({ profile: profileOut(await loadProfile(c.env, c.user!.id)) });
}

/** POST /api/me/picture — body = ไฟล์รูป (ครอป 256×256 แล้ว) */
export async function uploadMyPicture(c: PCtx) {
  const pic = await readPicture(c.req);
  const old = await loadProfile(c.env, c.user!.id);
  const id = await storePicture(c.env, pic);
  try {
    await c.env.DB.prepare(`UPDATE users SET picture_id = ?, picture_url = ?, updated_at = ? WHERE id = ?`)
      .bind(id, pictureUrl(id), nowThai(), c.user!.id).run();
  } catch (err) {
    console.error('บันทึกรูปโปรไฟล์ลง D1 ไม่สำเร็จ', err);
    await dropPicture(c.env, id);
    throw new ApiError(500, 'DB_FAILED', 'บันทึกรูปโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่');
  }
  await dropPicture(c.env, old.picture_id);
  return ok({ profile: profileOut(await loadProfile(c.env, c.user!.id)) }, 201);
}

/** รูปกลับเป็นของ Gmail + ลบไฟล์ที่อัปเอง — ใช้ทั้งเจ้าของบัญชีและแอดมินระบบ */
async function resetPicture(env: Env, userId: string, old: ProfileRow) {
  await db('กลับไปใช้รูปจาก Gmail', () =>
    env.DB.prepare(`UPDATE users SET picture_url = oauth_picture, picture_id = NULL, updated_at = ? WHERE id = ?`)
      .bind(nowThai(), userId).run(),
  );
  await dropPicture(env, old.picture_id);
}

export async function resetMyPicture(c: PCtx) {
  await resetPicture(c.env, c.user!.id, await loadProfile(c.env, c.user!.id));
  return ok({ profile: profileOut(await loadProfile(c.env, c.user!.id)) });
}

/** POST /api/admin/users/:id/reset-picture — แอดมินระบบลบรูปไม่เหมาะสม → กลับเป็นรูปจาก Gmail */
export async function adminResetPicture(c: PCtx) {
  const old = await loadProfile(c.env, c.params.id);
  if (!old.picture_id) throw new ApiError(400, 'NO_CUSTOM_PICTURE', 'ผู้ใช้นี้ใช้รูปจาก Gmail อยู่แล้ว ไม่มีรูปให้รีเซ็ต');
  await resetPicture(c.env, c.params.id, old);
  return ok({ reset: true });
}
