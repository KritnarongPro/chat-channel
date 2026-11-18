// =====================================================================
// scripts/check-rules.mjs — ข้อสอบอัตโนมัติจาก cheat sheet (รันใน GitHub Actions ทุก PR)
//   CORE-xx = กฎที่ใช้ได้ทุกโปรเจกต์ (CHEATSHEET-CORE.md)
//   BUGS-xx = บทเรียนเฉพาะโปรเจกต์นี้ (CHEATSHEET-BUGS.md)
// ผิดข้อไหน → พิมพ์รหัสข้อ + ไฟล์ + เหตุผล แล้วจบด้วย exit 1 (PR ขึ้นแดง)
// =====================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const failures = [];
const fail = (id, msg) => failures.push(`✗ ${id}: ${msg}`);
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, exts) {
  const out = [];
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
}
const codeFiles = [...walk('worker', ['.ts']), ...walk('src', ['.ts', '.tsx']), ...walk('shared', ['.ts'])];

// ---------- CORE-01 เวลาไทยเสมอ: ห้ามใช้ toISOString() นอก shared/time.ts ----------
for (const f of codeFiles) {
  if (f === join('shared', 'time.ts')) continue;
  read(f).split('\n').forEach((line, i) => {
    if (/\.toISOString\(\)/.test(line)) fail('CORE-01', `${f}:${i + 1} ใช้ toISOString() (ได้เวลา UTC) — ใช้ nowThai()/toThaiIso() จาก shared/time.ts`);
  });
}

// ---------- CORE-02 ห้ามกลืน error เงียบ: catch ว่าง ----------
for (const f of codeFiles) {
  const src = read(f);
  const re = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    fail('CORE-02', `${f}:${line} มี catch ว่าง — ต้องแจ้ง error พร้อมเหตุผล (หรืออย่างน้อย console.error)`);
  }
}

// ---------- CORE-03 migration แยกไฟล์ + schema.sql ตรงกัน ----------
const migs = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
migs.forEach((f, i) => {
  const want = String(i + 1).padStart(4, '0');
  if (!f.startsWith(want + '_')) fail('CORE-03', `migrations/${f} เลขไม่เรียงต่อกัน (ควรขึ้นต้นด้วย ${want}_)`);
});
const schema = read('schema.sql').toLowerCase();
const latest = /ล่าสุดถึง:\s*(\S+)/.exec(read('schema.sql'));
if (!latest || latest[1] !== migs[migs.length - 1]) {
  fail('CORE-03', `schema.sql บรรทัด "ล่าสุดถึง:" ต้องเป็น ${migs[migs.length - 1]} (ตอนนี้: ${latest ? latest[1] : 'ไม่มี'})`);
}
for (const f of migs) {
  const sql = read(join('migrations', f)).toLowerCase();
  // ตารางชั่วคราวที่ถูกเปลี่ยนชื่อในไฟล์เดียวกัน (สร้างใหม่ → ย้ายข้อมูล → RENAME) ตรวจด้วยชื่อใหม่แทน
  const renamed = new Set([...sql.matchAll(/alter table (\w+) rename to \w+/g)].map((r) => r[1]));
  for (const m of sql.matchAll(/create table (?:if not exists )?(\w+)/g)) {
    if (renamed.has(m[1])) continue;
    if (!new RegExp(`create table (if not exists )?${m[1]}\\b`).test(schema)) fail('CORE-03', `ตาราง ${m[1]} (จาก ${f}) ไม่อยู่ใน schema.sql`);
  }
  for (const m of sql.matchAll(/alter table (\w+) add column (\w+)/g)) {
    if (!schema.includes(m[2])) fail('CORE-03', `คอลัมน์ ${m[1]}.${m[2]} (จาก ${f}) ไม่อยู่ใน schema.sql`);
  }
}

// ---------- CORE-05 ตรวจตัวอักษรด้วย \p{L} ต้องมี \p{M} ด้วย (สระ/วรรณยุกต์ไทยเป็น \p{M} — ไม่งั้นชื่อไทยไม่ผ่าน) ----------
for (const f of codeFiles) {
  read(f).split('\n').forEach((line, i) => {
    if (/\\p\{L\}/.test(line) && !/\\p\{M\}/.test(line)) fail('CORE-05', `${f}:${i + 1} ใช้ \\p{L} แต่ไม่มี \\p{M} — ชื่อภาษาไทยที่มีสระบน/ล่าง/วรรณยุกต์จะไม่ผ่าน`);
  });
}

// ---------- CORE-04 ต้องบอกวิธี deploy ไว้ใน README ----------
if (!/GitHub Actions/.test(read('README.md'))) fail('CORE-04', 'README.md ต้องบอกวิธี deploy (GitHub Actions)');

