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
  for (const m of sql.matchAll(/create table (?:if not exists )?(\w+)/g)) {
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

// ---------- สรุป ----------
if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`\nไม่ผ่าน ${failures.length} ข้อ — ดูรายละเอียดใน CHEATSHEET-CORE.md / CHEATSHEET-BUGS.md`);
  process.exit(1);
}
console.log('✓ ผ่านกฎทุกข้อ (CORE-01..05, BUGS-01..08)');
