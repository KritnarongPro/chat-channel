// =====================================================================
// NotePage.tsx — อ่านโน้ตในห้อง + คอมเมนต์ (เฟส 5)
//   แก้/ลบโน้ต: ผู้เขียน หรือเจ้าของ/แอดมินห้อง · ลบคอมเมนต์: ผู้เขียนคอมเมนต์ หรือเจ้าของ/แอดมินห้อง
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { NoteComment, RoomNote, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useNotify } from '../notice';
import { thaiClock, thaiDate } from '../../shared/time';

export default function NotePage() {
  const { noteId = '' } = useParams();
  const notify = useNotify();
  const nav = useNavigate();
  const [note, setNote] = useState<RoomNote | null>(null);
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ note: RoomNote; comments: NoteComment[] }>(`/api/notes/${encodeURIComponent(noteId)}`);
      setNote(d.note);
      setComments(d.comments);
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [noteId]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, done: string, failWhat: string) {
    setBusy(true);
    try {
      await fn();
      if (done) notify('success', done);
      return true;
    } catch (e) {
      notify('error', `${failWhat}ไม่สำเร็จ: ${errMsg(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (await run(() => api.post(`/api/notes/${encodeURIComponent(noteId)}`, { body: draft }), 'บันทึกการแก้ไขแล้ว', 'แก้โน้ต')) {
      setEditing(false);
      await load();
    }
  }
  async function del() {
    if (!note || !confirm('ลบโน้ตนี้และคอมเมนต์ทั้งหมด?')) return;
    if (await run(() => api.post(`/api/notes/${encodeURIComponent(noteId)}/delete`), 'ลบโน้ตแล้ว', 'ลบโน้ต')) {
      nav(`/room/${encodeURIComponent(note.roomId)}/notes`, { replace: true });
    }
  }
  async function addComment() {
    if (!comment.trim()) { notify('error', 'พิมพ์คอมเมนต์ก่อนส่ง'); return; }
    if (await run(() => api.post(`/api/notes/${encodeURIComponent(noteId)}/comments`, { body: comment }), '', 'ส่งคอมเมนต์')) {
      setComment('');
      await load();
    }
  }
  async function delComment(k: NoteComment) {
    if (!confirm('ลบคอมเมนต์นี้?')) return;
    if (await run(() => api.post(`/api/note-comments/${encodeURIComponent(k.id)}/delete`), 'ลบคอมเมนต์แล้ว', 'ลบคอมเมนต์')) await load();
  }

  return (
    <div className="page">
      <TopBar title="📝 โน้ต" back={note ? `/room/${encodeURIComponent(note.roomId)}/notes` : '/'} />
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {!note && !error && <p className="center muted">กำลังโหลด…</p>}
      {note && (
        <>
          <div className="form-block">
            <div className="row small muted">
              <Avatar name={note.authorName} url={note.authorPicture} size={24} /> {note.authorName} · {thaiDate(note.createdAt)} {thaiClock(note.createdAt)}
              {note.updatedAt !== note.createdAt && ` · แก้ไข ${thaiDate(note.updatedAt)} ${thaiClock(note.updatedAt)}`}
            </div>
            {editing ? (
              <>
                <textarea rows={10} value={draft} maxLength={5000} onChange={(e) => setDraft(e.target.value)} />
                <div className="seg">
                  <button className="btn" disabled={busy} onClick={() => void saveEdit()}>บันทึก</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(false)}>ยกเลิก</button>
                </div>
              </>
            ) : (
              <div className="note-body">{note.body}</div>
            )}
            {note.canManage && !editing && (
              <div className="seg">
                <button className="btn btn-small btn-ghost" onClick={() => { setDraft(note.body); setEditing(true); }}>แก้ไข</button>
                <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void del()}>ลบโน้ต</button>
              </div>
            )}
          </div>
          <h3 className="section-title">คอมเมนต์ ({comments.length})</h3>
          {comments.map((k) => (
            <div key={k.id} className="comment">
              <Avatar name={k.authorName} url={k.authorPicture} size={28} />
              <div className="grow">
                <div className="small"><b>{k.authorName}</b> <span className="muted">{thaiDate(k.createdAt)} {thaiClock(k.createdAt)}</span></div>
                <div className="note-body">{k.body}</div>
              </div>
              {k.canDelete && <button className="link" disabled={busy} onClick={() => void delComment(k)} aria-label="ลบคอมเมนต์">✕</button>}
            </div>
          ))}
          <div className="bottom-bar">
            <div className="row">
              <input value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} placeholder="เขียนคอมเมนต์"
                onKeyDown={(e) => { if (e.key === 'Enter') void addComment(); }} />
              <button className="btn" disabled={busy} onClick={() => void addComment()}>ส่ง</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
