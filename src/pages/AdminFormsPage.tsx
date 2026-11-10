// =====================================================================
// AdminFormsPage.tsx — แอดมิน: สร้าง/แก้ฟอร์มรับออเดอร์ (กดเพิ่มช่องเอง ไม่ต้องเขียนโค้ด)
// ตรวจโครงด้วย checkFormDef เดียวกับ worker ก่อนบันทึก
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { FIELD_TYPE_TH, FieldType, FormField, MAX_FIELDS, checkFormDef } from '../../shared/forms';
import { Bot, FormInfo, api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';

interface Draft { id?: string; title: string; description: string; botId: string; active: boolean; fields: FormField[] }
const empty = (): Draft => ({ title: '', description: '', botId: '', active: true, fields: [] });
let seq = 0;
const newFieldId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

export default function AdminFormsPage() {
  const notify = useNotify();
  const [forms, setForms] = useState<FormInfo[] | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, b] = await Promise.all([
        api.get<{ forms: FormInfo[] }>('/api/admin/forms'),
        api.get<{ bots: Bot[] }>('/api/admin/bots'),
      ]);
      setForms(f.forms);
      setBots(b.bots);
      setError('');
    } catch (e) {
      setError(`โหลดฟอร์มไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setField = (i: number, patch: Partial<FormField>) =>
    setDraft((d) => d && { ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const fs = [...d.fields];
      const j = i + dir;
      if (j < 0 || j >= fs.length) return d;
      [fs[i], fs[j]] = [fs[j], fs[i]];
      return { ...d, fields: fs };
    });

  async function save() {
    if (!draft) return;
    const errs = checkFormDef(draft.title, draft.fields);
    setProblems(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      const body = { title: draft.title, description: draft.description, fields: draft.fields, botId: draft.botId || null, active: draft.active };
      await api.post(draft.id ? `/api/admin/forms/${draft.id}` : '/api/admin/forms', body);
      notify('success', `บันทึกฟอร์ม "${draft.title}" แล้ว`);
      setDraft(null);
      await load();
    } catch (e) {
      setProblems([errMsg(e)]);
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <div className="page">
        <TopBar title={draft.id ? 'แก้ฟอร์ม' : 'สร้างฟอร์ม'} back="/admin/forms" right={<button className="btn btn-small btn-ghost" onClick={() => setDraft(null)}>ยกเลิก</button>} />
        <div className="form-block">
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={100} placeholder="ชื่อฟอร์ม เช่น สั่งปุ๋ย" />
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={500} placeholder="คำอธิบาย (ไม่ใส่ก็ได้)" />
          <label className="small">ส่งออเดอร์ให้บอท (webhook):
            <select value={draft.botId} onChange={(e) => setDraft({ ...draft, botId: e.target.value })}>
              <option value="">— ไม่ส่ง —</option>
              {bots.map((b) => <option key={b.id} value={b.id}>🤖 {b.name}</option>)}
            </select>
          </label>
          <label className="radio"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> เปิดรับออเดอร์</label>
        </div>

        <h3 className="section-title">ช่องที่ต้องกรอก ({draft.fields.length}/{MAX_FIELDS})</h3>
        {draft.fields.map((f, i) => (
          <div key={f.id} className="field-editor">
            <div className="row-actions">
              <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} maxLength={100} placeholder={`ชื่อช่องที่ ${i + 1}`} />
              <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType })}>
                {(Object.keys(FIELD_TYPE_TH) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_TH[t]}</option>)}
              </select>
            </div>
            {f.type === 'select' && (
              <textarea
                rows={3}
                value={(f.options ?? []).join('\n')}
                onChange={(e) => setField(i, { options: e.target.value.split('\n') })}
                placeholder="ตัวเลือก บรรทัดละ 1 ตัวเลือก (อย่างน้อย 2)"
              />
            )}
            {f.type === 'number' && (
              <div className="row-actions">
                <input type="number" value={f.min ?? ''} onChange={(e) => setField(i, { min: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="ต่ำสุด" />
                <input type="number" value={f.max ?? ''} onChange={(e) => setField(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="สูงสุด" />
              </div>
            )}
            <div className="row-actions">
              <label className="radio"><input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> บังคับกรอก</label>
              <button className="link push-right" onClick={() => move(i, -1)}>↑</button>
              <button className="link" onClick={() => move(i, 1)}>↓</button>
              <button className="link error-text" onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })}>ลบ</button>
            </div>
          </div>
        ))}
        <div className="form-block">
          <button
            className="btn btn-ghost"
            disabled={draft.fields.length >= MAX_FIELDS}
            onClick={() => setDraft({ ...draft, fields: [...draft.fields, { id: newFieldId(), label: '', type: 'text', required: true }] })}
          >
            + เพิ่มช่อง
          </button>
          {problems.length > 0 && <ul className="error-text small">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <button className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'บันทึกฟอร์ม'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <TopBar title="แอดมิน: ฟอร์ม" back="/admin" right={<button className="btn btn-small" onClick={() => { setProblems([]); setDraft(empty()); }}>+ สร้างฟอร์ม</button>} />
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {forms === null && !error && <p className="center muted">กำลังโหลด…</p>}
      {forms?.length === 0 && <p className="center muted">ยังไม่มีฟอร์ม</p>}
      <ul className="user-list">
        {forms?.map((f) => (
          <li key={f.id} className="user-item admin-user">
            <div className="grow">
              <b>📝 {f.title}</b>{!f.active && <span className="small muted"> · ปิดรับ</span>}
              <div className="small muted">{f.fields.length} ช่อง{f.botId ? ` · ส่งให้ 🤖 ${bots.find((b) => b.id === f.botId)?.name ?? 'บอท'}` : ''}</div>
            </div>
            <button
              className="btn btn-small btn-ghost"
              onClick={() => { setProblems([]); setDraft({ id: f.id, title: f.title, description: f.description ?? '', botId: f.botId ?? '', active: f.active, fields: f.fields }); }}
            >
              แก้
            </button>
          </li>
        ))}
      </ul>
      <p className="small muted pad">ส่งฟอร์มเข้าห้อง: ในห้องแชทกดปุ่ม "📝 ฟอร์ม" (แอดมิน) หรือให้บอทส่งผ่าน Bot API /api/bot/sendForm</p>
    </div>
  );
}
