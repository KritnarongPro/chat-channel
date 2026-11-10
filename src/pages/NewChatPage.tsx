// =====================================================================
// NewChatPage.tsx — เริ่มแชท: เลือก 1 คน = แชท 1:1 · เลือกหลายคน + ตั้งชื่อ = กลุ่ม
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { User, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';

export default function NewChatPage() {
  const nav = useNavigate();
  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ users: User[] }>('/api/users')
      .then((d) => setUsers(d.users))
      .catch((e) => setLoadError(`โหลดรายชื่อไม่สำเร็จ: ${errMsg(e)}`));
  }, []);

  const shown = useMemo(
    () => (users ?? []).filter((u) => u.displayName.toLowerCase().includes(q.trim().toLowerCase())),
    [users, q],
  );

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  async function start() {
    setError('');
    if (picked.size === 0) { setError('เลือกอย่างน้อย 1 คน'); return; }
    if (picked.size > 1 && !title.trim()) { setError('ตั้งชื่อกลุ่มก่อน'); return; }
    setBusy(true);
    try {
      const res = picked.size === 1 && !title.trim()
        ? await api.post<{ roomId: string }>('/api/rooms/dm', { userId: [...picked][0] })
        : await api.post<{ roomId: string }>('/api/rooms/group', { title: title.trim(), memberIds: [...picked] });
      nav(`/room/${res.roomId}`, { replace: true });
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar title="เริ่มแชทใหม่" back="/" />
      <div className="form-block">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          placeholder={picked.size > 1 ? 'ชื่อกลุ่ม (จำเป็น)' : 'ชื่อกลุ่ม (ใส่ถ้าต้องการสร้างกลุ่ม)'}
        />
      </div>
      {loadError && <div className="banner banner-error" role="alert">{loadError}</div>}
      {users === null && !loadError && <p className="center muted">กำลังโหลด…</p>}
      {users?.length === 0 && <p className="center muted">ยังไม่มีผู้ใช้อื่นที่ได้รับอนุมัติ</p>}
      <ul className="user-list">
        {shown.map((u) => (
          <li key={u.id}>
            <label className="user-item">
              <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
              <Avatar name={u.displayName} url={u.pictureUrl} size={36} />
              <span>{u.displayName}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="bottom-bar">
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-block" disabled={busy || picked.size === 0} onClick={() => void start()}>
          {busy ? 'กำลังสร้าง…'
            : picked.size > 1 || title.trim() ? `สร้างกลุ่ม (${picked.size} คน)`
            : 'เริ่มแชท 1:1'}
        </button>
      </div>
    </div>
  );
}