// ---------- BUGS-01 โครงตารางในห้อง (Durable Object) ต้องตรงกับ do-schema.sql ----------
const room = read(join('worker', 'room.ts'));
const codeVer = /export const DO_SCHEMA_VERSION = (\d+)/.exec(room);
const docVer = /DO_SCHEMA_VERSION:\s*(\d+)/.exec(read('do-schema.sql'));
if (!codeVer || !docVer || codeVer[1] !== docVer[1]) {
  fail('BUGS-01', `เลข DO_SCHEMA_VERSION ใน worker/room.ts (${codeVer?.[1]}) ไม่ตรงกับ do-schema.sql (${docVer?.[1]})`);
} else {
  for (let v = 1; v <= Number(codeVer[1]); v++) {
    if (!new RegExp(`\\n\\s*${v}: \\[`).test(room)) fail('BUGS-01', `DO_MIGRATIONS ใน worker/room.ts ไม่มีเวอร์ชัน ${v}`);
  }
}

// ---------- BUGS-02 endpoint ต้องอยู่ในตาราง routes และระบุสิทธิ์ (need) ทุกตัว ----------
const index = read(join('worker', 'index.ts'));
for (const m of index.matchAll(/\{ method: '[A-Z]+',\s*pattern: '([^']+)',([^}]*)\}/g)) {
  if (!/need: '(public|any|active|admin|bot)'/.test(m[2])) fail('BUGS-02', `route ${m[1]} ไม่ได้ระบุ need (สิทธิ์)`);
}

// ---------- BUGS-03 ตรวจ Origin ต้องยอมรับโดเมนเดียวกับที่เรียกด้วย (ไม่งั้นทดสอบในเครื่องแล้ว WebSocket โดน 403) ----------
if (!/origin !== new URL\(req\.url\)\.origin/.test(index)) {
  fail('BUGS-03', 'checkOrigin ใน worker/index.ts ต้องเทียบกับ new URL(req.url).origin ด้วย ไม่ใช่ APP_URL อย่างเดียว');
}

// ---------- BUGS-04 ไฟล์ที่ผู้ใช้อัปต้องไม่ถูกเปิดเป็นหน้าเว็บบนโดเมนเรา (กันไฟล์ HTML/SVG ฝังสคริปต์) ----------
{
  const dl = index.slice(index.indexOf('async function downloadFile'));
  if (!/'X-Content-Type-Options', 'nosniff'/.test(dl) || !/'Content-Type', 'application\/octet-stream'/.test(dl) || !/attachment;/.test(dl)) {
    fail('BUGS-04', 'downloadFile ต้องตั้ง nosniff และส่งไฟล์ชนิด file เป็น application/octet-stream + attachment');
  }
  if (/image\/svg/.test(read(join('shared', 'protocol.ts')))) fail('BUGS-04', 'ห้ามรับ SVG เป็นรูป (IMAGE_MIMES)');
}

