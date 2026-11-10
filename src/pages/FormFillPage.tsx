// =====================================================================
// FormFillPage.tsx — กรอกฟอร์มจากการ์ดในห้อง (/form/:formId?room=…)
// ตรวจก่อนส่งด้วย checkSubmission (worker ตรวจซ้ำ) · ผิดตรงไหนบอกใต้ช่องนั้น
// =====================================================================

import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { FormField, checkSubmission } from '../../shared/forms';
import { api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';

interface FormView { id: string; title: string; description: string | null; fields: FormField[]; active: boolean }

export default function FormFillPage() {
  const { formId = '' } = useParams();
  const [qs] = useSearchParams();
  const roomId = qs.get('room') ?? '';
  const nav = useNavigate();
  const notify = useNotify();
  const [form, setForm] = useState<FormView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ form: FormView }>(`/api/forms/${encodeURIComponent(formId)}`)
      .then((d) => setForm(d.form))
      .catch((e) => setLoadError(errMsg(e)));
  }, [formId]);

  const back = roomId ? `/room/${roomId}` : '/';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!roomId) { setSubmitError('ไม่ทราบว่ากรอกจากห้องไหน — กลับไปกดการ์ดฟอร์มในห้องอีกครั้ง'); return; }
    const check = checkSubmission(form.fields, values);
    setErrors(check.errors);
    if (Object.keys(check.errors).length) { setSubmitError('กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง ดูตัวแดงใต้ช่อง'); return; }
    setBusy(true);
    setSubmitError('');
    try {
      const r = await api.post<{ orderId: number; warnings: string[] }>(`/api/forms/${encodeURIComponent(form.id)}/submit`, { roomId, values });
      notify('success', `ส่งออเดอร์ #${r.orderId} แล้ว`);
      for (const w of r.warnings) notify('warning', w);
      nav(back, { replace: true });
    } catch (err) {
      setSubmitError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar title={form?.title ?? 'ฟอร์ม'} back={back} />
      {loadError && <div className="banner banner-error" role="alert">{loadError}</div>}
      {!form && !loadError && <p className="center muted">กำลังโหลด…</p>}
      {form && !form.active && <div className="banner banner-warning">ฟอร์มนี้ปิดรับแล้ว</div>}
      {form && (
        <form className="form-block" onSubmit={submit} noValidate>
          {form.description && <p className="small">{form.description}</p>}
          {form.fields.map((f) => (
            <label key={f.id} className="field">
              <span>{f.label}{f.required && <span className="error-text"> *</span>}</span>
              <FieldInput f={f} value={values[f.id] ?? ''} onChange={(v) => { setValues({ ...values, [f.id]: v }); setErrors({ ...errors, [f.id]: '' }); }} />
              {errors[f.id] && <span className="small error-text">{errors[f.id]}</span>}
            </label>
          ))}
          {submitError && <p className="error-text" role="alert">{submitError}</p>}
          <button className="btn" disabled={busy || !form.active}>{busy ? 'กำลังส่ง…' : 'ส่งออเดอร์'}</button>
        </form>
      )}
    </div>
  );
}

function FieldInput({ f, value, onChange }: { f: FormField; value: string; onChange: (v: string) => void }) {
  switch (f.type) {
    case 'textarea':
      return <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— เลือก —</option>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'number':
      return <input type="number" inputMode="decimal" min={f.min} max={f.max} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <input type="tel" inputMode="tel" value={value} onChange={(e) => onChange(e.target.value)} placeholder="08x-xxx-xxxx" />;
    case 'date':
      return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}
