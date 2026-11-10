// =====================================================================
// ChatRoomPage.tsx — ห้องแชท: ข้อความเรียลไทม์ + สถานะส่ง/ส่งไม่สำเร็จ + สถานะการเชื่อมต่อ
// กลุ่ม: แตะหัวห้องเพื่อดู/เพิ่มสมาชิก
// เฟส 2: ส่งรูป (ย่อก่อนส่ง) / ส่งเป็นไฟล์ (ชัดเต็ม) / ไฟล์ / ข้อความเสียง
// เฟส 3: ชาเนล (โพสต์ได้เฉพาะเจ้าของ/แอดมินชาเนล) · ปุ่ม 🔔/🔕 ปิดแจ้งเตือนรายห้อง
// =====================================================================

import { FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { thaiClock, thaiDate } from '../../shared/time';
import { MAX_MESSAGE_CHARS } from '../../shared/protocol';
import { FormInfo, Room, RoomMember, User, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import { useNotify } from '../notice';
import { OutgoingFile, useRoomSocket } from '../useRoomSocket';
import MessageContent from '../MessageContent';
import VoiceRecorder from '../VoiceRecorder';
import { formatSize, prepareImage } from '../media';

export default function ChatRoomPage() {
  const { id = '' } = useParams();
  const { me } = useMe();
  const notify = useNotify();
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [roomError, setRoomError] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState('');
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  const onNotice = useCallback((kind: 'error' | 'warning', t: string) => notify(kind, t), [notify]);
  const s = useRoomSocket(id, onNotice);

  const loadRoom = useCallback(async () => {
    try {
      const d = await api.get<{ room: Room; members: RoomMember[] }>(`/api/rooms/${encodeURIComponent(id)}`);
      setRoom(d.room);
      setMembers(d.members);
    } catch (e) {
      setRoomError(errMsg(e));
    }
  }, [id]);
  useEffect(() => { void loadRoom(); }, [loadRoom]);

  // ---------- เลื่อนลงล่างสุดเมื่อมีข้อความใหม่ (ถ้าผู้ใช้อยู่ล่างสุดอยู่แล้ว) ----------
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [s.messages, s.pending]);

  // ---------- บอกห้องว่าอ่านแล้ว (เฉพาะตอนหน้าจอเปิดอยู่) ----------
  const lastSeq = s.messages.length ? s.messages[s.messages.length - 1].seq : 0;
  useEffect(() => {
    if (s.conn === 'open' && document.visibilityState === 'visible') s.markRead(lastSeq);
  }, [lastSeq, s.conn, s.markRead]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && s.hasMore && !s.loadingOlder) {
      const before = el.scrollHeight;
      void s.loadOlder().then(() => {
        requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight - before; });
      });
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const err = s.send(text);
    if (err) { setInputError(err); return; }
    setText('');
    setInputError('');
    stickBottom.current = true;
  }

  function queueFile(f: OutgoingFile) {
    const err = s.sendFile(f, text);
    if (err) { notify('error', `${f.name}: ${err}`); return; }
    setText(''); // ข้อความในช่องพิมพ์กลายเป็นคำบรรยายใต้ไฟล์
    stickBottom.current = true;
  }

  // ---------- รูป: ย่อก่อนส่ง ----------
  async function onPickImages(files: FileList | null) {
    if (!files?.length) return;
    setPreparing(true);
    for (const file of Array.from(files)) {
      try {
        const img = await prepareImage(file);
        queueFile({ kind: 'image', blob: img.blob, name: img.name, mime: img.mime, width: img.width, height: img.height });
      } catch (e) {
        notify('error', `${file.name}: ${e instanceof Error ? e.message : 'เตรียมรูปไม่สำเร็จ'}`);
      }
    }
    setPreparing(false);
    if (imageInput.current) imageInput.current.value = '';
  }

  // ---------- ส่งเป็นไฟล์ (ไม่ย่อ — ใช้กับรูปที่ต้องการชัดเต็ม และไฟล์ทุกชนิด) ----------
  function onPickFiles(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      queueFile({ kind: 'file', blob: file, name: file.name, mime: file.type || 'application/octet-stream' });
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  // ---------- เฟส 4: แอดมินส่งการ์ดฟอร์ม ----------
  const [formPicker, setFormPicker] = useState<FormInfo[] | null>(null);
  async function openFormPicker() {
    try {
      const d = await api.get<{ forms: FormInfo[] }>('/api/admin/forms');
      const active = d.forms.filter((f) => f.active);
      if (active.length === 0) { notify('warning', 'ยังไม่มีฟอร์มที่เปิดใช้ — สร้างได้ที่ แอดมิน → ฟอร์ม'); return; }
      setFormPicker(active);
    } catch (e) {
      notify('error', `โหลดรายการฟอร์มไม่สำเร็จ: ${errMsg(e)}`);
    }
  }
  function pickForm(f: FormInfo) {
    s.sendForm(f.id, f.title, text);
    setText('');
    setFormPicker(null);
    stickBottom.current = true;
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = ส่ง · Shift+Enter = ขึ้นบรรทัดใหม่ (บนคอมพิวเตอร์)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  }

  if (roomError) {
    return (
      <div className="page">
        <TopBar title="ห้องแชท" back="/" />
        <div className="banner banner-error" role="alert">{roomError}</div>
      </div>
    );
  }

  const isGroup = room?.type === 'group';
  const isChannel = room?.type === 'channel';
  const hasMembers = isGroup || isChannel;

  async function toggleMute() {
    if (!room) return;
    try {
      await api.post(`/api/rooms/${encodeURIComponent(room.id)}/mute`, { muted: !room.muted });
      setRoom({ ...room, muted: !room.muted });
      notify('success', room.muted ? 'เปิดแจ้งเตือนห้องนี้แล้ว' : 'ปิดแจ้งเตือนห้องนี้แล้ว');
    } catch (e) {
      notify('error', `ตั้งค่าแจ้งเตือนไม่สำเร็จ: ${errMsg(e)}`);
    }
  }
  const connText =
    s.conn === 'connecting' ? 'กำลังเชื่อมต่อ…'
    : s.conn === 'reconnecting' ? (s.connError ?? 'หลุดการเชื่อมต่อ กำลังต่อใหม่…')
    : s.conn === 'failed' ? `เชื่อมต่อห้องไม่ได้: ${s.connError ?? ''}`
    : null;

  let lastDate = '';
  return (
    <div className="page chat-page">
      <TopBar
        back="/"
        title={
          <button className="topbar-room" onClick={() => hasMembers && setShowMembers(true)} disabled={!hasMembers}>
            <span>{isChannel ? '📢 ' : ''}{room?.title ?? '…'}</span>
            {isGroup && <span className="small muted">{members.length} คน · แตะเพื่อดูสมาชิก</span>}
            {isChannel && <span className="small muted">ชาเนล · {members.length} ผู้ติดตาม · แตะเพื่อดูรายละเอียด</span>}
          </button>
        }
        right={room && (
          <button className="btn btn-small btn-ghost" onClick={() => void toggleMute()} aria-label={room.muted ? 'เปิดแจ้งเตือนห้องนี้' : 'ปิดแจ้งเตือนห้องนี้'}>
            {room.muted ? '🔕' : '🔔'}
          </button>
        )}
      />
      {connText && <div className={`banner ${s.conn === 'failed' ? 'banner-error' : 'banner-warning'}`} role="status">{connText}</div>}

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {s.loadingOlder && <p className="center muted small">กำลังโหลดข้อความเก่า…</p>}
        {s.messages.map((m) => {
          const d = thaiDate(m.createdAt);
          const showDate = d !== lastDate;
          lastDate = d;
          const mine = m.senderId === me.user.id;
          return (
            <div key={m.seq}>
              {showDate && <div className="date-sep">{d}</div>}
              <div className={`bubble-row ${mine ? 'mine' : ''}`}>
                <div className="bubble">
                  {!mine && isGroup && <div className="bubble-name">{m.senderName}</div>}
                  <MessageContent m={m} roomId={id} />
                  <div className="bubble-meta">{thaiClock(m.createdAt)}</div>
                </div>
              </div>
            </div>
          );
        })}
        {s.pending.map((p) => (
          <div key={p.clientId} className="bubble-row mine">
            <div className={`bubble ${p.status === 'failed' ? 'bubble-failed' : 'bubble-sending'}`}>
              {p.previewUrl && <img className="msg-image" src={p.previewUrl} alt="" />}
              {p.kind === 'form' && <div className="small">📝 การ์ดฟอร์ม: {p.extra?.formTitle}</div>}
              {p.file && p.kind !== 'image' && (
                <div className="small">{p.kind === 'voice' ? '🎤 ข้อความเสียง' : `📄 ${p.file.name}`} · {formatSize(p.file.blob.size)}</div>
              )}
              {p.body && <div className="bubble-body">{p.body}</div>}
              {p.status === 'uploading' ? (
                <div className="bubble-meta">
                  กำลังอัปโหลด {p.progress ?? 0}%
                  <div className="progress"><div style={{ width: `${p.progress ?? 0}%` }} /></div>
                </div>
              ) : p.status === 'sending' ? (
                <div className="bubble-meta">กำลังส่ง…</div>
              ) : (
                <div className="bubble-fail">
                  <div>ส่งไม่สำเร็จ: {p.reason}</div>
                  <button className="link" onClick={() => s.retry(p.clientId)}>ส่งใหม่</button>
                  <button className="link" onClick={() => s.discard(p.clientId)}>ลบ</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {room && !room.canPost ? (
        <div className="readonly-note">📢 ชาเนลนี้โพสต์ได้เฉพาะเจ้าของและแอดมินชาเนล</div>
      ) : (
      <form className="composer" onSubmit={submit}>
        {inputError && <p className="error-text small">{inputError}</p>}
        {preparing && <p className="small muted">กำลังย่อรูป…</p>}
        {recording ? (
          <VoiceRecorder
            onDone={(f) => { setRecording(false); queueFile(f); }}
            onCancel={() => setRecording(false)}
            onError={(msg) => { setRecording(false); notify('error', msg); }}
          />
        ) : (
        <>
        <div className="composer-tools">
          <button type="button" className="tool" onClick={() => imageInput.current?.click()} disabled={s.conn === 'failed'}>🖼 รูป</button>
          <button type="button" className="tool" onClick={() => fileInput.current?.click()} disabled={s.conn === 'failed'}>📎 ส่งเป็นไฟล์</button>
          <button type="button" className="tool" onClick={() => setRecording(true)} disabled={s.conn === 'failed'}>🎤 เสียง</button>
          {me.user.role === 'admin' && (
            <button type="button" className="tool" onClick={() => void openFormPicker()} disabled={s.conn === 'failed'}>📝 ฟอร์ม</button>
          )}
          <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => void onPickImages(e.target.files)} />
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => onPickFiles(e.target.files)} />
        </div>
        <div className="composer-row">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); if (inputError) setInputError(''); }}
            onKeyDown={onKey}
            rows={1}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="พิมพ์ข้อความ"
          />
          <button className="btn" disabled={s.conn === 'failed'}>ส่ง</button>
        </div>
        </>
        )}
      </form>
      )}

      {formPicker && (
        <div className="sheet-backdrop" onClick={() => setFormPicker(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><b>เลือกฟอร์มที่จะส่ง</b><button className="link" onClick={() => setFormPicker(null)}>ปิด</button></div>
            <p className="small muted">ข้อความในช่องพิมพ์ (ถ้ามี) จะแสดงเหนือการ์ด</p>
            {formPicker.map((f) => (
              <button key={f.id} className="btn btn-ghost btn-block" onClick={() => pickForm(f)}>📝 {f.title}</button>
            ))}
          </div>
        </div>
      )}

      {showMembers && room && (
        <MembersPanel
          room={room}
          members={members}
          onClose={() => setShowMembers(false)}
          onChanged={() => void loadRoom()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// สมาชิกกลุ่ม + เพิ่มสมาชิก (เจ้าของ/แอดมินกลุ่มเท่านั้น)
// ---------------------------------------------------------------------
function MembersPanel({ room, members, onClose, onChanged }: {
  room: Room; members: RoomMember[]; onClose: () => void; onChanged: () => void;
}) {
  const notify = useNotify();
  const canAdd = room.myRole === 'owner' || room.myRole === 'admin';
  const isOwner = room.myRole === 'owner';
  const nav = useNavigate();

  async function setRole(m: RoomMember, role: 'admin' | 'member') {
    try {
      await api.post(`/api/rooms/${encodeURIComponent(room.id)}/members/${encodeURIComponent(m.id)}/role`, { role });
      notify('success', role === 'admin' ? `ตั้ง ${m.displayName} เป็นแอดมินแล้ว` : `ถอด ${m.displayName} จากแอดมินแล้ว`);
      onChanged();
    } catch (e) {
      notify('error', errMsg(e));
    }
  }

  async function leave() {
    try {
      await api.post(`/api/rooms/${encodeURIComponent(room.id)}/leave`);
      notify('success', `เลิกติดตาม ${room.title} แล้ว`);
      nav('/', { replace: true });
    } catch (e) {
      notify('error', errMsg(e));
    }
  }
  const [adding, setAdding] = useState(false);
  const [users, setUsers] = useState<User[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function openAdd() {
    setAdding(true);
    try {
      const d = await api.get<{ users: User[] }>('/api/users');
      const inRoom = new Set(members.map((m) => m.id));
      setUsers(d.users.filter((u) => !inRoom.has(u.id)));
    } catch (e) {
      setError(`โหลดรายชื่อไม่สำเร็จ: ${errMsg(e)}`);
    }
  }

  async function save() {
    if (picked.size === 0) { setError('เลือกคนที่จะเพิ่มก่อน'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/rooms/${encodeURIComponent(room.id)}/members`, { userIds: [...picked] });
      notify('success', `เพิ่มสมาชิก ${picked.size} คนแล้ว`);
      setAdding(false);
      setPicked(new Set());
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>{room.title}</b>
          <button className="link" onClick={onClose}>ปิด</button>
        </div>
        {!adding ? (
          <>
            {room.description && <p className="small">{room.description}</p>}
            <ul className="user-list">
              {members.map((m) => (
                <li key={m.id} className="user-item">
                  <Avatar name={m.displayName} url={m.pictureUrl} size={32} />
                  <span>{m.displayName}</span>
                  {m.role !== 'member' && <span className="small muted">{m.role === 'owner' ? 'เจ้าของ' : 'แอดมิน'}</span>}
                  {isOwner && m.role !== 'owner' && (
                    <button className="btn btn-small btn-ghost push-right" onClick={() => void setRole(m, m.role === 'admin' ? 'member' : 'admin')}>
                      {m.role === 'admin' ? 'ถอดแอดมิน' : 'ตั้งเป็นแอดมิน'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canAdd && <button className="btn btn-block" onClick={() => void openAdd()}>+ เพิ่มสมาชิก</button>}
            {room.type === 'channel' && !isOwner && (
              <button className="btn btn-ghost btn-block" onClick={() => void leave()}>เลิกติดตามชาเนลนี้</button>
            )}
          </>
        ) : (
          <>
            {users === null && !error && <p className="muted">กำลังโหลด…</p>}
            {users?.length === 0 && <p className="muted">ทุกคนอยู่ในกลุ่มแล้ว</p>}
            <ul className="user-list">
              {users?.map((u) => (
                <li key={u.id}>
                  <label className="user-item">
                    <input
                      type="checkbox"
                      checked={picked.has(u.id)}
                      onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; })}
                    />
                    <Avatar name={u.displayName} url={u.pictureUrl} size={32} />
                    <span>{u.displayName}</span>
                  </label>
                </li>
              ))}
            </ul>
            {error && <p className="error-text">{error}</p>}
            <button className="btn btn-block" disabled={busy} onClick={() => void save()}>
              {busy ? 'กำลังเพิ่ม…' : `เพิ่ม ${picked.size} คน`}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setAdding(false)}>ยกเลิก</button>
          </>
        )}
      </div>
    </div>
  );
}
