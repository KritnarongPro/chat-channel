// =====================================================================
// shared/forms.ts — ฟอร์มรับออเดอร์ (เฟส 4): ชนิดช่อง + ตรวจโครงฟอร์ม + ตรวจคำตอบ
// ใช้ทั้งหน้าเว็บ (ตรวจก่อนส่ง) และ worker (ตรวจซ้ำก่อนบันทึก — ห้ามเชื่อหน้าเว็บอย่างเดียว)
// =====================================================================

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'phone' | 'date';

export const FIELD_TYPE_TH: Record<FieldType, string> = {
  text: 'ข้อความสั้น', textarea: 'ข้อความยาว', number: 'ตัวเลข', select: 'ตัวเลือก', phone: 'เบอร์โทร', date: 'วันที่',
};

export interface FormField {
  id: string;          // รหัสช่อง (ระบบตั้งให้) ใช้เป็นชื่อคีย์ในข้อมูลออเดอร์
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];  // select เท่านั้น
  min?: number;        // number เท่านั้น
  max?: number;
}

export interface FormDef { id: string; title: string; description: string | null; fields: FormField[]; active: boolean }

export const MAX_FIELDS = 30;
const TEXT_MAX: Record<FieldType, number> = { text: 200, textarea: 2000, number: 30, select: 200, phone: 20, date: 10 };

/** ตรวจโครงฟอร์มที่แอดมินสร้าง → คืนรายการปัญหา (ว่าง = ผ่าน) */
export function checkFormDef(title: unknown, fields: unknown): string[] {
  const errs: string[] = [];
  if (typeof title !== 'string' || !title.trim() || title.length > 100) errs.push('ชื่อฟอร์มต้องมี 1–100 ตัวอักษร');
  if (!Array.isArray(fields) || fields.length === 0) return [...errs, 'ต้องมีอย่างน้อย 1 ช่อง'];
  if (fields.length > MAX_FIELDS) errs.push(`ช่องเกิน ${MAX_FIELDS} ช่อง`);
  const ids = new Set<string>();
  fields.forEach((f: Partial<FormField>, i) => {
    const n = `ช่องที่ ${i + 1}`;
    if (!f || typeof f !== 'object') { errs.push(`${n}: ข้อมูลไม่ถูกต้อง`); return; }
    if (typeof f.id !== 'string' || !/^[a-z0-9_]{1,40}$/.test(f.id)) errs.push(`${n}: รหัสช่องไม่ถูกต้อง`);
    else if (ids.has(f.id)) errs.push(`${n}: รหัสช่องซ้ำ`);
    else ids.add(f.id);
    if (typeof f.label !== 'string' || !f.label.trim() || f.label.length > 100) errs.push(`${n}: ต้องมีชื่อช่อง (ไม่เกิน 100 ตัวอักษร)`);
    if (!f.type || !(f.type in FIELD_TYPE_TH)) errs.push(`${n}: ชนิดช่องไม่ถูกต้อง`);
    if (typeof f.required !== 'boolean') errs.push(`${n}: ต้องระบุว่าบังคับกรอกหรือไม่`);
    if (f.type === 'select') {
      const opts = (f.options ?? []).filter((o) => typeof o === 'string' && o.trim());
      if (opts.length < 2) errs.push(`${n} (${f.label ?? ''}): ช่องตัวเลือกต้องมีอย่างน้อย 2 ตัวเลือก`);
    }
    if (f.type === 'number' && f.min !== undefined && f.max !== undefined && f.min > f.max) {
      errs.push(`${n} (${f.label ?? ''}): ค่าต่ำสุดมากกว่าค่าสูงสุด`);
    }
  });
  return errs;
}

/** ตรวจคำตอบ → { values ที่ทำความสะอาดแล้ว, errors: { fieldId: เหตุผล } } */
export function checkSubmission(fields: FormField[], raw: unknown): { values: Record<string, string | number>; errors: Record<string, string> } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const values: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = input[f.id];
    const str = v === undefined || v === null ? '' : String(v).trim();
    if (!str) {
      if (f.required) errors[f.id] = 'จำเป็นต้องกรอก';
      continue;
    }
    if (str.length > TEXT_MAX[f.type]) { errors[f.id] = `ยาวเกิน ${TEXT_MAX[f.type]} ตัวอักษร`; continue; }
    switch (f.type) {
      case 'number': {
        const n = Number(str.replace(/,/g, ''));
        if (!Number.isFinite(n)) { errors[f.id] = 'ต้องเป็นตัวเลข'; break; }
        if (f.min !== undefined && n < f.min) { errors[f.id] = `ต้องไม่น้อยกว่า ${f.min}`; break; }
        if (f.max !== undefined && n > f.max) { errors[f.id] = `ต้องไม่เกิน ${f.max}`; break; }
        values[f.id] = n;
        break;
      }
      case 'select':
        if (!(f.options ?? []).includes(str)) errors[f.id] = 'ตัวเลือกไม่ถูกต้อง';
        else values[f.id] = str;
        break;
      case 'phone': {
        const digits = str.replace(/[\s-]/g, '');
        if (!/^\+?\d{9,15}$/.test(digits)) errors[f.id] = 'เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–15 หลัก)';
        else values[f.id] = digits;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(Date.parse(str))) errors[f.id] = 'วันที่ไม่ถูกต้อง';
        else values[f.id] = str;
        break;
      default:
        values[f.id] = str;
    }
  }
  return { values, errors };
}

export const ORDER_STATUS_TH = { new: 'ใหม่', in_progress: 'กำลังทำ', done: 'เสร็จแล้ว', cancelled: 'ยกเลิก' } as const;
export type OrderStatus = keyof typeof ORDER_STATUS_TH;
