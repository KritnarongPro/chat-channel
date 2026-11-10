// =====================================================================
// shared/time.ts — เวลาไทย (Asia/Bangkok, UTC+07:00) ใช้ทั้ง worker และหน้าเว็บ
// กฎ: ห้ามใช้ new Date().toISOString() ตรง ๆ ที่อื่น (จะได้เวลา UTC) — ใช้ฟังก์ชันในไฟล์นี้เท่านั้น
// =====================================================================

const TH_OFFSET_MS = 7 * 3600_000;

/** เวลาไทยรูปแบบ ISO เช่น 2026-11-10T11:09:00.000+07:00 (เรียงตามตัวอักษร = เรียงตามเวลา) */
export function toThaiIso(ms: number): string {
  return new Date(ms + TH_OFFSET_MS).toISOString().replace('Z', '+07:00');
}

/** เวลาปัจจุบันเป็นเวลาไทย */
export function nowThai(): string {
  return toThaiIso(Date.now());
}

/** เวลาไทยอีก n มิลลิวินาทีข้างหน้า */
export function thaiAfter(ms: number): string {
  return toThaiIso(Date.now() + ms);
}

/** "HH:MM" จากค่าเวลาไทย ISO */
export function thaiClock(iso: string): string {
  return iso.slice(11, 16);
}

/** "DD/MM/YYYY" (พ.ศ.) จากค่าเวลาไทย ISO */
export function thaiDate(iso: string): string {
  const y = Number(iso.slice(0, 4)) + 543;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${y}`;
}

/** แสดงในรายการแชท: วันนี้ = เวลา, วันอื่น = วันที่ */
export function thaiShort(iso: string): string {
  return iso.slice(0, 10) === nowThai().slice(0, 10) ? thaiClock(iso) : thaiDate(iso);
}
