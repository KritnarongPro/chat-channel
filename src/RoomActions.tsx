// =====================================================================
// RoomActions.tsx — คำสั่งของห้องที่ใช้ร่วมกัน (2026-11-18 — ย้ายมาจาก ChatRoomPage)
//   MuteSheet  ปิด/เปิดเสียงห้อง (1 ชม. / 8 ชม. / 2 วัน / ตลอด)
//   RoomMenu   ลบแชทฝั่งฉัน · ออกจากกลุ่ม (เจ้าของเลือกคนรับต่อ)
//              + เปิดจากหน้ารายการแชท (กดค้าง): ปิดเสียง · อ่านแล้วทั้งหมด
// =====================================================================

import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { thaiClock, thaiDate } from '../shared/time';
import { Room, RoomMember, api, errMsg } from './api';
import { Avatar } from './components';
import { useMe } from './me';
import { useNotify } from './notice';

const MUTE_OPTIONS: { key: '1h' | '8h' | '2d' | 'forever'; label: string }[] = [
  { key: '1h', label: '1 ชั่วโมง' }, { key: '8h', label: '8 ชั่วโมง' }, { key: '2d', label: '2 วัน' }, { key: 'forever', label: 'ตลอดไป' },
];

export function MuteSheet({ room, onClose, onSaved }: {
  room: Room; onClose: () => void; onSaved: (muted: boolean, mutedUntil: string | null) => void;
}) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  async function save(body: { muted: boolean; for?: string }) {
    setBusy(true);
    try {
      const r = await api.post<{ muted: boolean; mutedUntil: string | null }>(`/api/rooms/${encodeURIComponent(room.id)}/mute`, body);
      onSaved(r.muted, r.mutedUntil);
      notify('success', !r.muted ? 'เปิดแจ้งเตือนห้องนี้แล้ว'
        : r.mutedUntil ? `ปิดเสียงถึง ${thaiDate(r.mutedUntil)} ${thaiClock(r.mutedUntil)} น.` : 'ปิดเสียงห้องนี้ตลอดไปแล้ว');
      onClose();
    } catch (e) {
      notify('error', `ตั้งค่าแจ้งเตือนไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>แจ้งเตือนห้องนี้</b><button className="link" onClick={onClose}>ปิด</button></div>
        <p className="small">
          ตอนนี้: <b>{!room.muted ? 'เปิดอยู่ 🔔'
            : room.mutedUntil ? `ปิดเสียงถึง ${thaiDate(room.mutedUntil)} ${thaiClock(room.mutedUntil)} น.` : 'ปิดเสียงตลอด 🔕'}</b>
        </p>
        {room.muted && <button className="btn btn-block" disabled={busy} onClick={() => void save({ muted: false })}>🔔 เปิดแจ้งเตือน</button>}
        <p className="small muted">ปิดเสียงเป็นเวลา:</p>
        {MUTE_OPTIONS.map((o) => (
          <button key={o.key} className="btn btn-ghost btn-block" disabled={busy} onClick={() => void save({ muted: true, for: o.key })}>🔕 {o.label}</button>
        ))}
        <p className="small muted">ปิดเสียงแล้วถ้ามีคน @ชื่อคุณ หรือตอบกลับข้อความคุณ ยังเด้งอยู่ (ปิดได้ที่หน้า ตั้งค่าแจ้งเตือน)</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// เมนูห้อง (⋯): ลบแชทฝั่งฉัน · ออกจากกลุ่ม (เจ้าของต้องเลือกคนรับต่อ)
// ---------------------------------------------------------------------
/** ข้อความยืนยันลบแชทฝั่งฉัน — ใช้ทั้งเมนูห้องและปุ่มปัดซ้ายในรายการแชท */
export const CLEAR_CONFIRM = 'ลบแชทนี้ฝั่งคุณ? ประวัติข้อความจะหายจากเครื่องคุณ และห้องจะหายจากรายการ (คนอื่นยังเห็นครบ) — มีข้อความใหม่ห้องจะกลับมาเอง';

export function RoomMenu({ room, members: given, onClose, fromList, onChanged, links }: {
  room: Room;
  members: RoomMember[] | null;  // null = เปิดจากหน้ารายการแชท → โหลดรายชื่อเองตอนเจ้าของจะออก (ต้องเลือกคนรับต่อ)
  onClose: () => void;
  /** เปิดจากหน้ารายการแชท (กดค้าง): เพิ่มปุ่มปิดเสียง + อ่านแล้วทั้งหมด */
  fromList?: { onMute: () => void; onMarkRead: () => Promise<void> };
  onChanged?: () => void;  // ลบแชท/ออกจากกลุ่มสำเร็จ → ให้รายการแชทโหลดใหม่
  /** ในห้องกลุ่ม/ชาเนล: ลิงก์ของกลุ่ม + ซ่อน/แสดงแถบลิงก์ด่วน (2026-11-18) */
  links?: { count: number; hasPinned: boolean; barHidden: boolean; onToggleBar: () => void };
}) {
  const [loaded, setLoaded] = useState<RoomMember[] | null>(null);
  const members = given ?? loaded ?? [];
  const notify = useNotify();
  const nav = useNavigate();
  const { me } = useMe();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const isOwner = room.myRole === 'owner';
  const heirs = members.filter((m) => m.id !== me.user.id && !m.isBot);

  async function clear() {
    if (!confirm(CLEAR_CONFIRM)) return;
    setBusy(true);
    try {
      await api.post(`/api/rooms/${encodeURIComponent(room.id)}/clear`);
      notify('success', 'ลบแชทแล้ว');
      onChanged?.();
      nav('/', { replace: true });
    } catch (e) {
      notify('error', `ลบแชทไม่สำเร็จ: ${errMsg(e)}`);
      setBusy(false);
    }
  }

  async function leave(transferTo?: string) {
    const heir = transferTo ? heirs.find((h) => h.id === transferTo)?.displayName : null;
    if (!confirm(heir ? `โอนเจ้าของกลุ่มให้ ${heir} แล้วออกจากกลุ่ม?` : `ออกจากกลุ่ม "${room.title}"? ต้องให้คนในกลุ่มเพิ่มกลับหรือใช้ลิงก์เชิญถึงจะเข้าได้อีก`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ warning: string | null }>(`/api/rooms/${encodeURIComponent(room.id)}/leave`, transferTo ? { transferTo } : {});
      notify('success', 'ออกจากกลุ่มแล้ว');
      onChanged?.();
      if (r.warning) notify('warning', r.warning);
      nav('/', { replace: true });
    } catch (e) {
      notify('error', `ออกจากกลุ่มไม่สำเร็จ: ${errMsg(e)}`);
      setBusy(false);
    }
  }

  /** ออกจากกลุ่ม: เจ้าของที่มีคนรับต่อได้ → เลือกคนก่อน (เปิดจากรายการแชท = โหลดรายชื่อสมาชิกตอนนี้) */
  async function startLeave() {
    if (!isOwner) { void leave(); return; }
    let list = members;
    if (!given && !loaded) {
      setBusy(true);
      try {
        list = (await api.get<{ members: RoomMember[] }>(`/api/rooms/${encodeURIComponent(room.id)}`)).members;
        setLoaded(list);
      } catch (e) {
        notify('error', `โหลดรายชื่อสมาชิกไม่สำเร็จ จึงยังออกจากกลุ่มไม่ได้: ${errMsg(e)}`);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (list.some((m) => m.id !== me.user.id && !m.isBot)) setPicking(true); else void leave();
  }

  async function markRead() {
    if (!fromList) return;
    setBusy(true);
    try {
      await fromList.onMarkRead();
      onClose();
    } catch (e) {
      notify('error', `ทำเป็นอ่านแล้วไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b className="ellipsis">{room.title}</b><button className="link" onClick={onClose}>ปิด</button></div>
        {!picking ? (
          <ul className="menu-list">
            {fromList ? (
              <>
                <li><button disabled={busy} onClick={() => { onClose(); fromList.onMute(); }}>{room.muted ? '🔔 เปิดเสียง / ตั้งเวลาปิดเสียง' : '🔕 ปิดเสียง'}</button></li>
                <li>
                  <button disabled={busy || room.unread === 0} onClick={() => void markRead()}>
                    ✓ อ่านแล้วทั้งหมด{room.unread === 0 ? ' (ไม่มีข้อความค้าง)' : ` (${room.unread > 99 ? '99+' : room.unread})`}
                  </button>
                </li>
              </>
            ) : (
              <>
                <li><Link to={`/room/${encodeURIComponent(room.id)}/notes`}>📝 โน้ตของห้องนี้</Link></li>
                {links && <li><Link to={`/room/${encodeURIComponent(room.id)}/links`}>🔗 ลิงก์ของ{room.type === 'channel' ? 'ชาเนล' : 'กลุ่ม'}{links.count ? ` (${links.count})` : ''}</Link></li>}
                {links?.hasPinned && (
                  <li><button onClick={() => { links.onToggleBar(); onClose(); }}>{links.barHidden ? '👁 แสดงแถบลิงก์ด่วน' : '🙈 ซ่อนแถบลิงก์ด่วน (เฉพาะเครื่องนี้)'}</button></li>
                )}
              </>
            )}
            <li><button disabled={busy} onClick={() => void clear()}>🧹 ลบแชท (เฉพาะฝั่งฉัน)</button></li>
            {room.type === 'group' && (
              <li>
                <button className="danger-text" disabled={busy}
                  onClick={() => void startLeave()}>
                  🚪 ออกจากกลุ่ม
                </button>
              </li>
            )}
          </ul>
        ) : (
          <>
            <p className="small">คุณเป็นเจ้าของกลุ่ม — เลือกคนรับเป็นเจ้าของต่อก่อนออก</p>
            <ul className="user-list">
              {heirs.map((h) => (
                <li key={h.id} className="user-item">
                  <Avatar name={h.displayName} url={h.pictureUrl} size={32} />
                  <span className="grow">{h.displayName}{h.role === 'admin' ? <span className="small muted"> · แอดมิน</span> : null}</span>
                  <button className="btn btn-small" disabled={busy} onClick={() => void leave(h.id)}>โอนแล้วออก</button>
                </li>
              ))}
            </ul>
            <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setPicking(false)}>ยกเลิก</button>
          </>
        )}
      </div>
    </div>
  );
}

