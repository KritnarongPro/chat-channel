// =====================================================================
// counts.tsx — ข้อมูลกลางของรายการแชท + ตัวเลขบนแถบเมนูล่าง (2026-11-18)
//   rooms        = รายการแชท (หน้ารายการแชท + ช่องซ้ายของ iPad ใช้ชุดเดียวกัน ไม่โหลดซ้ำ)
//   unread       = ยังไม่อ่านรวม ไม่นับห้องที่ปิดเสียง (ตรงกับตัวเลขบนไอคอนแอป)
//   friendReqs   = คำขอเป็นเพื่อนที่รอยอมรับ (-1 = โหลดไม่ได้ → ขึ้น "!")
//   pendingUsers = แอดมิน: คนรออนุมัติ (-1 = โหลดไม่ได้ → ขึ้น "!")
// โหลดใหม่: ทุก 15 วิ (เฉพาะตอน active = มีรายการแชทหรือแถบล่างอยู่บนจอ), เปลี่ยนหน้า,
//          กลับมาที่แอป, มีข้อความใหม่ (chat-activity), มีคนสมัคร (admin-activity)
//          และห้องที่เปิดอยู่มีข้อความใหม่/อ่านแล้ว (room-seen — ChatRoomPage, ใช้กับ iPad 2 ช่อง)
// =====================================================================

import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { FriendsData, Room, api, errMsg } from './api';
import { useMe } from './me';
import { setBadge } from './InAppNotifier';

const REFRESH_MS = 15_000;

export interface Counts {
  rooms: Room[] | null;
  roomsError: string;
  unread: number;
  friendReqs: number;
  pendingUsers: number;
  reload: () => void;
}

const CountsContext = createContext<Counts | null>(null);

export function useCounts(): Counts {
  const c = useContext(CountsContext);
  if (!c) throw new Error('useCounts ต้องอยู่ใน CountsProvider');
  return c;
}

export function CountsProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const { me } = useMe();
  const { pathname } = useLocation();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [roomsError, setRoomsError] = useState('');
  const [friendReqs, setFriendReqs] = useState(0);
  const [pendingUsers, setPendingUsers] = useState(0);

  const load = useCallback(async () => {
    // ตัวเลขเสริม: โหลดไม่ได้ → ขึ้น "!" บนปุ่ม (เปิดหน้านั้นจะเห็นเหตุผลเต็ม) ไม่บังรายการแชท
    api.get<FriendsData>('/api/friends')
      .then((f) => setFriendReqs(f.incoming.length))
      .catch((e) => { console.warn('โหลดคำขอเป็นเพื่อนไม่สำเร็จ', e); setFriendReqs(-1); });
    if (me.user.role === 'admin') {
      api.get<{ pending: number }>('/api/admin/pending-count')
        .then((d) => setPendingUsers(d.pending))
        .catch((e) => { console.warn('โหลดจำนวนคนรออนุมัติไม่สำเร็จ', e); setPendingUsers(-1); });
    }
    try {
      const data = await api.get<{ rooms: Room[] }>('/api/rooms');
      setRooms(data.rooms);
      setRoomsError('');
      setBadge(data.rooms.reduce((n, r) => n + (r.muted ? 0 : r.unread), 0));
    } catch (e) {
      setRoomsError(`โหลดรายการแชทไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, [me.user.role]);

  // เปลี่ยนหน้า (เช่น ออกจากห้องแชท / กดยอมรับเพื่อนแล้วกลับ) → ตัวเลขอัปเดตทันที
  useEffect(() => { if (active) void load(); }, [active, pathname, load]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    const onActivity = () => void load();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('chat-activity', onActivity);
    window.addEventListener('admin-activity', onActivity);
    window.addEventListener('room-seen', onActivity);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('chat-activity', onActivity);
      window.removeEventListener('admin-activity', onActivity);
      window.removeEventListener('room-seen', onActivity);
    };
  }, [active, load]);

  const unread = (rooms ?? []).reduce((n, r) => n + (r.muted ? 0 : r.unread), 0);
  return (
    <CountsContext.Provider value={{ rooms, roomsError, unread, friendReqs, pendingUsers, reload: () => void load() }}>
      {children}
    </CountsContext.Provider>
  );
}
