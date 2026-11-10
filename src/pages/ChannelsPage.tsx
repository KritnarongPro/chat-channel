// =====================================================================
// ChannelsPage.tsx — รายการชาเนล: ติดตาม/เลิกติดตามชาเนลสาธารณะ · แอดมินระบบสร้างชาเนลได้
// =====================================================================

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errMsg } from '../api';
import { TopBar } from '../components';
import { useMe } from '../me';
import { useNotify } from '../notice';

interface Channel {
  id: string; title: string; description: string | null; visibility: 'public' | 'private';
  lastMessageAt: string | null; createdAt: string; memberCount: number; joined: boolean; myRole: string | null;
}

export default function ChannelsPage() {
  const { me } = useMe();
  const notify = useNotify();
  const nav = useNavigate();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    try {
      setChannels((await api.get<{ channels: Channel[] }>('/api/channels')).channels);
      setError('');
    } catch (e) {
      setError(`โหลดรายการชาเนลไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(ch: Channel) {
    setBusyId(ch.id);
    try {
      await api.post(`/api/rooms/${encodeURIComponent(ch.id)}/${ch.joined ? 'leave' : 'join'}`);
      notify('success', ch.joined ? `เลิกติดตาม ${ch.title} แล้ว` : `ติดตาม ${ch.title} แล้ว`);
      await load();
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusyId('');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setFormError('ตั้งชื่อชาเนลก่อน'); return; }
    setFormError('');
    try {
      const r = await api.post<{ roomId: string }>('/api/rooms/channel', { title: title.trim(), description: desc.trim(), visibility });
      nav(`/room/${r.roomId}`);
    } catch (err) {
      setFormError(errMsg(err));
    }
  }

  return (
    <div className="page">
      <TopBar
        title="ชาเนล"
        back="/"
        right={me.user.role === 'admin' && !creating ? <button className="btn btn-small" onClick={() => setCreating(true)}>+ สร้างชาเนล</button> : null}
      />
      {creating && (
        <form className="form-block card-like" onSubmit={create}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="ชื่อชาเนล" />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} placeholder="คำอธิบาย (ไม่ใส่ก็ได้)" />
          <label className="radio"><input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> สาธารณะ — อยู่ในรายการนี้ ใครก็กดติดตามได้</label>
          <label className="radio"><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> ส่วนตัว — เจ้าของ/แอดมินชาเนลเพิ่มคนเอง</label>
          {formError && <p className="error-text">{formError}</p>}
          <div className="row-actions">
            <button className="btn">สร้าง</button>
            <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>ยกเลิก</button>
          </div>
        </form>
      )}
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {channels === null && !error && <p className="center muted">กำลังโหลด…</p>}
      {channels?.length === 0 && <p className="center muted">ยังไม่มีชาเนล</p>}
      <ul className="user-list">
        {channels?.map((ch) => (
          <li key={ch.id} className="user-item admin-user">
            <div className="grow">
              <Link to={ch.joined ? `/room/${ch.id}` : '#'} className="plain-link" onClick={(e) => { if (!ch.joined) e.preventDefault(); }}>
                <b>📢 {ch.title}</b>{ch.visibility === 'private' && <span className="small muted"> · ส่วนตัว</span>}
              </Link>
              {ch.description && <div className="small">{ch.description}</div>}
              <div className="small muted">{ch.memberCount} ผู้ติดตาม</div>
            </div>
            {ch.myRole === 'owner' ? (
              <span className="small muted">เจ้าของ</span>
            ) : (ch.visibility === 'public' || ch.joined) && (
              <button className={`btn btn-small ${ch.joined ? 'btn-ghost' : ''}`} disabled={busyId === ch.id} onClick={() => void toggle(ch)}>
                {ch.joined ? 'เลิกติดตาม' : 'ติดตาม'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
