// =====================================================================
// RoomNotesPage.tsx — โน้ตในห้อง (เฟส 5, แบบ LINE): สมาชิกทุกคนเห็น · สร้างแล้วมีข้อความแจ้งในห้อง
//   ชาเนล: สร้างได้เฉพาะเจ้าของ/แอดมินชาเนล (ผู้ติดตามอ่าน + คอมเมนต์ได้)
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Room, RoomNote, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useNotify } from '../notice';
import { thaiClock, thaiDate } from '../../shared/time';

export default function RoomNotesPage() {
  const { id = '' } = useParams();
  const notify = useNotify();
  const [room, setRoom] = useState<Room | null>(null);
  const [notes, setNotes] = useState<RoomNote[] | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, n] = await Promise.all([
        api.get<{ room: Room }>(`/api/rooms/${encodeURIComponent(id)}`),
        api.get<{ notes: RoomNote[] }>(`/api/rooms/${encodeURIComponent(id)}/notes`),
      ]);
      setRoom(r.room);
      setNotes(n.notes);
      setError('');
    } catch (e) {
      setError(`โหลดโน้ตไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!draft.trim()) { notify('error', 'พิมพ์โน้ตก่อนบันทึก'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ noteId: string; warning: string | null }>(`/api/rooms/${encodeURIComponent(id)}/notes`, { body: draft });
      notify('success', 'บันทึกโน้ตแล้ว');
      if (r.warning) notify('warning', r.warning);
      setDraft('');
      setWriting(false);
      await load();
    } catch (e) {
      notify('error', `บันทึกโน้ตไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar
        title={<>📝 โน้ต{room ? ` · ${room.title}` : ''}</>}
        back={`/room/${encodeURIComponent(id)}`}
        right={room?.canPost && !writing ? <button className="btn btn-small" onClick={() => setWriting(true)}>+ เขียนโน้ต</button> : undefined}
      />
      {error && <div className="banner banner-error" role="alert">{error} <button className="link" onClick={() => void load()}>ลองใหม่</button></div>}
      {writing && (
        <div className="form-block">
          <textarea rows={8} value={draft} maxLength={5000} onChange={(e) => setDraft(e.target.value)} placeholder="เขียนโน้ต (บรรทัดแรกจะแสดงเป็นหัวข้อในห้อง)" autoFocus />
          <div className="small muted">{draft.length.toLocaleString('th-TH')} / 5,000 ตัวอักษร · สมาชิกทุกคนในห้องจะเห็นโน้ตนี้</div>
          <div className="seg">
            <button className="btn" disabled={busy} onClick={() => void create()}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setWriting(false)}>ยกเลิก</button>
          </div>
        </div>
      )}
      {notes === null && !error && <p className="center muted">กำลังโหลด…</p>}
      {notes?.length === 0 && !writing && <p className="center muted">ยังไม่มีโน้ตในห้องนี้</p>}
      {notes?.map((n) => (
        <Link key={n.id} to={`/note/${encodeURIComponent(n.id)}`} className="note-card">
          <div className="row small muted">
            <Avatar name={n.authorName} url={n.authorPicture} size={22} /> {n.authorName} · {thaiDate(n.createdAt)} {thaiClock(n.createdAt)}
          </div>
          <div className="note-preview">{n.body}</div>
          <div className="small muted">💬 {n.comments} คอมเมนต์</div>
        </Link>
      ))}
    </div>
  );
}
