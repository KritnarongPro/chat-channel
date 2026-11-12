// =====================================================================
// prefs.ts — หน้าตาแอป (เฟส 5): ธีม สว่าง/มืด/ตามเครื่อง + ขนาดตัวอักษรแชท 5 ระดับ
//   ค่าจริงเก็บที่บัญชี (D1 user_prefs) → ทุกเครื่องเหมือนกัน
//   localStorage เป็นแค่ตัวจำชั่วคราว กันหน้าจอกระพริบสีตอนเปิดแอป (อ่านไม่ได้ก็ใช้ค่าเริ่มต้น)
// =====================================================================

export type Theme = 'system' | 'light' | 'dark';
export interface Prefs { theme: Theme; fontLevel: number }
export const DEFAULT_PREFS: Prefs = { theme: 'system', fontLevel: 3 };
export const FONT_LABELS = ['เล็กมาก', 'เล็ก', 'ปกติ', 'ใหญ่', 'ใหญ่มาก'];
const KEY = 'chat-prefs';

/** ใส่ค่าลงหน้าเว็บ: <html data-theme="…" data-font="1–5"> (CSS ใน styles.css เปลี่ยนสี/ขนาดตาม) */
export function applyPrefs(p: Prefs) {
  const el = document.documentElement;
  el.dataset.theme = p.theme;
  el.dataset.font = String(p.fontLevel);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (err) {
    console.warn('จำค่าหน้าตาแอปในเครื่องไม่ได้ (ไม่กระทบการใช้งาน — ค่าจริงอยู่ที่บัญชี)', err);
  }
}

/** ค่าที่จำไว้ในเครื่อง (ใช้ตอนเปิดแอปก่อนโหลดจากบัญชีเสร็จ) */
export function cachedPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Prefs | null;
    if (p && ['system', 'light', 'dark'].includes(p.theme) && p.fontLevel >= 1 && p.fontLevel <= 5) return p;
  } catch (err) {
    console.warn('อ่านค่าหน้าตาแอปในเครื่องไม่ได้ ใช้ค่าเริ่มต้น', err);
  }
  return DEFAULT_PREFS;
}
