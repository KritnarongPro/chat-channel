// =====================================================================
// ChatListPage.tsx — รายการแชท (เรียงตามข้อความล่าสุด + ตัวเลขยังไม่อ่าน)
// ข้อมูลมาจาก counts.tsx (โหลดทุก 15 วิ / กลับมาที่แอป / มีข้อความใหม่ — ชุดเดียวกับตัวเลขบนแถบล่าง)
// 2026-11-18: ปุ่มชาเนล / 👥 / ☰ ย้ายไปแถบเมนูล่าง (AppShell) · ปุ่ม + เริ่มแชทอยู่บนหัว (เดิมลอยมุมจอ)
//   iPad (2 ช่อง): หน้านี้อยู่ช่องซ้ายตลอด → ไฮไลต์ห้องที่เปิดอยู่ทางขวา
// =====================================================================

import { Link, useMatch } from 'react-router';
import { thaiShort } from '../../shared/time';
import { Avatar, TopBar } from '../components';
import { useCounts } from '../counts';
import { useMe } from '../me';
import SetupCard from '../SetupCard';
import Loading from '../Loading';

export default function ChatListPage() {
  const { me } = useMe();
  const { rooms, roomsError: error, reload } = useCounts();
  const roomSub = useMatch('/room/:id/*');  // เรียกทั้งสองเสมอ (hook ห้ามอยู่ในเงื่อนไข)
  const roomExact = useMatch('/room/:id');
  const openId = roomExact?.params.id ?? roomSub?.params.id;

  return (
    <div className="page">
      <TopBar
        title={me.appName}
        right={<Link to="/new" className="btn btn-small btn-ghost icon-btn" aria-label="เริ่มแชทใหม่" title="เริ่มแชทใหม่">＋</Link>}
      />
      <SetupCard compact />
      {error && (
        <div className="banner banner-error" role="alert">
          {error} <button className="link" onClick={reload}>ลองใหม่</button>
        </div>
      )}
      {rooms === null && !error && <Loading variant="list" onRetry={reload} />}
      {rooms?.length === 0 && <p className="center muted">ยังไม่มีแชท — กดปุ่ม ＋ ด้านบนเพื่อเริ่มคุย</p>}
      <ul className="room-list">
        {rooms?.map((r) => (
          <li key={r.id}>
            <Link to={`/room/${r.id}`} className={`room-item ${openId === r.id ? 'active' : ''}`} aria-current={openId === r.id ? 'page' : undefined}>
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
    </div>
  );
}
