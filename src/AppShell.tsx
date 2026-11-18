// =====================================================================
// AppShell.tsx — โครงหน้าหลักสำหรับมือถือ + iPad (2026-11-18)
//   มือถือ (< 768px): หน้าเดียวเต็มจอ · แถบเมนูล่าง (แชท/ชาเนล/เพื่อน/เมนู) เฉพาะ 4 หน้าหลัก
//                     ในห้องแชทและหน้าย่อยซ่อนแถบล่าง (ให้ที่ช่องพิมพ์/เนื้อหา)
//   จอกว้าง (≥ 768px — iPad ทั้งแนวตั้ง/แนวนอน): 2 ช่อง แบบ LINE บน iPad
//                     ซ้าย = รายการแชท + แถบล่าง (อยู่ตลอด) · ขวา = หน้าที่เปิด (ห้องแชท ฯลฯ)
//   ปัดจากขอบซ้ายเพื่อย้อนกลับ: มือถือ + แอปที่ติดตั้งบน iPhone เท่านั้น (gestures.ts)
// =====================================================================

import { ReactElement, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { CountsProvider, useCounts } from './counts';
import { needsOwnBackSwipe, useEdgeSwipeBack, useWide } from './gestures';
import { useMe } from './me';
import ChatListPage from './pages/ChatListPage';

/** หน้าหลัก 4 หน้า = มีแถบล่างบนมือถือ */
export const TAB_PATHS = ['/', '/channels', '/friends', '/menu'];

export default function AppShell() {
  const wide = useWide();
  const { pathname } = useLocation();
  const isTab = TAB_PATHS.includes(pathname);
  return (
    <CountsProvider active={wide || isTab}>
      {wide ? <WideLayout /> : <PhoneLayout isTab={isTab} />}
    </CountsProvider>
  );
}

function PhoneLayout({ isTab }: { isTab: boolean }) {
  const nav = useNavigate();
  const view = useRef<HTMLDivElement>(null);
  // ย้อนกลับ: มีประวัติในแอป → ย้อนหน้าเดิม · เปิดตรงจากแจ้งเตือน (ไม่มีประวัติ) → หน้ารายการแชท
  useEdgeSwipeBack(!isTab && needsOwnBackSwipe(), view, () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1); else nav('/', { replace: true });
  });
  return (
    <div className={`route-view ${isTab ? 'has-tabbar' : ''}`} ref={view}>
      <Outlet />
      {isTab && <TabBar />}
    </div>
  );
}

function WideLayout() {
  return (
    <div className="split">
      <aside className="split-list" aria-label="รายการแชท">
        <ChatListPage />
        <TabBar />
      </aside>
      <main className="split-main">
        <Outlet />
      </main>
    </div>
  );
}

/** หน้าแรก "/": มือถือ = รายการแชท · จอกว้าง = รายการอยู่ช่องซ้ายแล้ว ช่องขวาบอกให้เลือกแชท */
export function HomeRoute() {
  const wide = useWide();
  if (!wide) return <ChatListPage />;
  return (
    <div className="page empty-pane">
      <div className="empty-pane-icon" aria-hidden="true">💬</div>
      <p className="muted">เลือกแชททางซ้ายเพื่อเริ่มคุย</p>
      <Link to="/new" className="btn">+ เริ่มแชทใหม่</Link>
    </div>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  const { me } = useMe();
  const { unread, friendReqs, pendingUsers } = useCounts();
  const badge = (n: number) => (n === 0 ? null : <span className="badge">{n < 0 ? '!' : n > 99 ? '99+' : n}</span>);
  const tabs = [
    { to: '/', icon: 'chat', label: 'แชท', on: pathname === '/' || pathname.startsWith('/room/') || pathname === '/new', n: unread,
      aria: unread ? `แชท (ยังไม่อ่าน ${unread})` : 'แชท' },
    { to: '/channels', icon: 'channel', label: 'ชาเนล', on: pathname === '/channels', n: 0, aria: 'ชาเนล' },
    { to: '/friends', icon: 'friends', label: 'เพื่อน', on: pathname.startsWith('/friends') || pathname.startsWith('/add/'), n: friendReqs,
      aria: friendReqs < 0 ? 'เพื่อน (โหลดคำขอไม่สำเร็จ)' : friendReqs ? `เพื่อน (คำขอ ${friendReqs})` : 'เพื่อน' },
    { to: '/menu', icon: 'menu', label: 'เมนู', on: !['/', '/channels', '/new'].includes(pathname) && !pathname.startsWith('/room/') && !pathname.startsWith('/friends') && !pathname.startsWith('/add/'),
      n: me.user.role === 'admin' ? pendingUsers : 0,
      aria: me.user.role === 'admin' && pendingUsers > 0 ? `เมนู — มีคนรออนุมัติ ${pendingUsers} คน` : 'เมนู' },
  ];
  return (
    <nav className="tabbar" aria-label="เมนูหลัก">
      {tabs.map((t) => (
        <Link key={t.to} to={t.to} className={`tab ${t.on ? 'on' : ''}`} aria-label={t.aria} aria-current={t.on ? 'page' : undefined}>
          <span className="tab-icon"><TabIcon name={t.icon} on={t.on} />{badge(t.n)}</span>
          <span className="tab-label">{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------
// ไอคอนเส้นของแถบล่าง (2026-11-18 — วาดเอง ไม่ใช้ของแอปอื่น) · ตัวที่เลือกอยู่ = เส้นหนาขึ้น + พื้นจาง
// ---------------------------------------------------------------------
const TAB_PATHS_SVG: Record<string, ReactElement> = {
  chat: <path d="M4 11.5C4 7.4 7.6 4.5 12 4.5s8 2.9 8 7-3.6 7-8 7c-1 0-2-.15-2.9-.43L5 19.5l1.2-3.4C4.8 14.9 4 13.3 4 11.5Z" />,
  channel: <><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M17 9.5a3.5 3.5 0 0 1 0 5" /><path d="M19.5 7a7 7 0 0 1 0 10" /></>,
  friends: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" /><circle cx="16.5" cy="9.5" r="2.6" /><path d="M16 14.3c2.4.1 4 1.7 4.5 4.2" /></>,
  menu: <><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h14" /></>,
};
function TabIcon({ name, on }: { name: string; on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill={on && name === 'chat' ? 'currentColor' : 'none'} fillOpacity={0.14}
      stroke="currentColor" strokeWidth={on ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TAB_PATHS_SVG[name]}
    </svg>
  );
}
