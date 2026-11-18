// =====================================================================
// worker/link-preview.ts — ตัวอย่างลิงก์ในแชท (2026-11-17)
//
// ผู้ใช้เลือก: หัวข้อ + รูป โดยรูปส่งผ่านเซิร์ฟเวอร์เรา → เว็บต้นทางไม่เห็น IP ของคนที่เปิดแชท
//   GET /api/link-preview?url=…        → อ่านหน้าเว็บ (og:title / og:description / og:image / <title>) เก็บใน D1 7 วัน
//   GET /api/link-preview/image?url=…  → ส่งรูปของลิงก์นั้นต่อให้ (เฉพาะรูปที่บันทึกไว้ในตาราง — ไม่ใช่ proxy เปิดอะไรก็ได้)
//
// กันเซิร์ฟเวอร์เราถูกใช้ยิงเข้าเครื่องภายใน (SSRF): http/https เท่านั้น · พอร์ตมาตรฐาน · ห้าม IP ตรง ๆ / localhost / .local / .internal
//   ตรวจซ้ำทุกครั้งที่เว็บสั่ง redirect (สูงสุด 3 ครั้ง) · รอไม่เกิน 5 วิ · อ่านหน้าเว็บไม่เกิน 512KB · รูปไม่เกิน 3MB และไม่รับ SVG
// ดึงไม่ได้ → เก็บเหตุผลไว้ (1 วัน) แล้วตอบเหตุผลให้หน้าเว็บแสดง ไม่ข้ามเงียบ
// =====================================================================

import { nowThai, thaiAfter } from '../shared/time';
import { ApiError, db, ok, type Env } from './lib';

const OK_TTL_MS = 7 * 86400_000;
const FAIL_TTL_MS = 86400_000;
const TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const UA = 'Mozilla/5.0 (compatible; ChatChannelLinkPreview/1.0; +https://noti.kalon-ai.app)';

type PreviewRow = {
  url: string; status: 'ok' | 'failed'; title: string | null; description: string | null; site_name: string | null;
  image_url: string | null; error: string | null; fetched_at: string; expires_at: string;
};

/** ลิงก์ปลอดภัยพอให้เซิร์ฟเวอร์เข้าไปอ่านไหม — คืนเหตุผลถ้าไม่ได้ */
export function unsafeUrlReason(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'ลิงก์ไม่ถูกต้อง';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'รองรับเฉพาะลิงก์ http/https';
  if (u.username || u.password) return 'ลิงก์ที่มีชื่อผู้ใช้/รหัสผ่านในตัวไม่รองรับ';
  if (u.port && u.port !== '80' && u.port !== '443') return 'ลิงก์ที่ระบุพอร์ตพิเศษไม่รองรับ';
  const h = u.hostname.toLowerCase();
  if (h.startsWith('[') || /^\d+(\.\d+){3}$/.test(h) || /^\d+$/.test(h) || /^0x/i.test(h)) return 'ลิงก์ที่เป็นเลข IP ไม่รองรับ';
  if (!h.includes('.') || h === 'localhost' || /\.(localhost|local|internal|lan|home|arpa)$/.test(h)) return 'ลิงก์ภายในเครือข่ายไม่รองรับ';
  return null;
}

/** fetch ทีละขั้นเอง เพื่อตรวจปลายทางทุกครั้งที่ redirect */
async function safeFetch(url: string, accept: string): Promise<{ res: Response; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const bad = unsafeUrlReason(current);
    if (bad) throw new ApiError(400, 'UNSAFE_URL', bad);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'th,en;q=0.8' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === 'TimeoutError';
      throw new ApiError(502, 'FETCH_FAILED', timeout ? 'เว็บปลายทางตอบช้าเกิน 5 วินาที' : 'ติดต่อเว็บปลายทางไม่ได้');
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('Location');
      if (!loc) throw new ApiError(502, 'BAD_REDIRECT', 'เว็บปลายทางสั่งย้ายหน้าแต่ไม่บอกที่อยู่ใหม่');
      current = new URL(loc, current).toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new ApiError(502, 'TOO_MANY_REDIRECTS', `เว็บปลายทางย้ายหน้าเกิน ${MAX_REDIRECTS} ครั้ง`);
}

