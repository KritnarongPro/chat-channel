// =====================================================================
// MyNotesPage.tsx — โน้ตส่วนตัว (เฟส 5): เห็นคนเดียว · เขียน/แก้/ลบ
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { MyNote, api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';
import { thaiClock, thaiDate } from '../../shared/time';

export default function MyNotesPage() {
  const notify = useNotify();
  const [notes, setNotes] = useState<MyNote[] | null>(null);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      setNotes((await api.get<{ notes: MyNote[] }>('/api/me/notes')).notes);
      setError('');
    } catch (e) {
      setError(`โหลดโน้ตไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft.trim()) { notify('error', 'โน้ตว่าง บันทึกไม่ได้'); return; }
    setBusy(true);
    try {
      if (editId === 'new') await api.post('/api/me/notes', { body: draft });
      else await api.post(`/api/me/notes/${encodeURIComponent(editId!)}`, { body: draft });
      notify('success', 'บันทึกโน้ตแล้ว');
      setEditId(null);
      setDraft('');
      await load();
    } catch (e) {
      notify('error', `บันทึกโน้ตไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function del(n: MyNote) {
    if (!confirm('ลบโน้ตนี้?')) return;
    setBusy(true);
    try {
      await api.post(`/api/me/notes/${encodeURIComponent(n.id)}/delete`);
      notify('success', 'ลบโน้ตแล้ว');
      await load();
    } catch (e) {
      notify('error', `ลบโน้ตไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const shown = (notes ?? []).filter((n) => n.body.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page">
      <TopBar title="โน้ตของฉัน" back="/"
        right={editId === null ? <button className="btn btn-small" onClick={() => { setDraft(''); setEditId('new'); }}>+ โน้ตใหม่</button> : undefined} />
      {error && <div className="banner banner-error" role="alert">{error} <button className="link" onClick={() => void load()}>ลองใหม่</button></div>}
      {editId !== null ? (
        <div className="form-block">
          <textarea rows={12} value={draft} maxLength={10000} onChange={(e) => setDraft(e.target.value)} placeholder="จดอะไรก็ได้ — เห็นคนเดียว" autoFocus />
          <div className="small muted">{draft.length.toLocaleString('th-TH')} / 10,000 ตัวอักษร</div>
          <div className="seg">
            <button className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditId(null)}>ยกเลิก</button>
          </div>
        </div>
      ) : (
        <>
          {(notes?.length ?? 0) > 3 && <div className="form-block"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาในโน้ต" /></div>}
          {notes === null && !error && <p className="center muted">กำลังโหลด…</p>}
          {notes?.length === 0 && <p className="center muted">ยังไม่มีโน้ต — กด "+ โน้ตใหม่"</p>}
          {shown.map((n) => (
            <div key={n.id} className="note-card">
              <div className="small muted">แก้ล่าสุด {thaiDate(n.updatedAt)} {thaiClock(n.updatedAt)}</div>
              <div className="note-preview">{n.body}</div>
              <div className="seg">
                <button className="btn btn-small btn-ghost" onClick={() => { setDraft(n.body); setEditId(n.id); }}>เปิด/แก้ไข</button>
                <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void del(n)}>ลบ</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