// ---------- BUGS-05 ชาเนล: สิทธิ์โพสต์ต้องตรวจทั้งตอนส่งข้อความ (ห้อง) และตอนอัปโหลดไฟล์ (worker) ----------
if (!/checkPoster\(/.test(room) || !/NOT_CHANNEL_ADMIN/.test(room)) fail('BUGS-05', 'worker/room.ts ต้องตรวจสิทธิ์โพสต์ชาเนล (checkPoster) ก่อนบันทึกข้อความ');
if (!/requirePoster\(room\.type, role\)/.test(index)) fail('BUGS-05', 'uploadFile ต้องเรียก requirePoster ก่อนรับไฟล์');

// ---------- BUGS-06 แจ้งเตือน: เครื่องที่เลิกรับ (404/410) ต้องถูกลบ ไม่งั้นส่งพลาดซ้ำทุกข้อความ ----------
{
  const push = read(join('worker', 'push.ts'));
  if (!/res\.status === 404 \|\| res\.status === 410/.test(push) || !/DELETE FROM push_subscriptions/.test(push)) {
    fail('BUGS-06', 'worker/push.ts ต้องลบ push_subscriptions เมื่อ push service ตอบ 404/410');
  }
}

// ---------- BUGS-07 บอทห้ามได้รับข้อความของบอทด้วยกัน (กันบอทตอบกันเองวนไม่จบ) ----------
if (!/if \(!room\.senderIsBot\) await this\.queueBots/.test(room)) fail('BUGS-07', 'worker/room.ts ต้องไม่ส่งข้อความของบอทไปให้บอท (senderIsBot)');

// ---------- BUGS-08 ฟอร์ม: worker ต้องตรวจคำตอบซ้ำเอง (ห้ามเชื่อหน้าเว็บ) ----------
if (!/checkSubmission\(form\.fields, body\.values\)/.test(index)) fail('BUGS-08', 'submitForm ต้องเรียก checkSubmission ก่อนบันทึกออเดอร์');

// ---------- BUGS-09 ลิงก์เชิญ: จองที่ต้องมีเงื่อนไขในคำสั่งเดียว (กันคนกดพร้อมกันเกินจำนวน/ใช้ลิงก์ที่หมดอายุ) ----------
{
  const inv = read(join('worker', 'invites.ts'));
  if (!/use_count < max_uses/.test(inv) || !/revoked_at IS NULL/.test(inv) || !/meta\.changes !== 1/.test(inv)) {
    fail('BUGS-09', 'worker/invites.ts ต้องจองที่ด้วย UPDATE ... WHERE (เงื่อนไขครบ) แล้วตรวจ meta.changes');
  }
}

// ---------- BUGS-10 ลิงก์เชิญ: สมาชิกเดิมกดลิงก์ที่เต็ม/หมดอายุ ต้องเข้าห้องได้ (ตรวจสมาชิกก่อนตรวจสถานะลิงก์) ----------
{
  const inv = read(join('worker', 'invites.ts'));
  const body = inv.slice(inv.indexOf('export async function redeemInvite'));
  const iMember = body.indexOf('if (member)');
  const iProblem = body.indexOf('const problem = inviteProblem(inv)');
  if (iMember < 0 || iProblem < 0 || iMember > iProblem) fail('BUGS-10', 'redeemInvite ต้องตรวจ "เป็นสมาชิกอยู่แล้ว" ก่อน inviteProblem');
}

// ---------- BUGS-11 service worker: ได้ push แล้วต้อง showNotification ทันที ห้าม await ก่อน (iPhone ถอนสิทธิ์แจ้งเตือน) ----------
{
  const sw = read(join('public', 'sw.js'));
  const start = sw.indexOf("addEventListener('push'");
  const end = sw.indexOf('addEventListener(', start + 10);
  const handler = sw.slice(start, end < 0 ? undefined : end);
  const iShow = handler.indexOf('showNotification');
  if (start < 0 || iShow < 0) fail('BUGS-11', 'public/sw.js ต้องมี push handler ที่เรียก showNotification');
  else if (/\bawait\b|\.then\(/.test(handler.slice(0, iShow))) fail('BUGS-11', 'public/sw.js: ห้ามมี await/.then ก่อน showNotification ใน push handler');
}

// ---------- BUGS-12 ปิดเสียงแบบมีเวลา: ทุกที่ที่ดู muted ต้องดู muted_until ด้วย (ไม่งั้นปิดเสียง 1 ชม. กลายเป็นปิดตลอด) ----------
for (const f of [join('worker', 'index.ts'), join('worker', 'push.ts')]) {
  read(f).split('\n').forEach((line, i) => {
    if (/muted\s*(===|=)\s*1/.test(line) && !/muted_until/.test(line)) fail('BUGS-12', `${f}:${i + 1} เช็ก muted โดยไม่ดู muted_until`);
  });
}

// ---------- CORE-06 SQL: ห้ามผสมพารามิเตอร์แบบมีเลข (?1, ?2) กับแบบไม่มีเลข (?) ในคำสั่งเดียว ----------
// SQLite: "?" ตัวถัดจาก ?2 จะได้เลข 3 ต่อไปเรื่อย ๆ → ค่าที่ bind ไปผิดช่องแบบไม่มี error (เจอ 2026-11-12 ตอนทำระบบเพื่อน)
for (const f of walk('worker', ['.ts'])) {
  const src = read(f);
  for (const m of src.matchAll(/prepare\(\s*`([\s\S]*?)`/g)) {
    const sql = m[1];
    const numbered = /\?\d/.test(sql);
    // ? เปล่าในตัวคำสั่ง หรือ ${…} ที่สร้างจาก map(() => '?') ไม่เกิน 800 ตัวอักษรก่อน prepare
    const plain = /\?(?!\d)/.test(sql.replace(/\$\{[^}]*\}/g, ''))
      || (/\$\{/.test(sql) && /=>\s*'\?'/.test(src.slice(Math.max(0, m.index - 800), m.index)));
    if (numbered && plain) {
      const line = src.slice(0, m.index).split('\n').length;
      fail('CORE-06', `${f}:${line} คำสั่ง SQL ใช้ทั้ง ?เลข และ ? เปล่า — ใช้แบบมีเลขทั้งหมด (เช่น สร้าง IN (?3, ?4, …))`);
    }
  }
}

// ---------- CORE-07 SQL (D1 / Durable Object): ห้ามใช้ LIKE กับคำที่ผู้ใช้พิมพ์ ----------
// Cloudflare จำกัดรูปแบบ LIKE/GLOB ไว้ 50 ไบต์ — ไทย 1 ตัว = 3 ไบต์ → คำค้น ~16 ตัวก็ error "pattern too complex" (เจอ 2026-11-17 ตอนทำค้นหาในห้อง)
// ใช้ instr(lower(col), ?) > 0 แทน (ไม่มีเพดาน ไม่ต้อง escape % _)
for (const f of walk('worker', ['.ts'])) {
  read(f).split('\n').forEach((line, i) => {
    if (/\b(LIKE|GLOB)\s+\?/i.test(line)) fail('CORE-07', `${f}:${i + 1} ใช้ LIKE/GLOB กับค่าที่ bind เข้ามา — เปลี่ยนเป็น instr(lower(คอลัมน์), ?) > 0`);
  });
}

// ---------- CORE-08 ช่องพิมพ์ต้องไม่เล็กกว่า 16px (เจอ 2026-11-18 ในโปรเจกต์แชท) ----------
// iPhone/iPad ซูมทั้งหน้าเองเมื่อแตะ input/textarea/select ที่ตัวอักษร < 16px → หน้าเลื่อน/ช่องพิมพ์ลอยไปบนสุด
// ใช้ max(16px, …) เมื่อขนาดมาจากตัวแปร (เช่น ตั้งค่าตัวอักษรของผู้ใช้)
for (const f of walk('src', ['.css'])) {
  read(f).split('\n').forEach((line, i) => {
    const m = /^([^{]*)\{([^}]*)\}/.exec(line);
    if (!m || !/\b(input|textarea|select)\b/.test(m[1])) return;
    const fs = /font-size:\s*([^;]+)/.exec(m[2]);
    if (!fs) return;
    const v = fs[1].trim();
    const px = /^(\d+(?:\.\d+)?)px$/.exec(v);
    if ((px && Number(px[1]) < 16) || (!px && !/^max\(16px/.test(v) && !/^(inherit|1[6-9]px|[2-9]\dpx)/.test(v))) {
      fail('CORE-08', `${f}:${i + 1} ช่องพิมพ์ตั้ง font-size: ${v} — iPhone/iPad จะซูมหน้าเอง ใช้ 16px ขึ้นไป หรือ max(16px, …)`);
    }
  });
}

// ---------- BUGS-13 เพื่อน: ตรวจ "แชท 1:1 ได้เฉพาะเพื่อน" ทั้งตอนเปิดห้องและตอนส่งทุกข้อความ ----------
{
  const idx = read(join('worker', 'index.ts'));
  const open = idx.slice(idx.indexOf('async function openDm'), idx.indexOf('async function createGroup'));
  if (!/contactableIds\(/.test(open)) fail('BUGS-13', 'worker/index.ts openDm ต้องเรียก contactableIds() ก่อนเปิด/สร้างแชท 1:1');
  const pStart = room.indexOf('private async checkPoster');
  const poster = room.slice(pStart, room.indexOf('private async claimFile', pStart));
  if (!/DM_ALLOWED_SQL/.test(poster) || !/NOT_FRIEND/.test(poster)) {
    fail('BUGS-13', 'worker/room.ts checkPoster ต้องใช้ DM_ALLOWED_SQL และตอบ NOT_FRIEND (เลิกเป็นเพื่อนแล้วต้องส่งในห้องเดิมไม่ได้)');
  }
}

// ---------- BUGS-14 Google Login: ต้องตรวจค่าใน id_token ทุกตัว (กันไว้ก่อน) ----------
// ไม่ตรวจ aud = รับ id_token ที่ออกให้แอปอื่น · ไม่ตรวจ nonce = เอา token เก่ามาใช้ซ้ำได้ · ไม่ตรวจ email_verified = อีเมลปลอม
{
  const g = read(join('worker', 'auth-google.ts'));
  const need = [
    [/c\.aud\s*!==\s*env\.GOOGLE_CLIENT_ID/, 'ตรวจ aud กับ GOOGLE_CLIENT_ID'],
    [/GOOGLE_ISSUERS\.includes\(c\.iss\)/, 'ตรวจ iss'],
    [/c\.exp\s*\*\s*1000\s*<\s*Date\.now\(\)/, 'ตรวจ exp (หมดอายุ)'],
    [/c\.nonce\s*!==\s*saved\.nonce/, 'ตรวจ nonce กับ cookie'],
    [/email_verified/, 'ตรวจ email_verified'],
    [/state\s*!==\s*saved\.state/, 'ตรวจ state กับ cookie'],
  ];
  for (const [re, what] of need) if (!re.test(g)) fail('BUGS-14', `worker/auth-google.ts ต้อง${what}`);
}

// ---------- BUGS-15 เลิกใช้ LINE (2026-11-17): ห้ามเปิดรับสมัครใหม่ด้วย LINE + ต้องบังคับผูก Gmail ----------
// LINE เหลือไว้ให้คนเดิมเข้ามาผูก Gmail เท่านั้น — ถ้ามีคนเผลอเปิดสมัครใหม่ด้วย LINE กลับมา คนนั้นจะติดหน้าบังคับผูกทันที
{
  const line = read(join('worker', 'auth-line.ts'));
  if (!/LINE_SIGNUP_CLOSED/.test(line) || /INSERT INTO users/.test(line)) {
    fail('BUGS-15', 'worker/auth-line.ts ต้องตอบ LINE_SIGNUP_CLOSED ให้คนใหม่ และต้องไม่มี INSERT INTO users');
  }
  if (!/me\.needsGoogle\s*\?/.test(read(join('src', 'main.tsx')))) fail('BUGS-15', 'src/main.tsx ต้องเช็ก me.needsGoogle ก่อนเข้าแอป (หน้าบังคับผูก Gmail)');
}

// ---------- BUGS-16 ลบแชท: ข้อความที่ล้างฝั่งฉันต้องไม่กลับมา + ยกเลิกส่งต้องตรวจ 24 ชม. ที่ห้อง (กันไว้ก่อน 2026-11-17) ----------
{
  const idx = read(join('worker', 'index.ts'));
  const sock = idx.slice(idx.indexOf('async function openSocket'), idx.indexOf('async function openSocket') + 900);
  const hist = idx.slice(idx.indexOf('async function history'), idx.indexOf('async function history') + 900);
  if (!/X-Cleared-Seq/.test(sock)) fail('BUGS-16', 'openSocket ต้องส่ง X-Cleared-Seq ให้ห้องแชท (ไม่งั้นข้อความที่ลบแชทแล้วกลับมาตอนเปิดห้อง)');
  if (!/after=\$\{after\}/.test(hist)) fail('BUGS-16', 'history ต้องส่ง after=<cleared_seq> ให้ห้องแชท (ไม่งั้นเลื่อนขึ้นแล้วเจอข้อความที่ลบแชทไปแล้ว)');
  const del = room.slice(room.indexOf("url.pathname === '/delete'"), room.indexOf("url.pathname === '/broadcast'"));
  if (!/UNSEND_WINDOW_MS/.test(del)) fail('BUGS-16', 'room.ts /delete ต้องตรวจ UNSEND_WINDOW_MS (ยกเลิกส่งได้ภายใน 24 ชม.)');
}

// ---------- BUGS-17 ฟีเจอร์แชท: ค้นหาต้องไม่เจอข้อความที่ลบแชทฝั่งฉัน + ชาเนลห้ามส่ง "อ่านแล้ว" ให้ผู้ติดตาม (กันไว้ก่อน 2026-11-17) ----------
{
  const idx = read(join('worker', 'index.ts'));
  const srch = idx.slice(idx.indexOf('async function searchMessages'), idx.indexOf('async function searchMessages') + 700);
  if (!/after=\$\{after\}/.test(srch)) fail('BUGS-17', 'searchMessages ต้องส่ง after=<cleared_seq> ให้ห้องแชท (ไม่งั้นค้นเจอข้อความที่ลบแชทฝั่งฉันไปแล้ว)');
  const sock = idx.slice(idx.indexOf('async function openSocket'), idx.indexOf('async function openSocket') + 900);
  if (!/X-Room-Role/.test(sock) || !/X-Room-Type/.test(sock)) fail('BUGS-17', 'openSocket ต้องส่ง X-Room-Role + X-Room-Type ให้ห้องแชท (ใช้กันไม่ให้ผู้ติดตามชาเนลเห็นว่าใครอ่านแล้ว)');
  const br = room.slice(room.indexOf('private broadcastRead'), room.indexOf('private broadcastRead') + 400);
  if (!/canSeeReads\(/.test(br)) fail('BUGS-17', 'broadcastRead ใน room.ts ต้องกรองด้วย canSeeReads() (ชาเนล: เฉพาะเจ้าของ/แอดมิน)');
  if (!/if \(canSeeReads\(info\)\) await this\.sendReads/.test(room)) fail('BUGS-17', "sendReads ต้องเรียกเฉพาะเมื่อ canSeeReads(info)");
  const post = room.slice(room.indexOf("case 'send':"), room.indexOf("case 'send':") + 300);
  if (/forwardedFrom|frame\.forwarded/.test(post)) fail('BUGS-17', 'WebSocket send ห้ามส่ง forwardedFrom เข้า handleSend (ป้าย "ส่งต่อจาก" มาจาก worker เท่านั้น)');
}

// ---------- BUGS-18 ชุด 2: ตัวอย่างลิงก์ห้ามถูกใช้ยิงเครื่องภายใน (SSRF) + โหวต/ปักหมุดตรวจที่เซิร์ฟเวอร์ (กันไว้ก่อน 2026-11-17) ----------
{
  const lp = read(join('worker', 'link-preview.ts'));
  const sf = lp.slice(lp.indexOf('async function safeFetch'), lp.indexOf('async function readLimited'));
  if (!/for \(let hop/.test(sf) || !/unsafeUrlReason\(current\)/.test(sf)) fail('BUGS-18', 'safeFetch ต้องตรวจ unsafeUrlReason ทุกครั้งที่ redirect (ในลูป hop)');
  if (!/redirect: 'manual'/.test(sf)) fail('BUGS-18', "safeFetch ต้องใช้ redirect: 'manual' (ไม่ให้ fetch ตามไปเองโดยไม่ตรวจ)");
  // ตรวจเฉพาะตัวฟังก์ชัน linkPreviewImage (จบที่หัวหมวดถัดไป — ส่วนไอคอนของลิงก์กลุ่มต่อท้ายไฟล์ fetch ลิงก์ไอคอนที่อ่านจากหน้าเว็บ ซึ่งตั้งใจ)
  const imgStart = lp.indexOf('export async function linkPreviewImage');
  const imgEnd = lp.indexOf('\n// =====', imgStart);
  const img = lp.slice(imgStart, imgEnd > 0 ? imgEnd : undefined);
  if (!/SELECT image_url FROM link_previews/.test(img) || /safeFetch\(url/.test(img)) fail('BUGS-18', 'linkPreviewImage ต้องเปิดเฉพาะรูปที่บันทึกไว้ใน link_previews (ห้าม fetch url ที่ส่งมาตรง ๆ = กลายเป็น proxy)');
  const vote = room.slice(room.indexOf('private async handleVote'), room.indexOf('private async handlePollClose'));
  if (!/checkPoster\(/.test(vote)) fail('BUGS-18', 'handleVote ต้องเรียก checkPoster (สมาชิกที่ถูกเอาออกระหว่างเปิดห้องค้างต้องโหวตไม่ได้)');
  const idx = read(join('worker', 'index.ts'));
  const pin = idx.slice(idx.indexOf('async function pinMessage'), idx.indexOf('async function unpinMessage'));
  if (!/COUNT\(\*\) FROM room_pins WHERE room_id = \?1\) < \?7/.test(pin)) fail('BUGS-18', 'pinMessage ต้องนับ + เพิ่มหมุดในคำสั่งเดียว (กันกดพร้อมกันแล้วเกิน 5)');
}

// ---------- BUGS-19 ลบเฉพาะฝั่งฉัน: ข้อความที่ซ่อนต้องไม่กลับมาทาง history / search / sync (กันไว้ก่อน 2026-11-17) ----------
{
  const idx = read(join('worker', 'index.ts'));
  const hist = idx.slice(idx.indexOf('async function history'), idx.indexOf('async function history') + 900);
  const srch = idx.slice(idx.indexOf('async function searchMessages'), idx.indexOf('async function searchMessages') + 900);
  if (!/'X-User-Id': c\.user!\.id/.test(hist)) fail('BUGS-19', "history ต้องส่ง 'X-User-Id' ให้ห้องแชท (ไม่งั้นเลื่อนขึ้นแล้วข้อความที่ลบฝั่งฉันกลับมา)");
  if (!/'X-User-Id': c\.user!\.id/.test(srch)) fail('BUGS-19', "searchMessages ต้องส่ง 'X-User-Id' ให้ห้องแชท (ไม่งั้นค้นเจอข้อความที่ลบฝั่งฉัน)");
  const sync = room.slice(room.indexOf('private handleSync'), room.indexOf('private handleSync') + 1400);
  if ((sync.match(/NOT_HIDDEN/g) ?? []).length < 3) fail('BUGS-19', 'handleSync ต้องกรอง NOT_HIDDEN ทั้งตอนเปิดห้อง (2 คำสั่ง) และตอนต่อใหม่');
}

// ---------- BUGS-20 คนสมัครใหม่ต้องแจ้งแอดมิน ทุกทาง (กันไว้ก่อน 2026-11-17) ----------
{
  const ag = read(join('worker', 'auth-google.ts'));
  if (!/isNew = true/.test(ag) || !/finishLogin\(env, CLEAR, user, saved\.invite,\s*isNew \?/.test(ag)) fail('BUGS-20', 'googleCallback ต้องส่งข้อมูลคนสมัครใหม่ (isNew) ให้ finishLogin — ไม่งั้นแอดมินไม่รู้ว่ามีคนสมัคร');
  const ac = read(join('worker', 'auth-common.ts'));
  const fl = ac.slice(ac.indexOf('export async function finishLogin'));
  for (const via of ["via: 'signup'", "via: 'invite'", "via: 'invite-failed'"]) {
    if (!fl.includes(via)) fail('BUGS-20', `finishLogin ต้องเรียก queueAdminSignup กรณี ${via} (สมัครเอง / ลิงก์เชิญสำเร็จ / ลิงก์เชิญใช้ไม่ได้)`);
  }
}

// ---------- BUGS-21 หน้าแชทต้องล็อกความสูงเท่าส่วนที่มองเห็น (เจอ 2026-11-18 บน iPad) ----------
{
  const page = read(join('src', 'pages', 'ChatRoomPage.tsx'));
  if (!/useEffect\(\(\) => lockChatViewport\(\), \[\]\)/.test(page)) fail('BUGS-21', 'ChatRoomPage ต้องเรียก lockChatViewport() (ไม่งั้นคีย์บอร์ด iPad/iPhone ดันช่องพิมพ์ไปค้างบนสุด)');
  const css = read(join('src', 'styles.css'));
  if (!/html\.chat-open #root \{ height: var\(--app-h/.test(css)) fail('BUGS-21', 'styles.css ต้องมี html.chat-open #root { height: var(--app-h, …) }');
  const main = read(join('src', 'main.tsx'));
  if (!/installViewportFix\(\);/.test(main)) fail('BUGS-21', 'main.tsx ต้องเรียก installViewportFix()');
}

// ---------- BUGS-22 iPad 2 ช่อง: รายการแชทซ้ายต้องอัปเดตตามห้องที่เปิด + หน้าแชทยังสูงเท่าจอ (เจอ 2026-11-18) ----------
{
  const page = read(join('src', 'pages', 'ChatRoomPage.tsx'));
  if (!/dispatchEvent\(new Event\('room-seen'\)\)/.test(page)) fail('BUGS-22', "ChatRoomPage ต้องส่ง event 'room-seen' เมื่อมีข้อความใหม่ (ไม่งั้นช่องซ้ายบน iPad ค้างข้อความเก่า)");
  const counts = read(join('src', 'counts.tsx'));
  if (!/addEventListener\('room-seen'/.test(counts)) fail('BUGS-22', "counts.tsx ต้องฟัง event 'room-seen' แล้วโหลดรายการแชทใหม่");
  const main = read(join('src', 'main.tsx'));
  if (!/<Route element=\{<AppShell \/>\}>/.test(main)) fail('BUGS-22', 'main.tsx ต้องครอบหน้าที่ล็อกอินแล้วด้วย <Route element={<AppShell />}> (แถบล่าง + 2 ช่อง)');
  const css = read(join('src', 'styles.css'));
  if (!/html\.chat-open \.route-view \{ height: 100%/.test(css)) fail('BUGS-22', 'styles.css ต้องมี html.chat-open .route-view { height: 100% } (ไม่งั้นหน้าแชทบนมือถือยืดตามข้อความ ช่องพิมพ์หลุดจอ)');
}

// ---------- BUGS-23 ชื่อ/รูปที่ผู้ใช้ตั้งเองห้ามถูกล็อกอินเขียนทับ + ไฟล์รูปโปรไฟล์ต้องปลอดภัย (กันไว้ก่อน — 2026-11-18) ----------
{
  for (const f of ['auth-google.ts', 'auth-line.ts']) {
    const src = read(join('worker', f));
    const updates = src.match(/UPDATE users SET[\s\S]*?`/g) ?? [];
    for (const u of updates) {
      if (/display_name\s*=/.test(u) && !/name_custom/.test(u)) fail('BUGS-23', `worker/${f}: UPDATE users ที่เขียน display_name ต้องเช็ก name_custom (ไม่งั้นล็อกอินแล้วชื่อที่ผู้ใช้ตั้งเองหาย)`);
      if (/picture_url\s*=/.test(u) && !/picture_id/.test(u)) fail('BUGS-23', `worker/${f}: UPDATE users ที่เขียน picture_url ต้องเช็ก picture_id (ไม่งั้นล็อกอินแล้วรูปที่ผู้ใช้อัปหาย)`);
    }
  }
  const prof = read(join('worker', 'profile.ts'));
  if (!/'X-Content-Type-Options': 'nosniff'/.test(prof)) fail('BUGS-23', 'servePicture (worker/profile.ts) ต้องตั้ง X-Content-Type-Options: nosniff');
  if (!/const real = sniffImage\(bytes\)/.test(prof)) fail('BUGS-23', 'readPicture ต้องตรวจหัวไฟล์จริงด้วย sniffImage (ไม่เชื่อ Content-Type อย่างเดียว)');
  const proto = read(join('shared', 'protocol.ts'));
  const pm = proto.match(/PICTURE_MIMES = \[([^\]]*)\]/);
  if (!pm || /svg|gif/i.test(pm[1])) fail('BUGS-23', 'PICTURE_MIMES ต้องมีแค่ jpeg/png/webp (ห้าม SVG — ดู BUGS-04)');
}

// ---------- BUGS-24 ลบแชทที่ยังไม่มีข้อความต้องหายจากรายการจริง (เจอ 2026-11-18 ตอนทดสอบลบจากหน้ารายการแชท) ----------
{
  const idx = read(join('worker', 'index.ts'));
  if (!/CASE WHEN last_seq = 0 THEN -1 ELSE last_seq END/.test(idx)) fail('BUGS-24', 'clearChat ต้องเก็บ cleared_seq = -1 เมื่อห้องยังไม่มีข้อความ (ไม่งั้นลบแล้วห้องไม่หาย แต่ขึ้นว่าลบแล้ว)');
  if (!/m\.cleared_seq <> 0 AND r\.last_seq <= MAX\(m\.cleared_seq, 0\)/.test(idx)) fail('BUGS-24', 'listRooms ต้องซ่อนห้องด้วย m.cleared_seq <> 0 AND r.last_seq <= MAX(m.cleared_seq, 0)');
  if (idx.split('\n').some((l) => /room\.cleared_seq \?\? 0/.test(l) && !l.includes('const clearedOf'))) fail('BUGS-24', 'ใช้ clearedOf(room) แทน room.cleared_seq ?? 0 (ค่า -1 ต้องถือเป็น 0 ตอนกรองข้อความ)');
}

// ---------- BUGS-25 ลิงก์ของกลุ่ม: กดแล้วต้องไม่รันสคริปต์ + จัดการได้เฉพาะเจ้าของ/แอดมินห้อง (กันไว้ก่อน — 2026-11-18) ----------
{
  const rl = read(join('worker', 'room-links.ts'));
  if (!/u\.protocol !== 'http:' && u\.protocol !== 'https:'/.test(rl)) fail('BUGS-25', "cleanLinkUrl ต้องรับเฉพาะ http/https (กัน javascript:/data: ที่กดแล้วรันสคริปต์บนโดเมนเรา)");
  if (!/WHERE \(SELECT COUNT\(\*\) FROM room_links WHERE room_id = \?2\) < \?12/.test(rl)) fail('BUGS-25', 'createLink ต้องจองที่ในคำสั่งเดียว (COUNT < ?12) กันกดพร้อมกันเกิน 50 ลิงก์/8 หมุด');
  const idx = read(join('worker', 'index.ts'));
  const lr = idx.slice(idx.indexOf('async function linkRoom'), idx.indexOf('async function linkRoom') + 900);
  if (!/if \(needEditor && !canEdit\) throw/.test(lr)) fail('BUGS-25', 'linkRoom ต้องตรวจสิทธิ์เจ้าของ/แอดมินห้องที่เซิร์ฟเวอร์ (หน้าเว็บแค่ซ่อนปุ่ม)');
  for (const name of ['addRoomLink', 'editRoomLink', 'removeRoomLink', 'uploadRoomLinkIcon']) {
    const body = idx.slice(idx.indexOf(`async function ${name}`), idx.indexOf(`async function ${name}`) + 200);
    if (!/await linkRoom\(c, true\)/.test(body)) fail('BUGS-25', `${name} ต้องเรียก linkRoom(c, true) ก่อนแก้ข้อมูล`);
  }
  for (const f of [join('src', 'pages', 'RoomLinksPage.tsx'), join('src', 'pages', 'ChatRoomPage.tsx')]) {
    const src = read(f);
    for (const tag of src.match(/<a key=\{l\.id\}[^>]*>|<a href=\{l\.url\}[^>]*>/g) ?? []) {
      if (!/rel="noopener noreferrer"/.test(tag)) fail('BUGS-25', `${f}: ลิงก์ที่เปิดแท็บใหม่ต้องมี rel="noopener noreferrer"`);
    }
  }
}

// ---------- สรุป ----------
if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`\nไม่ผ่าน ${failures.length} ข้อ — ดูรายละเอียดใน CHEATSHEET-CORE.md / CHEATSHEET-BUGS.md`);
  process.exit(1);
}
console.log('✓ ผ่านกฎทุกข้อ (CORE-01..08, BUGS-01..25)');