/** อ่าน body ไม่เกิน max ไบต์ (หน้าเว็บยาวกว่านี้ใช้แค่ส่วนต้น — meta อยู่ใน <head> อยู่แล้ว) */
async function readLimited(res: Response, max: number, strict: boolean): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      if (strict) throw new ApiError(413, 'TOO_LARGE', `ไฟล์ใหญ่เกิน ${Math.round(max / 1024 / 1024)}MB`);
      parts.push(value.subarray(0, value.byteLength - (total - max)));
      total = max;
      break;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** ดึง meta จาก HTML (export ไว้ทดสอบ) */
export function parseMeta(html: string, baseUrl: string) {
  const metas = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const val = content?.[1] ?? content?.[2];
    if (key && val !== undefined && !metas.has(key)) metas.set(key, decodeEntities(val).trim());
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const clean = (v: string | undefined, max: number) => (v ? v.replace(/\s+/g, ' ').trim().slice(0, max) || null : null);
  let image = metas.get('og:image') ?? metas.get('og:image:url') ?? metas.get('twitter:image') ?? null;
  if (image) {
    try {
      image = new URL(image, baseUrl).toString();
      if (!/^https?:/.test(image)) image = null;
    } catch {
      image = null;
    }
  }
  return {
    title: clean(metas.get('og:title') ?? metas.get('twitter:title') ?? (titleTag ? decodeEntities(titleTag) : undefined), 200),
    description: clean(metas.get('og:description') ?? metas.get('twitter:description') ?? metas.get('description'), 300),
    siteName: clean(metas.get('og:site_name'), 80),
    image,
  };
}

function charsetOf(contentType: string, head: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  const cs = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
  return cs === 'tis-620' || cs === 'iso-8859-11' ? 'windows-874' : cs;  // เว็บไทยเก่า
}

const out = (r: PreviewRow) => ({
  url: r.url, status: r.status, title: r.title, description: r.description, siteName: r.site_name,
  hasImage: !!r.image_url, error: r.error,
});

