// =====================================================================
// ChatListPage.tsx — รายการแชท (เรียงตามข้อความล่าสุด + ตัวเลขยังไม่อ่าน)
// อัปเดตทุก 15 วินาที, ทุกครั้งที่กลับมาที่แอป และทันทีที่มีข้อความใหม่ (event 'chat-activity' จาก InAppNotifier)
// เฟส 5: ปุ่ม 👥 เพื่อน (ตัวเลข = คำขอรอยอมรับ) + เมนู ☰ รวม โน้ต / หน้าตาแอป / แจ้งเตือน / ออเดอร์ / แอดมิน / ออก
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { thaiShort } from '../../shared/time';
import { FriendsData, Room, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import SetupCard from '../SetupCard';
import { setBadge } from '../InAppNotifier';

const REFRESH_MS = 15_000;

export default function ChatListPage() {
  const { me, logout } = useMe();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState('');
  const [friendReqs, setFriendReqs] = useState(0);
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    // คำขอเป็นเพื่อนที่รอยอมรับ · โหลดไม่สำเร็จ → ปุ่มเพื่อนขึ้น "!" (เปิดหน้าเพื่อนจะเห็นเหตุผล) ไม่บังหน้ารายการแชท
    api.get<FriendsData>('/api/friends')
      .then((f) => setFriendReqs(f.incoming.length))
      .catch((e) => { console.warn('โหลดคำขอเป็นเพื่อนไม่สำเร็จ', e); setFriendReqs(-1); });
    try {
      const data = await api.get<{ rooms: Room[] }>('/api/rooms');
      setRooms(data.rooms);
      setError('');
      // ตัวเลขบนไอคอนแอป = ยังไม่อ่านรวม ไม่นับห้องที่ปิดเสียง (ให้ตรงกับฝั่งเซิร์ฟเวอร์)
      setBadge(data.rooms.reduce((n, r) => n + (r.muted ? 0 : r.unread), 0));
    } catch (e) {
      setError(`โหลดรายการแชทไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    const onActivity = () => void load();
    window.addEventListener('chat-activity', onActivity);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('chat-activity', onActivity);
    };
  }, [load]);

  return (
    <div className="page">
      <TopBar
        title={me.appName}
        right={
          <>
            <Link to="/channels" className="btn btn-small btn-ghost">ชาเนล</Link>
            <Link to="/friends" className="btn btn-small btn-ghost icon-badge"
              aria-label={friendReqs < 0 ? 'เพื่อน (โหลดคำขอไม่สำเร็จ)' : `เพื่อน${friendReqs ? ` (คำขอ ${friendReqs})` : ''}`}>
              👥{friendReqs !== 0 && <span className="badge">{friendReqs < 0 ? '!' : friendReqs}</span>}
            </Link>
            <button className="btn btn-small btn-ghost" onClick={() => setMenu(true)} aria-label="เมนู">☰</button>
          </>
        }
      />
      <SetupCard />
      {error && (
        <div className="banner banner-error" role="alert">
          {error} <button className="link" onClick={() => void load()}>ลองใหม่</button>
        </div>
      )}
      {rooms === null && !error && <p className="center muted">กำลังโหลด…</p>}
      {rooms?.length === 0 && <p className="center muted">ยังไม่มีแชท — กดปุ่ม + เพื่อเริ่มคุย</p>}
      <ul className="room-list">
        {rooms?.map((r) => (
          <li key={r.id}>
            <Link to={`/room/${r.id}`} className="room-item">
              <Avatar name={r.title} url={r.picture} />
              <div className="room-main">
                <div className="room-top">
                  <span className="room-title">{r.type === 'group' ? '👥 ' : r.type === 'channel' ? '📢 ' : ''}{r.muted ? '🔕 ' : ''}{r.title}</span>
                  <span className="room-time">{thaiShort(r.lastMessageAt ?? r.createdAt)}</span>
                </div>
                <div className="room-bottom">
                  <span className="room-preview">
                    {r.lastMessagePreview
                      ? `${r.type === 'group' && r.lastSenderName ? r.lastSenderName + ': ' : ''}${r.lastMessagePreview}`
                      : 'ยังไม่มีข้อความ'}
                  </span>
                  {r.unread > 0 && <span className={`badge ${r.muted ? 'badge-muted' : ''}`}>{r.unread > 99 ? '99+' : r.unread}</span>}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/new" className="fab" aria-label="เริ่มแชทใหม่">+</Link>
      {menu && (
        <div className="sheet-backdrop" onClick={() => setMenu(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><b>{me.user.displayName}</b><button className="link" onClick={() => setMenu(false)}>ปิด</button></div>
            <ul className="menu-list">
              <li><Link to="/friends">👥 เพื่อน{friendReqs > 0 ? ` · คำขอ ${friendReqs}` : ''}</Link></li>
              <li><Link to="/notes">🗒 โน้ตของฉัน</Link></li>
              <li><Link to="/appearance">🎨 หน้าตาแอป (ธีม / ตัวอักษร)</Link></li>
              <li><Link to="/settings">🔔 ตั้งค่าแจ้งเตือน</Link></li>
              <li><Link to="/orders">📦 ออเดอร์</Link></li>
              {me.user.role === 'admin' && <li><Link to="/admin">🛠 แอดมิน</Link></li>}
              <li><button onClick={() => void logout()}>🚪 ออกจากระบบ</button></li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
