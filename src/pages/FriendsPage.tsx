// =====================================================================
// FriendsPage.tsx — เพื่อน (เฟส 5)
//   แท็บ: เพื่อน · คำขอ (รับ/ปฏิเสธ, ยกเลิกที่ส่งไป) · เพิ่มเพื่อน (ค้นหาชื่อ + QR/ลิงก์ของฉัน)
//   แชท 1:1 และเพิ่มเข้ากลุ่ม ได้เฉพาะเพื่อน (ยกเว้นแอดมินระบบ + บอท)
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import QRCode from 'qrcode';
import { FriendUser, FriendsData, User, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import { useNotify } from '../notice';
import { thaiDate } from '../../shared/time';

type Tab = 'friends' | 'requests' | 'add';

export default function FriendsPage() {
  const notify = useNotify();
  const nav = useNavigate();
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>('friends');
  const [data, setData] = useState<FriendsData | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const [qr, setQr] = useState('');

  const load = useCallback(async () => {
    try {
      const [f, u] = await Promise.all([
        api.get<FriendsData>('/api/friends'),
        api.get<{ users: User[] }>('/api/users'),
      ]);
      setData(f);
      setUsers(u.users);
      setError('');
    } catch (e) {
      setError(`โหลดรายชื่อเพื่อนไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const myLink = `${location.origin}/add/${encodeURIComponent(me.user.id)}`;
  useEffect(() => {
    if (tab !== 'add' || qr) return;
    QRCode.toDataURL(myLink, { width: 240, margin: 1 })
      .then(setQr)
      .catch((e) => notify('error', `สร้าง QR ไม่สำเร็จ: ${errMsg(e)}`));
  }, [tab, qr, myLink, notify]);

  async function act(id: string, path: string, body: unknown, done: string) {
    setBusy(id);
    try {
      const r = await api.post<{ status?: string; notified?: boolean }>(path, body);
      notify('success', r.status === 'accepted' && path.endsWith('/request') ? 'อีกฝ่ายขอคุณมาก่อนแล้ว — เป็นเพื่อนกันแล้ว' : done);
      if (r.notified === false) notify('warning', 'ส่งคำขอแล้ว แต่อีกฝ่ายยังไม่ได้เปิดแจ้งเตือน — เขาจะเห็นคำขอเมื่อเปิดหน้า "เพื่อน"');
      await load();
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusy('');
    }
  }
  const request = (u: { id: string }) => act(u.id, '/api/friends/request', { userId: u.id }, 'ส่งคำขอเป็นเพื่อนแล้ว');
  const accept = (u: FriendUser) => act(u.id, `/api/friends/${encodeURIComponent(u.id)}/accept`, {}, `เป็นเพื่อนกับ ${u.displayName} แล้ว`);
  const remove = (u: FriendUser, done: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    void act(u.id, `/api/friends/${encodeURIComponent(u.id)}/remove`, {}, done);
  };

  async function chat(u: FriendUser) {
    setBusy(u.id);
    try {
      const r = await api.post<{ roomId: string }>('/api/rooms/dm', { userId: u.id });
      nav(`/room/${r.roomId}`);
    } catch (e) {
      notify('error', errMsg(e));
      setBusy('');
    }
  }

  const others = useMemo(
    () => (users ?? []).filter((u) => !u.isBot && u.displayName.toLowerCase().includes(q.trim().toLowerCase())),
    [users, q],
  );
  const reqCount = data?.incoming.length ?? 0;

  return (
    <div className="page">
      <TopBar title="เพื่อน" back="/" />
      <div className="tabs">
        <button className={`chip ${tab === 'friends' ? 'on' : ''}`} onClick={() => setTab('friends')}>เพื่อน {data ? `(${data.friends.length})` : ''}</button>
        <button className={`chip ${tab === 'requests' ? 'on' : ''}`} onClick={() => setTab('requests')}>คำขอ {reqCount > 0 ? `(${reqCount})` : ''}</button>
        <button className={`chip ${tab === 'add' ? 'on' : ''}`} onClick={() => setTab('add')}>+ เพิ่มเพื่อน</button>
      </div>
      {error && <div className="banner banner-error" role="alert">{error} <button className="link" onClick={() => void load()}>ลองใหม่</button></div>}
      {!data && !error && <p className="center muted">กำลังโหลด…</p>}

      {data && tab === 'friends' && (
        <>
          {data.friends.length === 0 && <p className="center muted">ยังไม่มีเพื่อน — กด "+ เพิ่มเพื่อน"</p>}
          <ul className="user-list">
            {data.friends.map((u) => (
              <li key={u.id} className="user-item">
                <Avatar name={u.displayName} url={u.pictureUrl} size={36} />
                <div className="grow"><div>{u.displayName}</div><div className="small muted">เพื่อนตั้งแต่ {thaiDate(u.since)}</div></div>
                <button className="btn btn-small" disabled={busy === u.id} onClick={() => void chat(u)}>แชท</button>
                <button className="link" disabled={busy === u.id}
                  onClick={() => remove(u, `เลิกเป็นเพื่อนกับ ${u.displayName} แล้ว`, `เลิกเป็นเพื่อนกับ ${u.displayName}?\nแชทเดิมยังอ่านได้ แต่ส่งข้อความต่อไม่ได้จนกว่าจะเป็นเพื่อนกันใหม่`)}>
                  เลิก
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && tab === 'requests' && (
        <>
          <h3 className="section-title">ขอเป็นเพื่อนกับคุณ</h3>
          {data.incoming.length === 0 && <p className="small muted" style={{ padding: '0 12px' }}>ไม่มีคำขอ</p>}
          <ul className="user-list">
            {data.incoming.map((u) => (
              <li key={u.id} className="user-item">
                <Avatar name={u.displayName} url={u.pictureUrl} size={36} />
                <div className="grow"><div>{u.displayName}</div><div className="small muted">ขอเมื่อ {thaiDate(u.since)}</div></div>
                <button className="btn btn-small" disabled={busy === u.id} onClick={() => void accept(u)}>ยอมรับ</button>
                <button className="link" disabled={busy === u.id} onClick={() => remove(u, 'ปฏิเสธคำขอแล้ว')}>ปฏิเสธ</button>
              </li>
            ))}
          </ul>
          <h3 className="section-title">คุณส่งคำขอไป (รออีกฝ่ายยอมรับ)</h3>
          {data.outgoing.length === 0 && <p className="small muted" style={{ padding: '0 12px' }}>ไม่มี</p>}
          <ul className="user-list">
            {data.outgoing.map((u) => (
              <li key={u.id} className="user-item">
                <Avatar name={u.displayName} url={u.pictureUrl} size={36} />
                <div className="grow">{u.displayName}</div>
                <button className="link" disabled={busy === u.id} onClick={() => remove(u, 'ยกเลิกคำขอแล้ว')}>ยกเลิกคำขอ</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && tab === 'add' && (
        <>
          <div className="qr-box">
            {qr ? <img src={qr} alt="QR เพิ่มเพื่อนของฉัน" /> : <span className="muted">กำลังสร้าง QR…</span>}
            <div className="small muted">ให้เพื่อนสแกน หรือส่งลิงก์นี้ให้เพื่อน</div>
            <div className="seg">
              <button className="btn btn-small" onClick={() => navigator.clipboard.writeText(myLink).then(
                () => notify('success', 'คัดลอกลิงก์แล้ว'),
                () => notify('error', 'คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด'),
              )}>คัดลอกลิงก์</button>
              <a className="btn btn-small btn-line-small" target="_blank" rel="noreferrer"
                href={`https://line.me/R/share?text=${encodeURIComponent(`เพิ่มเพื่อนกับ ${me.user.displayName}: ${myLink}`)}`}>แชร์ไป LINE</a>
            </div>
          </div>
          <div className="form-block"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อคนในระบบ" /></div>
          <ul className="user-list">
            {others.map((u) => (
              <li key={u.id} className="user-item">
                <Avatar name={u.displayName} url={u.pictureUrl} size={36} />
                <div className="grow">{u.displayName}{u.role === 'admin' && <span className="small muted"> · แอดมิน</span>}</div>
                {u.friend === 'friend' && <span className="small muted">เพื่อนแล้ว</span>}
                {u.friend === 'outgoing' && <span className="small muted">รอยอมรับ</span>}
                {u.friend === 'incoming' && <button className="btn btn-small" disabled={busy === u.id} onClick={() => void accept(u as unknown as FriendUser)}>ยอมรับคำขอ</button>}
                {u.friend === 'none' && <button className="btn btn-small" disabled={busy === u.id} onClick={() => void request(u)}>+ เพิ่ม</button>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small muted" style={{ padding: 12 }}>
        แชท 1:1 และเพิ่มเข้ากลุ่มได้เฉพาะเพื่อน · แอดมินระบบและบอทคุยได้โดยไม่ต้องเป็นเพื่อน · คนที่ไม่ใช่เพื่อนเข้ากลุ่มได้ทาง <Link to="/">ลิงก์เชิญ</Link>
      </p>
    </div>
  );
}
