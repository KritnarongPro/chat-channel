// =====================================================================
// ChatListPage.tsx — รายการแชท (เรียงตามข้อความล่าสุด + ตัวเลขยังไม่อ่าน)
// อัปเดตทุก 15 วินาที และทุกครั้งที่กลับมาที่แอป
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { thaiShort } from '../../shared/time';
import { Room, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import SetupCard from '../SetupCard';

const REFRESH_MS = 15_000;

export default function ChatListPage() {
  const { me, logout } = useMe();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ rooms: Room[] }>('/api/rooms');
      setRooms(data.rooms);
      setError('');
    } catch (e) {
      setError(`โหลดรายการแชทไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  return (
    <div className="page">
      <TopBar
        title={me.appName}
        right={
          <>
            <Link to="/channels" className="btn btn-small btn-ghost">ชาเนล</Link>
            <Link to="/orders" className="btn btn-small btn-ghost" aria-label="ออเดอร์">📦</Link>
            <Link to="/settings" className="btn btn-small btn-ghost" aria-label="ตั้งค่าแจ้งเตือน">🔔</Link>
            {me.user.role === 'admin' && <Link to="/admin" className="btn btn-small btn-ghost">แอดมิน</Link>}
            <button className="btn btn-small btn-ghost" onClick={() => void logout()}>ออก</button>
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
                  {r.unread > 0 && <span className="badge">{r.unread > 99 ? '99+' : r.unread}</span>}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/new" className="fab" aria-label="เริ่มแชทใหม่">+</Link>
    </div>
  );
}