/** GET /api/link-preview?url= */
export async function linkPreview(env: Env, rawUrl: string | null) {
  const url = (rawUrl ?? '').trim();
  if (!url || url.length > 2000) throw new ApiError(400, 'BAD_URL', 'ลิงก์ว่างหรือยาวเกิน 2,000 ตัวอักษร');
  const bad = unsafeUrlReason(url);
  if (bad) throw new ApiError(400, 'UNSAFE_URL', bad);

  const cached = await db('อ่านตัวอย่างลิงก์', () =>
    env.DB.prepare(`SELECT * FROM link_previews WHERE url = ? AND expires_at > ?`).bind(url, nowThai()).first<PreviewRow>(),
  );
  if (cached) return ok(out(cached));

  let row: PreviewRow;
  try {
    const { res, finalUrl } = await safeFetch(url, 'text/html,application/xhtml+xml,image/*;q=0.8');
    if (!res.ok) throw new ApiError(502, 'HTTP_ERROR', `เว็บปลายทางตอบ ${res.status}`);
    const type = (res.headers.get('Content-Type') ?? '').toLowerCase();
    const base = { url, status: 'ok' as const, error: null, fetched_at: nowThai(), expires_at: thaiAfter(OK_TTL_MS) };
    if (IMAGE_TYPES.some((t) => type.startsWith(t))) {
      await res.body?.cancel();
      const name = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || '') || 'รูปภาพ';
      row = { ...base, title: name.slice(0, 200), description: null, site_name: new URL(finalUrl).hostname, image_url: finalUrl };
    } else if (type.includes('text/html') || type.includes('xhtml')) {
      const bytes = await readLimited(res, MAX_HTML_BYTES, false);
      const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096));
      let html: string;
      try {
        html = new TextDecoder(charsetOf(type, head)).decode(bytes);
      } catch {
        html = new TextDecoder('utf-8').decode(bytes);  // ชุดอักขระที่ไม่รู้จัก → ลอง UTF-8
      }
      const m = parseMeta(html, finalUrl);
      if (!m.title && !m.description && !m.image) throw new ApiError(422, 'NO_META', 'หน้าเว็บนี้ไม่มีหัวข้อหรือรูปให้แสดง');
      row = { ...base, title: m.title, description: m.description, site_name: m.siteName ?? new URL(finalUrl).hostname, image_url: m.image };
    } else {
      await res.body?.cancel();
      throw new ApiError(415, 'NOT_HTML', 'ลิงก์นี้ไม่ใช่หน้าเว็บหรือรูป (เช่น ไฟล์ดาวน์โหลด)');
    }
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('ดึงตัวอย่างลิงก์ไม่สำเร็จ', url, err);
    const reason = err instanceof ApiError ? err.message : 'อ่านหน้าเว็บไม่สำเร็จ';
    row = {
      url, status: 'failed', title: null, description: null, site_name: null, image_url: null, error: reason,
      fetched_at: nowThai(), expires_at: thaiAfter(FAIL_TTL_MS),
    };
  }
  await db('บันทึกตัวอย่างลิงก์', () =>
    env.DB.prepare(
      `INSERT INTO link_previews (url, status, title, description, site_name, image_url, error, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET status = excluded.status, title = excluded.title, description = excluded.description,
         site_name = excluded.site_name, image_url = excluded.image_url, error = excluded.error,
         fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    ).bind(row.url, row.status, row.title, row.description, row.site_name, row.image_url, row.error, row.fetched_at, row.expires_at).run(),
  );
  return ok(out(row));
}

/** GET /api/link-preview/image?url=<ลิงก์ในแชท> — ส่งรูปที่บันทึกไว้ของลิงก์นั้น (ไม่รับ url รูปตรง ๆ กันถูกใช้เป็น proxy) */
export async function linkPreviewImage(env: Env, rawUrl: string | null) {
  const url = (rawUrl ?? '').trim();
  const row = url
    ? await db('อ่านตัวอย่างลิงก์', () =>
        env.DB.prepare(`SELECT image_url FROM link_previews WHERE url = ? AND status = 'ok'`).bind(url).first<{ image_url: string | null }>())
    : null;
  if (!row?.image_url) throw new ApiError(404, 'NO_IMAGE', 'ลิงก์นี้ไม่มีรูปตัวอย่าง');
  const { res } = await safeFetch(row.image_url, IMAGE_TYPES.join(','));
  if (!res.ok) throw new ApiError(502, 'HTTP_ERROR', `เว็บปลายทางตอบ ${res.status}`);
  const type = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(type)) {
    await res.body?.cancel();
    throw new ApiError(415, 'NOT_IMAGE', 'รูปตัวอย่างไม่ใช่ชนิดที่รองรับ (JPG, PNG, WEBP, GIF)');
  }
  const len = Number(res.headers.get('Content-Length') || 0);
  if (len > MAX_IMAGE_BYTES) {
    await res.body?.cancel();
    throw new ApiError(413, 'TOO_LARGE', 'รูปตัวอย่างใหญ่เกิน 3MB');
  }
  const bytes = await readLimited(res, MAX_IMAGE_BYTES, true);
  return new Response(bytes, {
    headers: {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': 'inline',
    },
  });
}

// =====================================================================
// ไอคอนของเว็บ (2026-11-18 — ลิงก์ของกลุ่ม: ไอคอนอัตโนมัติ)
//   อ่านหน้าเว็บผ่าน safeFetch (ตรวจทุก redirect — BUGS-18) → หา apple-touch-icon / icon (PNG/JPG/WEBP/ICO)
//   → ไม่มีก็ลอง /favicon.ico · ไม่รับ SVG (อาจมีสคริปต์) · ≤ 300KB · ตรวจหัวไฟล์จริง
//   ไม่สำเร็จ → ApiError พร้อมเหตุผลไทย (ผู้เรียกเปลี่ยนเป็นไอคอนตัวอักษร + แจ้งเหตุผล ไม่ข้ามเงียบ)
// =====================================================================
const ICON_MAX_BYTES = 300 * 1024;

/** หัวไฟล์จริงของไอคอน — JPEG / PNG / WEBP / ICO */
export function sniffIcon(b: Uint8Array): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (b.length > 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  return null;
}

/** หาไอคอนจาก <link rel="..."> — apple-touch-icon (ใหญ่ ชัด) ก่อน แล้วค่อย icon ทั่วไป · ข้าม .svg */
export function findIconHrefs(html: string, baseUrl: string): string[] {
  const found: { href: string; score: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    const href = /\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/i.exec(tag);
    const raw = href?.[1] ?? href?.[2];
    if (!raw || !/(^|\s)(apple-touch-icon|apple-touch-icon-precomposed|icon|shortcut icon)(\s|$)/.test(rel)) continue;
    if (/\.svg(\?|#|$)/i.test(raw) || /image\/svg/i.test(tag)) continue;
    try {
      const abs = new URL(decodeEntities(raw), baseUrl).toString();
      if (/^https?:/.test(abs)) found.push({ href: abs, score: rel.includes('apple-touch-icon') ? 0 : 1 });
    } catch {
      console.warn('ลิงก์ไอคอนในหน้าเว็บผิดรูปแบบ — ข้าม', raw);
    }
  }
  return found.sort((a, b) => a.score - b.score).map((f) => f.href);
}

async function fetchIconAt(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const { res } = await safeFetch(url, 'image/png,image/jpeg,image/webp,image/x-icon,image/*;q=0.5');
  if (!res.ok) { await res.body?.cancel(); throw new ApiError(502, 'HTTP_ERROR', `เว็บตอบ ${res.status} ตอนดึงไอคอน`); }
  const bytes = await readLimited(res, ICON_MAX_BYTES, true);
  const mime = sniffIcon(bytes);
  if (!mime) throw new ApiError(415, 'BAD_ICON', 'ไอคอนของเว็บนี้เป็นชนิดที่ไม่รองรับ (เช่น SVG)');
  return { bytes, mime };
}

export async function fetchSiteIcon(pageUrl: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const bad = unsafeUrlReason(pageUrl);
  if (bad) throw new ApiError(400, 'UNSAFE_URL', `ดึงไอคอนไม่ได้: ${bad}`);
  const tried: string[] = [];
  let finalUrl = pageUrl;
  try {
    const r = await safeFetch(pageUrl, 'text/html,application/xhtml+xml');
    finalUrl = r.finalUrl;
    const type = (r.res.headers.get('Content-Type') ?? '').toLowerCase();
    if (r.res.ok && (type.includes('text/html') || type.includes('xhtml'))) {
      const html = new TextDecoder('utf-8').decode(await readLimited(r.res, MAX_HTML_BYTES, false));
      for (const href of findIconHrefs(html, finalUrl).slice(0, 3)) {
        try {
          return await fetchIconAt(href);
        } catch (err) {
          tried.push(err instanceof ApiError ? err.message : 'อ่านไอคอนไม่ได้');
        }
      }
    } else {
      await r.res.body?.cancel();
    }
  } catch (err) {
    tried.push(err instanceof ApiError ? err.message : 'เปิดหน้าเว็บไม่ได้');
  }
  try {
    return await fetchIconAt(new URL('/favicon.ico', finalUrl).toString());
  } catch (err) {
    tried.push(err instanceof ApiError ? err.message : 'ไม่มี favicon.ico');
  }
  throw new ApiError(422, 'NO_ICON', `ไม่พบไอคอนของเว็บนี้ (${[...new Set(tried)].slice(0, 2).join(' · ')})`);
}
