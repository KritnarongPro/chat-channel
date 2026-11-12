// =====================================================================
// AddFriendPage.tsx — เปิดจากลิงก์/QR เพิ่มเพื่อน (/add/<ไอดีผู้ใช้>) → ส่งคำขอเป็นเพื่อน (เฟส 5)
// =====================================================================

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { User, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import { useNotify } from '../notice';

export default function AddFriendPage() {
  const { userId = '' } = useParams();
  const { me } = useMe();
  const nav = useNavigate();
  const notify = useNotify();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ users: User[] }>('/api/users')
      .then((d) => setUser(d.users.find((u) => u.id === userId) ?? null))
      .catch((e) => setError(`โหลดข้อมูลไม่สำเร็จ: ${errMsg(e)}`));
  }, [userId]);

  async function send() {
    setBusy(true);
    try {
      const r = await api.post<{ status: string }>('/api/friends/request', { userId });
      notify('success', r.status === 'accepted' ? 'เป็นเพื่อนกันแล้ว' : 'ส่งคำขอแล้ว รออีกฝ่ายกดยอมรับ');
      nav('/friends', { replace: true });
    } catch (e) {
      notify('error', errMsg(e));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar title="เพิ่มเพื่อน" back="/friends" />
      <div className="center">
        {error && <p className="error-text">{error}</p>}
        {user === undefined && !error && <p className="muted">กำลังโหลด…</p>}
        {userId === me.user.id && <p>นี่คือลิงก์เพิ่มเพื่อนของคุณเอง — ส่งให้คนอื่นสแกน</p>}
        {user === null && userId !== me.user.id && <p className="error-text">ไม่พบผู้ใช้นี้ หรือยังไม่ได้รับอนุมัติ</p>}
        {user && (
          <div className="card">
            <div className="row"><Avatar name={user.displayName} url={user.pictureUrl} size={48} /><b>{user.displayName}</b></div>
            {user.friend === 'friend' && <p>เป็นเพื่อนกันอยู่แล้ว</p>}
            {user.friend === 'outgoing' && <p className="muted">ส่งคำขอไปแล้ว รออีกฝ่ายกดยอมรับ</p>}
            {(user.friend === 'none' || user.friend === 'incoming') && (
              <button className="btn btn-block" disabled={busy} onClick={() => void send()}>
                {user.friend === 'incoming' ? 'ยอมรับคำขอเป็นเพื่อน' : 'ส่งคำขอเป็นเพื่อน'}
              </button>
            )}
            <Link to="/friends" className="small">ไปหน้าเพื่อน</Link>
          </div>
        )}
      </div>
    </div>
  );
}
