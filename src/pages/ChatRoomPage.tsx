// =====================================================================
// ChatRoomPage.tsx — ห้องแชท: ข้อความเรียลไทม์ + สถานะส่ง/ส่งไม่สำเร็จ + สถานะการเชื่อมต่อ
// กลุ่ม: แตะหัวห้องเพื่อดู/เพิ่มสมาชิก
// เฟส 2: ส่งรูป (ย่อก่อนส่ง) / ส่งเป็นไฟล์ (ชัดเต็ม) / ไฟล์ / ข้อความเสียง
// เฟส 3: ชาเนล (โพสต์ได้เฉพาะเจ้าของ/แอดมินชาเนล) · ปุ่ม 🔔/🔕 ปิดแจ้งเตือนรายห้อง
// แจ้งเตือน: ปิดเสียงตามเวลา · ปักหมุด · ตอบกลับ · @ชื่อ · ส่งแบบเงียบ
// เฟส 5: สติกเกอร์ (แผงเลือกในช่องพิมพ์) · ปุ่ม 📝 โน้ตของห้อง
// =====================================================================

import { FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { thaiClock, thaiDate } from '../../shared/time';
import { MAX_MESSAGE_CHARS } from '../../shared/protocol';
import StickerPicker from '../StickerPicker';
import { ChatMessage, FormInfo, Room, RoomMember, User, api, errMsg, stickerUrl } from '../api';
import type { MessageExtra, ReplyRef } from '../../shared/protocol';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import { useNotify } from '../notice';
import { OutgoingFile, useRoomSocket } from '../useRoomSocket';
import MessageContent from '../MessageContent';
import VoiceRecorder from '../VoiceRecorder';
import InvitePanel from '../InvitePanel';
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
  // ---------- แจ้งเตือน: สถานะของช่องพิมพ์ ----------
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [silent, setSilent] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [showMute, setShowMute] = useState(false);
  const [showStickers, setShowStickers] = useState(false);

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
  const s = useRoomSocket(id, onNotice, () => void loadRoom());

  // เปิดห้องนี้ → ล้างแจ้งเตือนของห้องนี้ที่ค้างในถาดแจ้งเตือน (service worker)
  useEffect(() => {
    void navigator.serviceWorker?.ready
      .then((r) => r.active?.postMessage({ type: 'room-opened', tag: `room-${id}` }))
      .catch(() => undefined);
  }, [id]);

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

  /** silent / replyTo ที่ผู้ใช้เลือกไว้ → แนบไปกับข้อความที่ส่ง แล้วล้างการตอบกลับ */
  function outExtra(): MessageExtra | undefined {
    if (!silent && !replyTo) return undefined;
    return { ...(silent ? { silent: true } : {}), ...(replyTo ? { replyTo: { seq: replyTo.seq } } : {}) };
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const err = s.send(text, outExtra());
    if (err) { setInputError(err); return; }
    setText('');
    setInputError('');
    setReplyTo(null);
    stickBottom.current = true;
  }

  function queueFile(f: OutgoingFile) {
    const err = s.sendFile(f, text, outExtra());
    if (err) { notify('error', `${f.name}: ${err}`); return; }
    setText(''); // ข้อความในช่องพิมพ์กลายเป็นคำบรรยายใต้ไฟล์
    setReplyTo(null);
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
    s.sendForm(f.id, f.title, text, outExtra());
    setText('');
    setReplyTo(null);
    setFormPicker(null);
    stickBottom.current = true;
  }

  // ---------- @ชื่อ: พิมพ์ @ แล้วเลือกคนในห้อง ----------
  const mentionQuery = /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1];
  const mentionList = mentionQuery === undefined
    ? []
    : members.filter((m) => m.id !== me.user.id && m.displayName.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);
  function pickMention(m: RoomMember) {
    setText((t) => t.replace(/@([^\s@]*)$/, `@${m.displayName} `));
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

  // ---------- ปักหมุด: แชท 1:1 ทั้งสองคน · กลุ่ม/ชาเนล เฉพาะเจ้าของ/แอดมินห้อง ----------
  const canPin = !!room && (room.type === 'dm' || room.myRole === 'owner' || room.myRole === 'admin');
  async function pin(seq: number | null, notifyAll = false) {
    if (!room) return;
    try {
      await api.post(`/api/rooms/${encodeURIComponent(room.id)}/pin`, { seq, notify: notifyAll });
      notify('success', seq === null ? 'เลิกปักหมุดแล้ว' : notifyAll ? 'ปักหมุดและแจ้งทุกคนแล้ว' : 'ปักหมุดแล้ว');
      void loadRoom();
    } catch (e) {
      notify('error', `${seq === null ? 'เลิกปักหมุด' : 'ปักหมุด'}ไม่สำเร็จ: ${errMsg(e)}`);
    }
  }
  function jumpTo(seq: number) {
    const el = document.getElementById(`msg-${seq}`);
    if (!el) { notify('warning', 'ข้อความนี้อยู่ไกลเกินไป — เลื่อนขึ้นเพื่อโหลดข้อความเก่าก่อน'); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
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
          <>
            <Link to={`/room/${encodeURIComponent(id)}/notes`} className="btn btn-small btn-ghost" aria-label="โน้ตของห้องนี้">📝</Link>
            <button className="btn btn-small btn-ghost" onClick={() => setShowMute(true)} aria-label="ตั้งค่าแจ้งเตือนห้องนี้">
              {room.muted ? '🔕' : '🔔'}
            </button>
          </>
        )}
      />
      {connText && <div className={`banner ${s.conn === 'failed' ? 'banner-error' : 'banner-warning'}`} role="status">{connText}</div>}
      {room?.pinned && (
        <div className="pinned-bar">
          <button className="pinned-main" onClick={() => jumpTo(room.pinned!.seq)}>
            <span className="small muted">📌 ข้อความที่ปักหมุด{room.pinned.sender ? ` · ${room.pinned.sender}` : ''}</span>
            <span className="pinned-text">{room.pinned.text}</span>
          </button>
          {canPin && <button className="link" onClick={() => void pin(null)} aria-label="เลิกปักหมุด">✕</button>}
        </div>
      )}

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
              <div className={`bubble-row ${mine ? 'mine' : ''}`} id={`msg-${m.seq}`}>
                <div className={`bubble ${m.kind === 'sticker' ? 'bubble-sticker' : ''}`}>
                  {!mine && isGroup && <div className="bubble-name">{m.senderName}</div>}
                  {m.extra?.replyTo && (
                    <button className="reply-quote" onClick={() => jumpTo(m.extra!.replyTo!.seq)}>
                      <b>{m.extra.replyTo.senderName ?? 'ข้อความ'}</b>
                      <span>{m.extra.replyTo.snippet ?? ''}</span>
                    </button>
                  )}
                  <MessageContent m={m} roomId={id} />
                  <div className="bubble-meta">
                    {m.extra?.silent && <span title="ส่งแบบเงียบ">🔕 </span>}
                    {thaiClock(m.createdAt)}
                    <button className="bubble-more" onClick={() => setMenuFor(m)} aria-label="ตัวเลือกข้อความ">⋯</button>
                  </div>
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
              {p.kind === 'sticker' && p.extra?.stickerId && <img className="sticker-img" src={stickerUrl(p.extra.stickerId)} alt="สติกเกอร์" />}
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
        {replyTo && (
          <div className="reply-draft">
            <div className="grow"><b>ตอบกลับ {replyTo.senderName}</b><div className="small muted ellipsis">{replyTo.snippet}</div></div>
            <button type="button" className="link" onClick={() => setReplyTo(null)} aria-label="ยกเลิกตอบกลับ">✕</button>
          </div>
        )}
        {mentionList.length > 0 && (
          <ul className="mention-list">
            {mentionList.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => pickMention(m)}>
                  <Avatar name={m.displayName} url={m.pictureUrl} size={24} /> {m.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
        {showStickers && !recording && (
          <StickerPicker onPick={(stickerId) => {
            s.sendSticker(stickerId, outExtra());
            setReplyTo(null);
            setShowStickers(false);
            stickBottom.current = true;
          }} />
        )}
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
          <button type="button" className={`tool ${showStickers ? 'tool-on' : ''}`} onClick={() => setShowStickers((v) => !v)} disabled={s.conn === 'failed'} aria-pressed={showStickers}>😺 สติกเกอร์</button>
          {me.user.role === 'admin' && (
            <button type="button" className="tool" onClick={() => void openFormPicker()} disabled={s.conn === 'failed'}>📝 ฟอร์ม</button>
          )}
          <button
            type="button"
            className={`tool ${silent ? 'tool-on' : ''}`}
            onClick={() => setSilent((v) => !v)}
            aria-pressed={silent}
            title="ส่งแบบเงียบ: คนรับเห็นข้อความแต่มือถือไม่เด้ง"
          >
            {silent ? '🔕 เงียบอยู่' : '🔕 ส่งเงียบ'}
          </button>
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
            placeholder={silent ? 'พิมพ์ข้อความ (ส่งแบบเงียบ)' : hasMembers ? 'พิมพ์ข้อความ · @ เพื่อเรียกชื่อ' : 'พิมพ์ข้อความ'}
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

      {menuFor && (
        <MessageMenu
          m={menuFor}
          canReply={!!room?.canPost}
          canPin={canPin}
          isPinned={room?.pinned?.seq === menuFor.seq}
          onClose={() => setMenuFor(null)}
          onReply={() => {
            setReplyTo({ seq: menuFor.seq, senderName: menuFor.senderName, snippet: previewText(menuFor) });
            setMenuFor(null);
          }}
          onPin={(notifyAll) => { void pin(menuFor.seq, notifyAll); setMenuFor(null); }}
          onUnpin={() => { void pin(null); setMenuFor(null); }}
          onCopy={async () => {
            setMenuFor(null);
            try { await navigator.clipboard.writeText(menuFor.body); notify('success', 'คัดลอกข้อความแล้ว'); }
            catch { notify('error', 'คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด'); }
          }}
        />
      )}

      {showMute && room && (
        <MuteSheet room={room} onClose={() => setShowMute(false)} onSaved={(muted, mutedUntil) => setRoom({ ...room, muted, mutedUntil })} />
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
// แจ้งเตือน: ข้อความย่อ / เมนูข้อความ / ปิดเสียงตามเวลา
// ---------------------------------------------------------------------
function previewText(m: ChatMessage): string {
  if (m.body) return m.body.slice(0, 80);
  if (m.kind === 'image') return '[รูป]';
  if (m.kind === 'voice') return '[ข้อความเสียง]';
  if (m.kind === 'file') return `[ไฟล์] ${m.file?.name ?? ''}`;
  if (m.kind === 'form') return `[ฟอร์ม] ${m.extra?.formTitle ?? ''}`;
  if (m.kind === 'sticker') return '[สติกเกอร์]';
  return '';
}

function MessageMenu({ m, canReply, canPin, isPinned, onClose, onReply, onPin, onUnpin, onCopy }: {
  m: ChatMessage; canReply: boolean; canPin: boolean; isPinned: boolean; onClose: () => void;
  onReply: () => void; onPin: (notifyAll: boolean) => void; onUnpin: () => void; onCopy: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b className="ellipsis">{m.senderName}: {previewText(m)}</b><button className="link" onClick={onClose}>ปิด</button></div>
        {canReply && <button className="btn btn-ghost btn-block" onClick={onReply}>↩️ ตอบกลับ</button>}
        {m.body && <button className="btn btn-ghost btn-block" onClick={onCopy}>📋 คัดลอกข้อความ</button>}
        {canPin && !isPinned && (
          <>
            <button className="btn btn-ghost btn-block" onClick={() => onPin(false)}>📌 ปักหมุด (ไม่แจ้งใคร)</button>
            <button className="btn btn-ghost btn-block" onClick={() => onPin(true)}>📌 ปักหมุด + แจ้งทุกคนในห้อง</button>
          </>
        )}
        {canPin && isPinned && <button className="btn btn-ghost btn-block" onClick={onUnpin}>เลิกปักหมุด</button>}
      </div>
    </div>
  );
}

const MUTE_OPTIONS: { key: '1h' | '8h' | '2d' | 'forever'; label: string }[] = [
  { key: '1h', label: '1 ชั่วโมง' }, { key: '8h', label: '8 ชั่วโมง' }, { key: '2d', label: '2 วัน' }, { key: 'forever', label: 'ตลอดไป' },
];

function MuteSheet({ room, onClose, onSaved }: {
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
      // เฟส 5: กลุ่มเพิ่มได้เฉพาะเพื่อน (+ แอดมินระบบ/บอท) · ชาเนลเหมือนเดิม — เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น
      setUsers(d.users.filter((u) => !inRoom.has(u.id) && (room.type !== 'group' || u.canChat)));
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
            {canAdd && room.type !== 'dm' && <InvitePanel roomId={room.id} roomTitle={room.title} />}
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
