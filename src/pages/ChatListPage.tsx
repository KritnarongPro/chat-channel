// =====================================================================
// ChatListPage.tsx — รายการแชท (เรียงตามข้อความล่าสุด + ตัวเลขยังไม่อ่าน)
// ข้อมูลมาจาก counts.tsx (โหลดทุก 15 วิ / กลับมาที่แอป / มีข้อความใหม่ — ชุดเดียวกับตัวเลขบนแถบล่าง)
// 2026-11-18: ปุ่มชาเนล / 👥 / ☰ ย้ายไปแถบเมนูล่าง (AppShell) · ปุ่ม + เริ่มแชทอยู่บนหัว (เดิมลอยมุมจอ)
//   iPad (2 ช่อง): หน้านี้อยู่ช่องซ้ายตลอด → ไฮไลต์ห้องที่เปิดอยู่ทางขวา
// 2026-11-18 (ผู้ใช้เลือก): จัดการห้องจากรายการได้เลย
//   ปัดแถวไปทางซ้าย → ปุ่ม 🔕 ปิดเสียง + 🗑 ลบ · กดค้าง (มือถือ) / คลิกขวา (คอม) → เมนูเต็ม
//   (ปิดเสียง · อ่านแล้วทั้งหมด · ลบแชทฝั่งฉัน · ออกจากกลุ่ม) — ใช้ RoomActions.tsx ตัวเดียวกับในห้อง
// =====================================================================

import { MouseEvent, TouchEvent, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { thaiShort } from '../../shared/time';
import { Room, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useCounts } from '../counts';
import { useMe } from '../me';
import { useNotify } from '../notice';
import { CLEAR_CONFIRM, MuteSheet, RoomMenu } from '../RoomActions';
import SetupCard from '../SetupCard';
import Loading from '../Loading';

const ACTIONS_W = 152;     // ความกว้างปุ่มที่โผล่ตอนปัดซ้าย (2 ปุ่ม × 76px)
const OPEN_AT = 60;        // ปัดเกินเท่านี้แล้วปล่อย = ค้างเปิด
const LONG_PRESS_MS = 500;

export default function ChatListPage() {
  const { me } = useMe();
  const { rooms, roomsError: error, reload } = useCounts();
  const notify = useNotify();
  const nav = useNavigate();
  const [swipedId, setSwipedId] = useState<string | null>(null);  // แถวที่ปัดค้างไว้ (เปิดได้ทีละแถว)
  const [menuFor, setMenuFor] = useState<Room | null>(null);
  const [muteFor, setMuteFor] = useState<Room | null>(null);
  const [busyId, setBusyId] = useState('');
  const roomSub = useMatch('/room/:id/*');  // เรียกทั้งสองเสมอ (hook ห้ามอยู่ในเงื่อนไข)
  const roomExact = useMatch('/room/:id');
  const openId = roomExact?.params.id ?? roomSub?.params.id;

  async function deleteChat(r: Room) {
    if (!confirm(CLEAR_CONFIRM)) return;
    setBusyId(r.id);
    try {
      await api.post(`/api/rooms/${encodeURIComponent(r.id)}/clear`);
      notify('success', `ลบแชท ${r.title} แล้ว`);
      setSwipedId(null);
      if (openId === r.id) nav('/', { replace: true });  // iPad: ห้องที่ลบเปิดอยู่ทางขวา → ปิด
      reload();
    } catch (e) {
      notify('error', `ลบแชทไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusyId('');
    }
  }

  async function markRead(r: Room) {
    await api.post(`/api/rooms/${encodeURIComponent(r.id)}/read`);  // ไม่สำเร็จ → RoomMenu แจ้ง error เอง
    notify('success', `${r.title}: อ่านแล้วทั้งหมด`);
    reload();
  }

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
          <RoomRow key={r.id} r={r} active={openId === r.id} swiped={swipedId === r.id} busy={busyId === r.id}
            onSwipe={(open) => setSwipedId(open ? r.id : null)}
            onMenu={() => { setSwipedId(null); setMenuFor(r); }}
            onMute={() => { setSwipedId(null); setMuteFor(r); }}
            onDelete={() => void deleteChat(r)} />
        ))}
      </ul>
      {menuFor && (
        <RoomMenu room={menuFor} members={null} onClose={() => setMenuFor(null)} onChanged={reload}
          fromList={{ onMute: () => setMuteFor(menuFor), onMarkRead: () => markRead(menuFor) }} />
      )}
      {muteFor && <MuteSheet room={muteFor} onClose={() => setMuteFor(null)} onSaved={() => reload()} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// แถวห้อง: ปัดซ้ายเผยปุ่ม · กดค้างเปิดเมนู · แตะปกติ = เข้าห้อง
//   ขยับนิ้วขึ้นลง = เลื่อนรายการปกติ (touch-action: pan-y) · ปัดค้างอยู่แล้วแตะแถว = ปิดปุ่ม (ไม่เข้าห้อง)
// ---------------------------------------------------------------------
function RoomRow({ r, active, swiped, busy, onSwipe, onMenu, onMute, onDelete }: {
  r: Room; active: boolean; swiped: boolean; busy: boolean;
  onSwipe: (open: boolean) => void; onMenu: () => void; onMute: () => void; onDelete: () => void;
}) {
  const front = useRef<HTMLAnchorElement>(null);
  const st = useRef<{ x: number; y: number; mode: 'idle' | 'h' | 'v'; dx: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const longPressed = useRef(false);
  const base = swiped ? -ACTIONS_W : 0;

  function paint(x: number, animate: boolean) {
    const el = front.current;
    if (!el) return;
    el.style.transition = animate ? 'transform .18s ease-out' : 'none';
    el.style.transform = x ? `translateX(${x}px)` : '';
  }
  function start(e: TouchEvent) {
    const t = e.touches[0];
    st.current = { x: t.clientX, y: t.clientY, mode: 'idle', dx: 0 };
    longPressed.current = false;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (st.current?.mode === 'idle') { longPressed.current = true; suppressClick.current = true; navigator.vibrate?.(10); onMenu(); }
    }, LONG_PRESS_MS);
  }
  function move(e: TouchEvent) {
    const s = st.current;
    if (!s || s.mode === 'v') return;
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (s.mode === 'idle') {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      clearTimeout(timer.current);
      s.mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
      if (s.mode === 'v') return;
    }
    s.dx = dx;
    paint(Math.min(0, Math.max(-ACTIONS_W - 24, base + dx)), false);
  }
  function end(e: TouchEvent) {
    clearTimeout(timer.current);
    // กดค้างจนเมนูเปิดแล้ว: ยกนิ้ว = ห้ามเกิด "แตะ" ตาม (ไม่งั้นแตะโดนพื้นหลังเมนูแล้วเมนูปิดทันที)
    if (longPressed.current) { e.preventDefault(); longPressed.current = false; }
    const s = st.current;
    st.current = null;
    if (!s || s.mode !== 'h') return;
    suppressClick.current = true;  // ปัดแล้วปล่อย ไม่ใช่การแตะเข้าห้อง
    const open = base + s.dx < -OPEN_AT;
    paint(open ? -ACTIONS_W : 0, true);
    onSwipe(open);
  }
  function click(e: MouseEvent) {
    if (suppressClick.current || swiped) {
      e.preventDefault();
      suppressClick.current = false;
      if (swiped) { paint(0, true); onSwipe(false); }
    }
  }

  return (
    <li className="swipe-row">
      <div className="swipe-actions" aria-hidden={!swiped}>
        <button className="swipe-mute" disabled={busy} onClick={onMute} tabIndex={swiped ? 0 : -1}>
          <span>{r.muted ? '🔔' : '🔕'}</span>{r.muted ? 'เปิดเสียง' : 'ปิดเสียง'}
        </button>
        <button className="swipe-delete" disabled={busy} onClick={onDelete} tabIndex={swiped ? 0 : -1}>
          <span>🗑</span>{busy ? 'กำลังลบ…' : 'ลบ'}
        </button>
      </div>
      <Link ref={front} to={`/room/${r.id}`} className={`room-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}
        style={swiped ? { transform: `translateX(${-ACTIONS_W}px)` } : undefined}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end} onClick={click}
        onContextMenu={(e) => { e.preventDefault(); onMenu(); }}
        aria-label={`${r.title}${r.unread ? ` ยังไม่อ่าน ${r.unread}` : ''} — กดค้างหรือคลิกขวาเพื่อจัดการ`}>
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
  );
}
