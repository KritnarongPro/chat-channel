// =====================================================================
// ChatRoomPage.tsx — ห้องแชท: ข้อความเรียลไทม์ + สถานะส่ง/ส่งไม่สำเร็จ + สถานะการเชื่อมต่อ
// กลุ่ม: แตะหัวห้องเพื่อดู/เพิ่มสมาชิก
// เฟส 2: ส่งรูป (ย่อก่อนส่ง) / ส่งเป็นไฟล์ (ชัดเต็ม) / ไฟล์ / ข้อความเสียง
// เฟส 3: ชาเนล (โพสต์ได้เฉพาะเจ้าของ/แอดมินชาเนล) · ปุ่ม 🔔/🔕 ปิดแจ้งเตือนรายห้อง
// แจ้งเตือน: ปิดเสียงตามเวลา · ปักหมุด · ตอบกลับ · @ชื่อ · ส่งแบบเงียบ
// เฟส 5: สติกเกอร์ (แผงเลือกในช่องพิมพ์) · ปุ่ม 📝 โน้ตของห้อง
// ลบแชท: ยกเลิกส่ง (24 ชม.) / แอดมินลบ ในเมนู ⋯ ของข้อความ · ปุ่ม ⋯ บนหัวห้อง: ลบแชทฝั่งฉัน / ออกจากกลุ่ม
// ฟีเจอร์แชท (2026-11-17): อ่านแล้ว (แบบ LINE) · รีแอคชัน 6 แบบ · คัดลอก · ส่งต่อ (ขึ้นชื่อต้นฉบับ) · 🔍 ค้นหาในห้อง
//   กดค้าง/คลิกขวาที่ข้อความ = เปิดเมนูข้อความ
// ชุด 2 (2026-11-17): วิดีโอ (50MB) · อัลบั้ม (เลือกหลายรูป/วิดีโอ = ตารางในบับเบิลเดียว) · 📊 โพล · ปักหมุด/ประกาศ 5 อัน
//   · "กำลังพิมพ์…" · ลิงก์ในข้อความ + ตัวอย่างลิงก์ (ใน MessageContent)
// เมนูกดค้างแบบ LINE (2026-11-17): กล่องตารางไอคอนติดข้อความ + แถบอีโมจิ · เพิ่ม คัดลอกบางส่วน / Keep (โน้ตส่วนตัว)
//   / โน้ตในห้อง / ลบเฉพาะฝั่งฉัน (DO v8)
// =====================================================================

import { FormEvent, KeyboardEvent, ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { nowThai, thaiAfter, thaiClock, thaiDate, thaiShort } from '../../shared/time';
import { ALBUM_MAX, MAX_MESSAGE_CHARS, POLL_MAX_OPTIONS, POLL_OPTION_MAX, POLL_QUESTION_MAX, REACTIONS } from '../../shared/protocol';
import StickerPicker from '../StickerPicker';
import { ChatMessage, FormInfo, Room, RoomMember, RoomPin, User, api, errMsg, stickerUrl } from '../api';
import type { MessageExtra, ReactionGroup, ReadState, ReplyRef } from '../../shared/protocol';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import { useNotify } from '../notice';
import { OutgoingFile, useRoomSocket } from '../useRoomSocket';
import MessageContent from '../MessageContent';
import Loading from '../Loading';
import { lockChatViewport } from '../viewport';
import { useSwipeReply } from '../gestures';
import PictureCropper from '../PictureCropper';
import { MuteSheet, RoomMenu } from '../RoomActions';  // 2026-11-18: ใช้ร่วมกับหน้ารายการแชท
import VoiceRecorder from '../VoiceRecorder';
import InvitePanel from '../InvitePanel';
import { formatDuration, formatSize, prepareImage, prepareVideo } from '../media';

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
  const [menu, setMenu] = useState<{ m: ChatMessage; rect: DOMRect } | null>(null);
  /** เปิดเมนูกดค้างติดกับข้อความ (el = บับเบิล/รูปที่กด) */
  const openMenu = (m: ChatMessage, el: Element) => setMenu({ m, rect: el.getBoundingClientRect() });
  const [copyPart, setCopyPart] = useState<ChatMessage | null>(null);
  const nav = useNavigate();
  const [showMute, setShowMute] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [showRoomMenu, setShowRoomMenu] = useState(false);
  // ---------- ฟีเจอร์แชท ----------
  const [showSearch, setShowSearch] = useState(false);
  const [forwardFor, setForwardFor] = useState<ChatMessage | null>(null);
  const [readersFor, setReadersFor] = useState<ReadState[] | null>(null);
  const [reactionsFor, setReactionsFor] = useState<ChatMessage | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  // ---------- ชุด 2 ----------
  // iPad/iPhone: ล็อกความสูงหน้าแชทเท่าส่วนที่มองเห็น กันช่องพิมพ์ลอยไปบนสุด (viewport.ts)
  useEffect(() => lockChatViewport(), []);
  const [showPoll, setShowPoll] = useState(false);
  const [showPins, setShowPins] = useState(false);
  // ---------- มือถือ/iPad (2026-11-18): ตารางเครื่องมือ ＋ · ปัดข้อความไปขวาเพื่อตอบกลับ ----------
  const [showTools, setShowTools] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const swipe = useSwipeReply<ChatMessage>((m) => {
    setReplyTo({ seq: m.seq, senderName: m.senderName, snippet: previewText(m) });
    textRef.current?.focus();
  }, () => clearTimeout(pressTimer.current));  // นิ้วขยับ = ไม่ใช่กดค้าง → ยกเลิกเปิดเมนู

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
  // iPad 2 ช่อง: มีข้อความใหม่ในห้องนี้ (รวมที่เราส่งเอง) → บอกรายการแชทช่องซ้ายให้โหลดใหม่ (ข้อความล่าสุด/ยังไม่อ่าน)
  //   รอ 0.8 วิ ให้ "อ่านแล้ว" ถึงห้องก่อน ไม่งั้นตัวเลขยังไม่อ่านค้าง · มือถือไม่มีใครฟัง → ไม่โหลดเปล่า
  useEffect(() => {
    if (!lastSeq) return;
    const t = window.setTimeout(() => window.dispatchEvent(new Event('room-seen')), 800);
    return () => clearTimeout(t);
  }, [lastSeq]);

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

  function queueFile(f: OutgoingFile, more?: MessageExtra) {
    const base = outExtra();
    const extra = more?.albumId ? { ...(base ?? {}), albumId: more.albumId } : base;
    const err = s.sendFile(f, text, extra);
    if (err) { notify('error', `${f.name}: ${err}`); return; }
    setText(''); // ข้อความในช่องพิมพ์กลายเป็นคำบรรยายใต้ไฟล์
    setReplyTo(null);
    stickBottom.current = true;
  }

  // ---------- รูป (ย่อก่อนส่ง) / วิดีโอ (ไม่ย่อ 50MB) — เลือกหลายไฟล์ = อัลบั้ม (ละ 20 ไฟล์) ----------
  async function onPickImages(files: FileList | null) {
    if (!files?.length) return;
    setPreparing(true);
    const list = Array.from(files);
    if (list.length > ALBUM_MAX) notify('warning', `เลือกไว้ ${list.length} ไฟล์ — จะแบ่งเป็นอัลบั้มละ ${ALBUM_MAX} ไฟล์`);
    let albumId: string | undefined;
    for (const [i, file] of list.entries()) {
      if (list.length > 1 && i % ALBUM_MAX === 0) albumId = makeAlbumId();
      const album = list.length > 1 ? { albumId } : {};
      try {
        if ((file.type || '').startsWith('video/') || /\.(mov|mp4|webm|3gp)$/i.test(file.name)) {
          const v = await prepareVideo(file);
          queueFile({ kind: 'video', blob: v.blob, name: v.name, mime: v.mime, width: v.width, height: v.height, durationMs: v.durationMs }, album);
        } else {
          const img = await prepareImage(file);
          queueFile({ kind: 'image', blob: img.blob, name: img.name, mime: img.mime, width: img.width, height: img.height }, album);
        }
      } catch (e) {
        notify('error', `${file.name}: ${e instanceof Error ? e.message : 'เตรียมไฟล์ไม่สำเร็จ'}`);
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
  // ปักหมุด/ประกาศ: ได้สูงสุด 5 ข้อความ (ผู้ใช้เลือก) — เซิร์ฟเวอร์ตรวจจำนวนซ้ำ
  const pins = room?.pins ?? [];
  async function pin(seq: number, notifyAll = false) {
    if (!room) return;
    try {
      const r = await api.post<{ warnings: string[] }>(`/api/rooms/${encodeURIComponent(room.id)}/pin`, { seq, notify: notifyAll });
      notify('success', notifyAll ? 'ปักหมุดและประกาศให้ทุกคนแล้ว' : 'ปักหมุดแล้ว');
      for (const w of r.warnings ?? []) notify('warning', w);
      void loadRoom();
    } catch (e) {
      notify('error', `ปักหมุดไม่สำเร็จ: ${errMsg(e)}`);
    }
  }
  async function unpin(seq: number) {
    if (!room) return;
    try {
      await api.post(`/api/rooms/${encodeURIComponent(room.id)}/unpin`, { seq });
      notify('success', 'เลิกปักหมุดแล้ว');
      void loadRoom();
    } catch (e) {
      notify('error', `เลิกปักหมุดไม่สำเร็จ: ${errMsg(e)}`);
    }
  }
  // ---------- ลบข้อความ: ยกเลิกส่ง (ของตัวเอง 24 ชม.) / แอดมินห้องลบ ----------
  async function deleteMsg(m: ChatMessage, asAdmin: boolean) {
    const q = asAdmin && m.senderId !== me.user.id
      ? `ลบข้อความของ ${m.senderName}? ทุกคนจะเห็นว่า "ข้อความถูกลบโดยแอดมิน"`
      : 'ยกเลิกส่งข้อความนี้? ทุกคนในห้องจะเห็นว่า "ข้อความถูกยกเลิก" (แจ้งเตือนที่เด้งไปแล้วดึงกลับไม่ได้)';
    if (!confirm(q)) return;
    try {
      const r = await api.post<{ by: string; warnings: string[] }>(`/api/rooms/${encodeURIComponent(id)}/messages/${m.seq}/delete`);
      notify('success', r.by === 'admin' ? 'ลบข้อความแล้ว' : 'ยกเลิกส่งแล้ว');
      for (const w of r.warnings) notify('warning', w);
    } catch (e) {
      notify('error', `ลบไม่สำเร็จ: ${errMsg(e)}`);
    }
  }

  /** กระโดดไปที่ข้อความ — ยังไม่ได้โหลด → โหลดย้อนหลังจนเจอก่อน (ผลค้นหา / ข้อความที่ตอบกลับ / ปักหมุด) */
  async function jumpTo(seq: number) {
    stickBottom.current = false;
    if (!document.getElementById(`msg-${seq}`)) {
      const found = await s.loadUntil(seq);
      if (!found) { notify('warning', 'ไม่พบข้อความนี้ในแชท (อาจถูกลบ หรืออยู่ก่อนที่คุณลบแชทฝั่งตัวเอง)'); return; }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));  // รอให้ข้อความที่เพิ่งโหลดขึ้นจอ
    }
    const el = document.getElementById(`msg-${seq}`);
    if (!el) { notify('warning', 'ไม่พบข้อความนี้ในแชท (อาจถูกลบไปแล้ว)'); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
  }

  // ---------- อ่านแล้ว: นับคนที่อ่านถึงข้อความนี้ (ไม่นับคนส่ง และคนที่เข้าห้องหลังข้อความนี้) ----------
  function readersOf(m: ChatMessage): ReadState[] {
    const out: ReadState[] = [];
    for (const r of s.reads.values()) {
      if (r.userId !== m.senderId && r.seq >= m.seq && r.joinedAt <= m.createdAt) out.push(r);
    }
    return out;
  }
  const isRoomAdmin = !!room && (room.myRole === 'owner' || room.myRole === 'admin');
  // ชื่อบนบับเบิล = ชื่อปัจจุบันของสมาชิก (เปลี่ยนชื่อแล้วข้อความเก่าเปลี่ยนตาม — 2026-11-18) · ออกจากห้องไปแล้ว → ชื่อตอนส่ง
  const currentNames = new Map(members.map((x) => [x.id, x.displayName]));
  const nameOf = (msg: ChatMessage) => currentNames.get(msg.senderId) ?? msg.senderName;

  // ---------- กดค้าง (มือถือ) / คลิกขวา (คอม) ที่ข้อความ = เปิดเมนู ----------
  function pressStart(m: ChatMessage, el: Element) {
    clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => openMenu(m, el), 500);
  }

  // ---------- Keep: บันทึกข้อความลงโน้ตส่วนตัว (พร้อมชื่อคนส่ง เวลา และห้อง) ----------
  async function keepMsg(m: ChatMessage) {
    const text = `${m.body || previewText(m)}\n\n— ${m.senderName} · ${thaiDate(m.createdAt)} ${thaiClock(m.createdAt)} · ${room?.title ?? 'แชท'}`;
    try {
      await api.post('/api/me/notes', { body: text.slice(0, 10000) });
      notify('success', 'เก็บลง Keep (☰ → โน้ตของฉัน) แล้ว');
    } catch (e) {
      notify('error', `เก็บลง Keep ไม่สำเร็จ: ${errMsg(e)}`);
    }
  }
  const pressEnd = () => clearTimeout(pressTimer.current);
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
            {/* 2026-11-18: เหลือ 3 ปุ่ม (ขนาดกดได้ 44px) — 📝 โน้ตของห้อง ย้ายไปอยู่ในเมนู ⋯ */}
            <button className="btn btn-small btn-ghost icon-btn" onClick={() => setShowSearch(true)} aria-label="ค้นหาข้อความในห้องนี้">🔍</button>
            <button className="btn btn-small btn-ghost icon-btn" onClick={() => setShowMute(true)} aria-label="ตั้งค่าแจ้งเตือนห้องนี้">
              {room.muted ? '🔕' : '🔔'}
            </button>
            <button className="btn btn-small btn-ghost icon-btn" onClick={() => setShowRoomMenu(true)} aria-label="เมนูห้อง (โน้ต / ลบแชท / ออกจากกลุ่ม)">⋯</button>
          </>
        )}
      />
      {connText && <div className={`banner ${s.conn === 'failed' ? 'banner-error' : 'banner-warning'}`} role="status">{connText}</div>}
      {pins.length > 0 && (
        <div className="pinned-bar">
          <button className="pinned-main" onClick={() => void jumpTo(pins[0].seq)}>
            <span className="small muted">📌 ประกาศ{pins[0].sender ? ` · ${pins[0].sender}` : ''}</span>
            <span className="pinned-text">{pins[0].text}</span>
          </button>
          <button className="link" onClick={() => setShowPins(true)} aria-label="ดูประกาศทั้งหมด">
            {pins.length > 1 ? `ทั้งหมด ${pins.length}` : 'จัดการ'}
          </button>
        </div>
      )}

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {!s.synced && s.conn !== 'failed' && <Loading variant="bubbles" />}
        {s.loadingOlder && <p className="center muted small">กำลังโหลดข้อความเก่า…</p>}
        {groupAlbums(s.messages).map((item) => {
          if (item.album) {
            const ms = item.album;
            const first = ms[0], last = ms[ms.length - 1];
            const d = thaiDate(first.createdAt);
            const showDate = d !== lastDate;
            lastDate = d;
            const mine = first.senderId === me.user.id;
            const readers = (isChannel ? isRoomAdmin : mine) ? readersOf(last) : [];
            return (
              <div key={`album-${first.seq}`}>
                {showDate && <div className="date-sep">{d}</div>}
                <div className={`bubble-row ${mine ? 'mine' : ''}`}>
                  <div className="bubble bubble-album">
                    {!mine && isGroup && <div className="bubble-name">{nameOf(first)}</div>}
                    {first.extra?.forwardedFrom && <div className="forwarded">↪️ ส่งต่อจาก {first.extra.forwardedFrom}</div>}
                    <div className={`album-grid n${Math.min(ms.length, 4)}`}>
                      {ms.map((m) => (
                        <div key={m.seq} id={`msg-${m.seq}`} className="album-tile"
                          onContextMenu={(e) => { e.preventDefault(); openMenu(m, e.currentTarget); }}
                          onTouchStart={(e) => pressStart(m, e.currentTarget)} onTouchEnd={pressEnd} onTouchMove={pressEnd}>
                          <AlbumTile m={m} />
                          {!!m.reactions?.length && (
                            <button className="album-react" onClick={() => setReactionsFor(m)} aria-label="ดูว่าใครกดรีแอคชัน">
                              {m.reactions[0].emoji} {m.reactions.reduce((n, g) => n + g.users.length, 0)}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {ms.filter((m) => m.body).map((m) => <div key={m.seq} className="bubble-body">{m.body}</div>)}
                    <div className="bubble-meta">
                      {readers.length > 0 && (
                        room?.type === 'dm' ? <span className="read-mark">อ่านแล้ว </span>
                        : isChannel ? <span className="read-mark">👁 {readers.length} </span>
                        : <button className="read-mark link" onClick={() => setReadersFor(readers)}>อ่านแล้ว {readers.length} </button>
                      )}
                      {ms.length} รายการ · {thaiClock(last.createdAt)}
                      <button className="bubble-more" onClick={(e) => openMenu(last, e.currentTarget.closest('.bubble') ?? e.currentTarget)} aria-label="ตัวเลือก (รูปสุดท้าย) — กดค้างที่รูปเพื่อเลือกรูปนั้น">⋯</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          const m = item.one;
          const d = thaiDate(m.createdAt);
          const showDate = d !== lastDate;
          lastDate = d;
          const mine = m.senderId === me.user.id;
          // อ่านแล้ว (ผู้ใช้เลือกแบบ LINE): 1:1 / กลุ่ม = ข้อความของเรา · ชาเนล = เจ้าของ/แอดมินเห็นจำนวนทุกโพสต์
          const showReads = !m.deleted && (isChannel ? isRoomAdmin : mine);
          const readers = showReads ? readersOf(m) : [];
          const myReaction = m.reactions?.find((g) => g.users.some((u) => u.id === me.user.id))?.emoji ?? null;
          return (
            <div key={m.seq}>
              {showDate && <div className="date-sep">{d}</div>}
              <div className={`bubble-row ${mine ? 'mine' : ''}`} id={`msg-${m.seq}`}>
                <div
                  className={`bubble ${m.kind === 'sticker' ? 'bubble-sticker' : ''}`}
                  onContextMenu={(e) => { e.preventDefault(); openMenu(m, e.currentTarget); }}
                  onTouchStart={(e) => { pressStart(m, e.currentTarget); swipe.start(e, m, e.currentTarget, !!room?.canPost && !m.deleted); }}
                  onTouchMove={swipe.move}
                  onTouchEnd={() => { pressEnd(); swipe.end(); }}
                  onTouchCancel={() => { pressEnd(); swipe.end(); }}
                >
                  {!mine && isGroup && <div className="bubble-name">{nameOf(m)}</div>}
                  {!m.deleted && m.extra?.forwardedFrom && <div className="forwarded">↪️ ส่งต่อจาก {m.extra.forwardedFrom}</div>}
                  {m.deleted ? (
                    <div className="bubble-deleted">{m.deleted.by === 'admin' ? '🚫 ข้อความถูกลบโดยแอดมิน' : '🚫 ข้อความถูกยกเลิก'}</div>
                  ) : null}
                  {!m.deleted && m.extra?.replyTo && (
                    <button className="reply-quote" onClick={() => void jumpTo(m.extra!.replyTo!.seq)}>
                      <b>{m.extra.replyTo.senderName ?? 'ข้อความ'}</b>
                      <span>{m.extra.replyTo.snippet ?? ''}</span>
                    </button>
                  )}
                  {!m.deleted && (m.kind === 'poll'
                    ? <PollCard m={m} meId={me.user.id} canClose={m.poll?.createdBy === me.user.id || isRoomAdmin}
                        onVote={(opts) => s.vote(m.seq, opts)} onClose={() => { if (confirm('ปิดโหวตโพลนี้เลยไหม? ปิดแล้วเปิดใหม่ไม่ได้')) s.closePoll(m.seq); }} />
                    : <MessageContent m={m} roomId={id} />)}
                  {!m.deleted && !!m.reactions?.length && (
                    <button className="reaction-chips" onClick={() => setReactionsFor(m)} aria-label="ดูว่าใครกดรีแอคชัน">
                      {m.reactions.map((g) => (
                        <span key={g.emoji} className={g.emoji === myReaction ? 'chip-mine' : ''}>{g.emoji} {g.users.length}</span>
                      ))}
                    </button>
                  )}
                  <div className="bubble-meta">
                    {readers.length > 0 && (
                      room?.type === 'dm' ? <span className="read-mark">อ่านแล้ว </span>
                      : isChannel ? <span className="read-mark" title="จำนวนคนที่อ่านแล้ว">👁 {readers.length} </span>
                      : <button className="read-mark link" onClick={() => setReadersFor(readers)}>อ่านแล้ว {readers.length} </button>
                    )}
                    {m.extra?.silent && <span title="ส่งแบบเงียบ">🔕 </span>}
                    {thaiClock(m.createdAt)}
                    <button className="bubble-more" onClick={(e) => openMenu(m, e.currentTarget.closest('.bubble') ?? e.currentTarget)} aria-label="ตัวเลือกข้อความ">⋯</button>
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
                <div className="small">{p.kind === 'voice' ? '🎤 ข้อความเสียง' : p.kind === 'video' ? `🎬 ${p.file.name}` : `📄 ${p.file.name}`} · {formatSize(p.file.blob.size)}</div>
              )}
              {p.kind === 'poll' && <div className="small">📊 โพล: {p.extra?.pollCreate?.options.length ?? 0} ตัวเลือก</div>}
              {p.extra?.albumId && <div className="small muted">อัลบั้ม</div>}
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

      {s.typing.size > 0 && (
        <div className="typing-line small muted" aria-live="polite">
          {[...s.typing.values()].map((t) => t.name).slice(0, 3).join(', ')}{s.typing.size > 3 ? ` และอีก ${s.typing.size - 3} คน` : ''} กำลังพิมพ์…
        </div>
      )}
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
        {/* 2026-11-18 (ผู้ใช้เลือก): แบบ LINE — ช่องพิมพ์บรรทัดเดียว [＋][🖼][พิมพ์…][😊][ส่ง] · ＋ เปิดตารางเครื่องมือ */}
        <div className="composer-row">
          <button type="button" className={`icon-btn composer-icon ${showTools ? 'on' : ''}`} onClick={() => { setShowTools((v) => !v); setShowStickers(false); }}
            disabled={s.conn === 'failed'} aria-expanded={showTools} aria-label={showTools ? 'ปิดเครื่องมือ' : `เครื่องมือ (ไฟล์ เสียง${hasMembers ? ' โพล' : ''} ส่งเงียบ)`}>
            {showTools ? '✕' : '＋'}{silent && <span className="dot" aria-hidden="true" />}
          </button>
          <button type="button" className="icon-btn composer-icon" onClick={() => imageInput.current?.click()} disabled={s.conn === 'failed'} aria-label="ส่งรูป/วิดีโอ">🖼</button>
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => { setText(e.target.value); if (inputError) setInputError(''); if (e.target.value.trim()) s.sendTyping(); }}
            onKeyDown={onKey}
            onFocus={() => setShowTools(false)}
            rows={1}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={silent ? 'ส่งแบบเงียบ' : hasMembers ? 'พิมพ์ · @ เรียกชื่อ' : 'พิมพ์ข้อความ'}
          />
          <button type="button" className={`icon-btn composer-icon ${showStickers ? 'on' : ''}`} onClick={() => { setShowStickers((v) => !v); setShowTools(false); }}
            disabled={s.conn === 'failed'} aria-pressed={showStickers} aria-label="สติกเกอร์">😊</button>
          <button className="btn composer-send" disabled={s.conn === 'failed'}>ส่ง</button>
        </div>
        {showTools && (
          <div className="tool-grid" role="group" aria-label="เครื่องมือส่ง">
            <button type="button" onClick={() => { setShowTools(false); imageInput.current?.click(); }}><span>🖼</span>รูป/วิดีโอ</button>
            <button type="button" onClick={() => { setShowTools(false); fileInput.current?.click(); }}><span>📎</span>ส่งเป็นไฟล์</button>
            <button type="button" onClick={() => { setShowTools(false); setRecording(true); }}><span>🎤</span>ข้อความเสียง</button>
            {hasMembers && <button type="button" onClick={() => { setShowTools(false); setShowPoll(true); }}><span>📊</span>โพล</button>}
            {me.user.role === 'admin' && <button type="button" onClick={() => { setShowTools(false); void openFormPicker(); }}><span>📝</span>ฟอร์ม</button>}
            <button type="button" className={silent ? 'on' : ''} onClick={() => setSilent((v) => !v)} aria-pressed={silent}
              title="ส่งแบบเงียบ: คนรับเห็นข้อความแต่มือถือไม่เด้ง">
              <span>🔕</span>{silent ? 'เงียบอยู่ (แตะปิด)' : 'ส่งเงียบ'}
            </button>
          </div>
        )}
        <input ref={imageInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => void onPickImages(e.target.files)} />
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => onPickFiles(e.target.files)} />
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

      {menu && (
        <MessagePopup
          m={menu.m}
          rect={menu.rect}
          canReply={!!room?.canPost && !menu.m.deleted}
          canPin={canPin && !menu.m.deleted}
          isPinned={pins.some((p) => p.seq === menu.m.seq)}
          canUnsend={!menu.m.deleted && menu.m.senderId === me.user.id && Date.now() - Date.parse(menu.m.createdAt) <= UNSEND_MS}
          canModerate={!menu.m.deleted && isRoomAdmin && room?.type !== 'dm'}
          canNote={!menu.m.deleted && !!room?.canPost}
          canForward={!menu.m.deleted && menu.m.kind !== 'poll' && (menu.m.kind !== 'form' || me.user.role === 'admin')}
          myReaction={menu.m.reactions?.find((g) => g.users.some((u) => u.id === me.user.id))?.emoji ?? null}
          canReact={s.conn === 'open' && !menu.m.deleted}
          onClose={() => setMenu(null)}
          onAction={(a) => {
            const m = menu.m;
            setMenu(null);
            switch (a) {
              case 'copy':
                void copyText(m.body).then((okCopy) => okCopy
                  ? notify('success', 'คัดลอกข้อความแล้ว')
                  : notify('error', 'คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด (ลองใช้ "คัดลอกบางส่วน")'));
                break;
              case 'copyPart': setCopyPart(m); break;
              case 'keep': void keepMsg(m); break;
              case 'hide':
                if (confirm('ลบข้อความนี้เฉพาะในแชทของคุณ? คนอื่นในห้องยังเห็นอยู่ (ถ้าอยากให้ทุกคนไม่เห็น ใช้ "ยกเลิกข้อความ")')) s.hide(m.seq);
                break;
              case 'unsend': void deleteMsg(m, false); break;
              case 'adminDelete': void deleteMsg(m, true); break;
              case 'reply': setReplyTo({ seq: m.seq, senderName: m.senderName, snippet: previewText(m) }); break;
              case 'forward': setForwardFor(m); break;
              case 'note': nav(`/room/${encodeURIComponent(id)}/notes`, { state: { draft: `${m.body || previewText(m)}\n\n— ${m.senderName} · ${thaiDate(m.createdAt)} ${thaiClock(m.createdAt)}` } }); break;
              case 'pin': void pin(m.seq, false); break;
              case 'announce': void pin(m.seq, true); break;
              case 'unpin': void unpin(m.seq); break;
            }
          }}
          onReact={(emoji) => { s.react(menu.m.seq, emoji); setMenu(null); }}
        />
      )}
      {copyPart && <CopyPartSheet m={copyPart} onClose={() => setCopyPart(null)} />}

      {showPoll && (
        <PollSheet onClose={() => setShowPoll(false)} onSend={(q, poll) => {
          s.sendPoll(q, poll, outExtra());
          setReplyTo(null);
          setShowPoll(false);
          stickBottom.current = true;
        }} />
      )}
      {showPins && (
        <PinsSheet pins={pins} canPin={canPin} onClose={() => setShowPins(false)}
          onJump={(seq) => { setShowPins(false); void jumpTo(seq); }} onUnpin={(seq) => void unpin(seq)} />
      )}
      {showSearch && (
        <SearchSheet roomId={id} onClose={() => setShowSearch(false)} onPick={(seq) => { setShowSearch(false); void jumpTo(seq); }} />
      )}
      {forwardFor && <ForwardSheet m={forwardFor} roomId={id} onClose={() => setForwardFor(null)} />}
      {readersFor && <ReadersSheet readers={readersFor} onClose={() => setReadersFor(null)} />}
      {reactionsFor && (
        <ReactionsSheet
          groups={s.messages.find((x) => x.seq === reactionsFor.seq)?.reactions ?? []}
          meId={me.user.id}
          onRemoveMine={() => { s.react(reactionsFor.seq, null); setReactionsFor(null); }}
          onClose={() => setReactionsFor(null)}
        />
      )}

      {showRoomMenu && room && (
        <RoomMenu room={room} members={members} onClose={() => setShowRoomMenu(false)} />
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
  if (m.kind === 'video') return '[วิดีโอ]';
  if (m.kind === 'poll') return `[โพล] ${m.body}`;
  return '';
}

const UNSEND_MS = 24 * 3600_000; // ต้องตรงกับ UNSEND_WINDOW_MS ใน worker/room.ts (เซิร์ฟเวอร์ตรวจซ้ำเสมอ)

type MenuAction = 'copy' | 'copyPart' | 'keep' | 'hide' | 'unsend' | 'adminDelete' | 'reply' | 'forward' | 'note' | 'pin' | 'announce' | 'unpin';

// ไอคอนเส้นแบบเรียบ (วาดเอง) — ขนาด 26px สีตามตัวอักษร
const I = (d: string) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICONS: Record<MenuAction, ReactElement> = {
  copy: I('M8 8h11v12H8zM5 16V4h11'),
  copyPart: I('M4 7h16M4 12h10M4 17h7M17 14v6M14 17h6'),
  keep: I('M6 3h12v18l-6-4-6 4z'),
  hide: I('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'),
  unsend: I('M4 12a8 8 0 1 0 3-6.2M4 4v4h4M9 10l6 6M15 10l-6 6'),
  adminDelete: I('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M12 4v0'),
  reply: I('M10 6L4 12l6 6M4 12h10a6 6 0 0 1 6 6'),
  forward: I('M12 3v12M7 8l5-5 5 5M5 14v6h14v-6'),
  note: I('M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4'),
  pin: I('M9 3h6l-1 6 4 4H6l4-4zM12 13v8'),
  announce: I('M4 10v4h3l7 4V6l-7 4zM17 9a4 4 0 0 1 0 6'),
  unpin: I('M9 3h6l-1 6 4 4H6l4-4zM12 13v8M4 4l16 16'),
};

/** เมนูกดค้างแบบ LINE: กล่องตารางไอคอนติดกับข้อความ + แถบอีโมจิ (ผู้ใช้เลือกใช้อีโมจิ 6 ตัว — ไม่ใช้ตัวการ์ตูนของ LINE) */
function MessagePopup({
  m, rect, canReply, canPin, isPinned, canUnsend, canModerate, canNote, canForward, myReaction, canReact, onClose, onAction, onReact,
}: {
  m: ChatMessage; rect: DOMRect; canReply: boolean; canPin: boolean; isPinned: boolean; canUnsend: boolean; canModerate: boolean;
  canNote: boolean; canForward: boolean; myReaction: string | null; canReact: boolean;
  onClose: () => void; onAction: (a: MenuAction) => void; onReact: (emoji: string | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hasText = !!m.body && !m.deleted;
  const items: { a: MenuAction; label: string; danger?: boolean }[] = [
    ...(hasText ? [{ a: 'copy' as const, label: 'คัดลอกทั้งหมด' }, { a: 'copyPart' as const, label: 'คัดลอกบางส่วน' }] : []),
    ...(!m.deleted ? [{ a: 'keep' as const, label: 'Keep' }] : []),
    { a: 'hide', label: 'ลบ', danger: true },
    ...(canUnsend ? [{ a: 'unsend' as const, label: 'ยกเลิกข้อความ', danger: true }] : []),
    ...(!canUnsend && canModerate ? [{ a: 'adminDelete' as const, label: 'ลบ (แอดมิน)', danger: true }] : []),
    ...(canReply ? [{ a: 'reply' as const, label: 'ตอบกลับ' }] : []),
    ...(canForward ? [{ a: 'forward' as const, label: 'ส่งต่อ' }] : []),
    ...(canNote ? [{ a: 'note' as const, label: 'โน้ต' }] : []),
    ...(canPin && !isPinned ? [{ a: 'pin' as const, label: 'ปักหมุด' }, { a: 'announce' as const, label: 'ประกาศ' }] : []),
    ...(canPin && isPinned ? [{ a: 'unpin' as const, label: 'เลิกปักหมุด' }] : []),
  ];

  // วางกล่องใต้ข้อความ ถ้าที่ไม่พอวางเหนือ ถ้ายังไม่พอวางกลางจอ
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const h = box.offsetHeight, w = box.offsetWidth, vh = window.innerHeight, vw = window.innerWidth;
    let top = rect.bottom + 8;
    if (top + h > vh - 8) top = rect.top - h - 8;
    if (top < 8) top = Math.max(8, (vh - h) / 2);
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), vw - w - 8);
    setPos({ top, left });
  }, [rect]);

  return (
    <div className="popup-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={boxRef} className="msg-popup" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
        onClick={(e) => e.stopPropagation()} role="menu" aria-label="ตัวเลือกข้อความ">
        <div className="msg-popup-grid">
          {items.map((it) => (
            <button key={it.a} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => onAction(it.a)}>
              {ICONS[it.a]}<span>{it.label}</span>
            </button>
          ))}
        </div>
        {!m.deleted && (
          <div className="msg-popup-react" role="group" aria-label="กดรีแอคชัน">
            {REACTIONS.map((e) => (
              <button key={e} className={e === myReaction ? 'on' : ''} disabled={!canReact} aria-pressed={e === myReaction}
                onClick={() => onReact(e === myReaction ? null : e)}>{e}</button>
            ))}
          </div>
        )}
        {!canReact && !m.deleted && <p className="small muted msg-popup-note">ยังไม่ได้เชื่อมต่อกับห้อง — กดรีแอคชันไม่ได้ชั่วคราว</p>}
      </div>
    </div>
  );
}

/** คัดลอกบางส่วน: เลือกข้อความเองในกล่อง แล้วกดคัดลอก */
function CopyPartSheet({ m, onClose }: { m: ChatMessage; onClose: () => void }) {
  const notify = useNotify();
  const ref = useRef<HTMLTextAreaElement>(null);
  async function copySelected() {
    const ta = ref.current;
    if (!ta) return;
    const part = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (!part) { notify('warning', 'ยังไม่ได้เลือกข้อความ — ลากเลือกส่วนที่ต้องการก่อน'); return; }
    if (await copyText(part)) { notify('success', `คัดลอกแล้ว ${part.length.toLocaleString('th-TH')} ตัวอักษร`); onClose(); }
    else notify('error', 'คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาต ลองกดค้างที่ข้อความที่เลือกแล้วเลือก "คัดลอก" ของเครื่อง');
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>คัดลอกบางส่วน</b><button className="link" onClick={onClose}>ปิด</button></div>
        <p className="small muted">ลากเลือกเฉพาะส่วนที่ต้องการ แล้วกด "คัดลอกส่วนที่เลือก"</p>
        <textarea ref={ref} readOnly value={m.body} rows={Math.min(12, Math.max(3, m.body.split('\n').length + 1))} className="copy-part" />
        <button className="btn btn-block" onClick={() => void copySelected()}>คัดลอกส่วนที่เลือก</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// สมาชิกกลุ่ม + เพิ่มสมาชิก + เปลี่ยนชื่อ (เจ้าของ/แอดมินห้องเท่านั้น)
// ---------------------------------------------------------------------
function MembersPanel({ room, members, onClose, onChanged }: {
  room: Room; members: RoomMember[]; onClose: () => void; onChanged: () => void;
}) {
  const notify = useNotify();
  const canAdd = room.myRole === 'owner' || room.myRole === 'admin';
  const isOwner = room.myRole === 'owner';
  const nav = useNavigate();
  // ---------- เปลี่ยนชื่อกลุ่ม/ชาเนล (เจ้าของ/แอดมินห้อง) ----------
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(room.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const kindTh = room.type === 'channel' ? 'ชาเนล' : 'กลุ่ม';
  // ---------- รูปกลุ่ม/ชาเนล (2026-11-18 — เจ้าของ/แอดมินห้อง · ครอปวงกลมเหมือนรูปโปรไฟล์) ----------
  const [picFile, setPicFile] = useState<File | null>(null);
  const [savingPic, setSavingPic] = useState(false);
  const picInput = useRef<HTMLInputElement>(null);

  async function savePicture(blob: Blob | null) {
    setSavingPic(true);
    try {
      const r = blob
        ? await api.raw<{ warning: string | null }>(`/api/rooms/${encodeURIComponent(room.id)}/picture`, blob, 'image/jpeg')
        : await api.post<{ warning: string | null }>(`/api/rooms/${encodeURIComponent(room.id)}/picture/reset`);
      notify('success', blob ? `เปลี่ยนรูป${kindTh}แล้ว` : `ลบรูป${kindTh}แล้ว`);
      if (r.warning) notify('warning', r.warning);
      setPicFile(null);
      onChanged();
    } catch (e) {
      notify('error', `${blob ? 'เปลี่ยน' : 'ลบ'}รูป${kindTh}ไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setSavingPic(false);
    }
  }

  async function saveTitle() {
    const t = newTitle.trim();
    if (!t) { notify('error', `ชื่อ${kindTh}ว่าง บันทึกไม่ได้`); return; }
    setSavingTitle(true);
    try {
      const r = await api.post<{ title: string; warning: string | null }>(`/api/rooms/${encodeURIComponent(room.id)}/title`, { title: t });
      notify('success', `เปลี่ยนชื่อ${kindTh}เป็น "${r.title}" แล้ว`);
      if (r.warning) notify('warning', r.warning);
      setRenaming(false);
      onChanged();
    } catch (e) {
      notify('error', `เปลี่ยนชื่อไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setSavingTitle(false);
    }
  }

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
          <b className="ellipsis">{room.title}</b>
          {canAdd && !renaming && (
            <button className="btn btn-small btn-ghost" onClick={() => { setNewTitle(room.title); setRenaming(true); }} aria-label={`เปลี่ยนชื่อ${kindTh}`}>
              ✏️ เปลี่ยนชื่อ
            </button>
          )}
          <button className="link" onClick={onClose}>ปิด</button>
        </div>
        {renaming && (
          <div className="form-block">
            <input value={newTitle} maxLength={80} onChange={(e) => setNewTitle(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void saveTitle(); }} placeholder={`ชื่อ${kindTh}ใหม่`} />
            <div className="small muted">{newTitle.trim().length} / 80 ตัวอักษร · สมาชิกจะเห็นข้อความแจ้งในห้อง (มือถือไม่เด้ง)</div>
            <div className="seg">
              <button className="btn btn-small" disabled={savingTitle} onClick={() => void saveTitle()}>{savingTitle ? 'กำลังบันทึก…' : 'บันทึก'}</button>
              <button className="btn btn-small btn-ghost" disabled={savingTitle} onClick={() => setRenaming(false)}>ยกเลิก</button>
            </div>
          </div>
        )}
        {!adding ? (
          <>
            <div className="room-pic-row">
              <Avatar name={room.title} url={room.picture} size={64} />
              {canAdd && (
                <div className="seg">
                  <button className="btn btn-small" disabled={savingPic} onClick={() => picInput.current?.click()}>
                    🖼 {room.picture ? `เปลี่ยนรูป${kindTh}` : `ใส่รูป${kindTh}`}
                  </button>
                  {room.picture && (
                    <button className="btn btn-small btn-ghost" disabled={savingPic}
                      onClick={() => { if (confirm(`ลบรูป${kindTh}?`)) void savePicture(null); }}>ลบรูป</button>
                  )}
                  <input ref={picInput} type="file" accept="image/*" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPicFile(f); }} />
                </div>
              )}
            </div>
            {picFile && (
              <PictureCropper file={picFile} title={`รูป${kindTh}`} busy={savingPic} onCancel={() => setPicFile(null)} onDone={(b) => void savePicture(b)} />
            )}
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
            {users === null && !error && <Loading variant="list" rows={4} />}
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

// ---------------------------------------------------------------------
// ฟีเจอร์แชท (2026-11-17): คัดลอก · ค้นหา · ส่งต่อ · ใครอ่านแล้ว · ใครกดรีแอคชัน
// ---------------------------------------------------------------------
/** คัดลอกข้อความ — เบราว์เซอร์ในแอป/หน้า http บางที่ไม่มี clipboard API → ใช้วิธีเก่า (execCommand) แทน */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn('clipboard API ใช้ไม่ได้ ลองวิธีสำรอง', err);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let okCopy = false;
  try {
    okCopy = document.execCommand('copy');
  } catch (err) {
    console.warn('คัดลอกวิธีสำรองไม่สำเร็จ', err);
  }
  ta.remove();
  return okCopy;
}

/** ไฮไลต์คำที่ค้นในข้อความ */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return <>{text}</>;
  const start = Math.max(0, i - 30);
  return <>{start > 0 ? '…' : ''}{text.slice(start, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length, i + q.length + 80)}</>;
}

function SearchSheet({ roomId, onClose, onPick }: { roomId: string; onClose: () => void; onPick: (seq: number) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<{ q: string; messages: ChatMessage[]; more: boolean } | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes(null); setError(''); return; }
    if (term.length > 100) { setError('คำค้นยาวเกิน 100 ตัวอักษร'); return; }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setBusy(true);
      try {
        const d = await api.get<{ messages: ChatMessage[]; more: boolean }>(
          `/api/rooms/${encodeURIComponent(roomId)}/search?q=${encodeURIComponent(term)}`,
        );
        if (!cancelled) { setRes({ q: term, ...d }); setError(''); }
      } catch (e) {
        if (!cancelled) setError(`ค้นหาไม่สำเร็จ: ${errMsg(e)}`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, roomId]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>🔍 ค้นหาข้อความในห้องนี้</b><button className="link" onClick={onClose}>ปิด</button></div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์คำที่ต้องการค้น (ข้อความ / ชื่อไฟล์)" maxLength={120} />
        {busy && <p className="small muted">กำลังค้นหา…</p>}
        {error && <p className="error-text small">{error}</p>}
        {res && !error && (
          res.messages.length === 0 ? <p className="small muted">ไม่พบข้อความที่มีคำว่า "{res.q}"</p> : (
            <ul className="search-results">
              {res.messages.map((m) => (
                <li key={m.seq}>
                  <button onClick={() => onPick(m.seq)}>
                    <span className="small muted">{m.senderName} · {thaiDate(m.createdAt)} {thaiClock(m.createdAt)}</span>
                    <span><Highlight text={m.body || m.file?.name || previewText(m)} q={res.q} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {res?.more && <p className="small muted">แสดง 50 ข้อความล่าสุดที่ตรง — พิมพ์คำให้เจาะจงขึ้นเพื่อหาข้อความที่เก่ากว่า</p>}
      </div>
    </div>
  );
}

const FORWARD_MAX = 10; // ต้องตรงกับ FORWARD_MAX_TARGETS ใน worker/index.ts (เซิร์ฟเวอร์ตรวจซ้ำ)

function ForwardSheet({ m, roomId, onClose }: { m: ChatMessage; roomId: string; onClose: () => void }) {
  const notify = useNotify();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ roomId: string; ok: boolean; error?: { message: string } }[] | null>(null);

  useEffect(() => {
    api.get<{ rooms: Room[] }>('/api/rooms')
      .then((d) => setRooms(d.rooms.filter((r) => r.id !== roomId)))
      .catch((e) => setLoadError(`โหลดรายการแชทไม่สำเร็จ: ${errMsg(e)}`));
  }, [roomId]);

  const shown = (rooms ?? []).filter((r) => r.title.toLowerCase().includes(q.trim().toLowerCase()));
  const titleOf = (id: string) => rooms?.find((r) => r.id === id)?.title ?? 'ห้อง';
  function toggle(id: string) {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= FORWARD_MAX) { notify('warning', `ส่งต่อได้ครั้งละไม่เกิน ${FORWARD_MAX} ห้อง`); return p; }
      return [...p, id];
    });
  }
  async function send() {
    setBusy(true);
    try {
      const d = await api.post<{ results: { roomId: string; ok: boolean; error?: { message: string } }[]; sent: number }>(
        `/api/rooms/${encodeURIComponent(roomId)}/messages/${m.seq}/forward`, { targets: picked },
      );
      setResults(d.results);
      if (d.sent === d.results.length) notify('success', `ส่งต่อแล้ว ${d.sent} ห้อง`);
      else notify('warning', `ส่งต่อได้ ${d.sent} จาก ${d.results.length} ห้อง — ดูเหตุผลของห้องที่ส่งไม่ได้ในหน้าต่างนี้`);
    } catch (e) {
      notify('error', `ส่งต่อไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b className="ellipsis">↪️ ส่งต่อ: {previewText(m)}</b><button className="link" onClick={onClose}>ปิด</button></div>
        {results ? (
          <>
            <ul className="menu-list">
              {results.map((r) => (
                <li key={r.roomId} className={r.ok ? '' : 'error-text'}>
                  {r.ok ? '✅' : '❌'} {titleOf(r.roomId)}{r.ok ? '' : ` — ${r.error?.message ?? 'ส่งไม่ได้'}`}
                </li>
              ))}
            </ul>
            <button className="btn btn-block" onClick={onClose}>เสร็จ</button>
          </>
        ) : (
          <>
            <p className="small muted">คนรับจะเห็น "ส่งต่อจาก {m.extra?.forwardedFrom ?? m.senderName}" · เลือกได้ไม่เกิน {FORWARD_MAX} ห้อง</p>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อแชท" />
            {loadError && <p className="error-text small">{loadError}</p>}
            {!rooms && !loadError && <Loading variant="list" rows={4} />}
            <ul className="user-list">
              {shown.map((r) => (
                <li key={r.id} className="user-item">
                  <label className="grow forward-pick">
                    <input type="checkbox" checked={picked.includes(r.id)} disabled={!r.canPost} onChange={() => toggle(r.id)} />
                    <Avatar name={r.title} url={r.picture} size={28} />
                    <span>{r.type === 'channel' ? '📢 ' : r.type === 'group' ? '👥 ' : ''}{r.title}</span>
                    {!r.canPost && <span className="small muted"> · โพสต์ไม่ได้</span>}
                  </label>
                </li>
              ))}
            </ul>
            <button className="btn btn-block" disabled={busy || picked.length === 0} onClick={() => void send()}>
              {busy ? 'กำลังส่งต่อ…' : `ส่งต่อ${picked.length ? ` (${picked.length} ห้อง)` : ''}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReadersSheet({ readers, onClose }: { readers: ReadState[]; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>อ่านแล้ว {readers.length} คน</b><button className="link" onClick={onClose}>ปิด</button></div>
        <ul className="menu-list">{readers.map((r) => <li key={r.userId}>👁 {r.name ?? 'สมาชิก'}</li>)}</ul>
      </div>
    </div>
  );
}

function ReactionsSheet({ groups, meId, onRemoveMine, onClose }: {
  groups: ReactionGroup[]; meId: string; onRemoveMine: () => void; onClose: () => void;
}) {
  const mine = groups.some((g) => g.users.some((u) => u.id === meId));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>รีแอคชัน</b><button className="link" onClick={onClose}>ปิด</button></div>
        {groups.length === 0 && <p className="small muted">ยังไม่มีใครกดรีแอคชัน</p>}
        <ul className="menu-list">
          {groups.flatMap((g) => g.users.map((u) => <li key={`${g.emoji}-${u.id}`}>{g.emoji} {u.name}{u.id === meId ? ' (คุณ)' : ''}</li>))}
        </ul>
        {mine && <button className="btn btn-ghost btn-block" onClick={onRemoveMine}>เอารีแอคชันของฉันออก</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// ชุด 2 (2026-11-17): อัลบั้ม · โพล · ประกาศ
// ---------------------------------------------------------------------
function makeAlbumId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** รวมรูป/วิดีโอที่ส่งพร้อมกัน (albumId เดียวกัน + คนส่งคนเดียวกัน + อยู่ติดกัน) เป็นอัลบั้ม */
function groupAlbums(msgs: ChatMessage[]): ({ one: ChatMessage; album?: undefined } | { album: ChatMessage[]; one?: undefined })[] {
  const out: ({ one: ChatMessage; album?: undefined } | { album: ChatMessage[]; one?: undefined })[] = [];
  for (const m of msgs) {
    const aid = m.deleted ? undefined : m.extra?.albumId;
    const prev = out[out.length - 1];
    if (aid && prev?.album && prev.album[0].extra?.albumId === aid && prev.album[0].senderId === m.senderId) {
      prev.album.push(m);
    } else if (aid) {
      out.push({ album: [m] });
    } else {
      out.push({ one: m });
    }
  }
  return out.map((x) => (x.album && x.album.length === 1 ? { one: x.album[0] } : x));
}

function AlbumTile({ m }: { m: ChatMessage }) {
  const [broken, setBroken] = useState(false);
  const f = m.file;
  if (!f) return <div className="album-missing small muted">ไม่มีไฟล์</div>;
  const url = `/api/files/${encodeURIComponent(f.id)}`;
  if (f.expiresAt && f.expiresAt < nowThai()) return <div className="album-missing small muted">หมดอายุ</div>;
  if (broken) return <a className="album-missing small" href={url} download={f.name}>เปิดไม่ได้ — ดาวน์โหลด</a>;
  if (m.kind === 'video') {
    return (
      <div className="album-video">
        <video src={`${url}#t=0.1`} preload="metadata" controls playsInline onError={() => setBroken(true)} />
        {f.durationMs ? <span className="album-dur">{formatDuration(f.durationMs)}</span> : null}
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={f.name} loading="lazy" onError={() => setBroken(true)} />
    </a>
  );
}

function PollCard({ m, meId, canClose, onVote, onClose }: {
  m: ChatMessage; meId: string; canClose: boolean; onVote: (options: number[]) => void; onClose: () => void;
}) {
  const [showNames, setShowNames] = useState(false);
  const p = m.poll;
  if (!p) return <div className="small error-text">อ่านข้อมูลโพลไม่ได้ — ลองเปิดห้องใหม่</div>;
  const closed = !!p.closedAt || (!!p.closesAt && p.closesAt <= nowThai());
  const mine = p.options.map((o, i) => (o.voters.some((v) => v.id === meId) ? i : -1)).filter((i) => i >= 0);
  const voters = new Set(p.options.flatMap((o) => o.voters.map((v) => v.id))).size;
  function tap(i: number) {
    if (closed) return;
    if (p!.multi) onVote(mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i]);
    else onVote(mine.includes(i) ? [] : [i]);
  }
  return (
    <div className="poll-card">
      <div className="small muted">📊 โพล · {p.multi ? 'เลือกได้หลายข้อ' : 'เลือกได้ 1 ข้อ'}</div>
      <b className="poll-q">{m.body}</b>
      {p.options.map((o, i) => {
        const pct = voters ? Math.round((o.voters.length / voters) * 100) : 0;
        return (
          <div key={i}>
            <button className={`poll-opt ${mine.includes(i) ? 'on' : ''}`} onClick={() => tap(i)} disabled={closed} aria-pressed={mine.includes(i)}>
              <span className="poll-bar" style={{ width: `${pct}%` }} />
              <span className="poll-label">{mine.includes(i) ? '✓ ' : ''}{o.text}</span>
              <span className="poll-count">{o.voters.length}</span>
            </button>
            {showNames && o.voters.length > 0 && <div className="small muted poll-names">{o.voters.map((v) => v.name).join(', ')}</div>}
          </div>
        );
      })}
      <div className="small muted">
        {voters} คนโหวต ·{' '}
        {closed ? `ปิดโหวตแล้ว${p.closedAt ? ` (${thaiShort(p.closedAt)})` : ''}` : p.closesAt ? `ปิดโหวต ${thaiShort(p.closesAt)}` : 'ไม่มีกำหนดปิด'}
        {!closed && ' · แตะอีกครั้งเพื่อเปลี่ยน/ถอนโหวต'}
      </div>
      <div className="poll-actions">
        {voters > 0 && <button className="link small" onClick={() => setShowNames((v) => !v)}>{showNames ? 'ซ่อนรายชื่อ' : 'ดูว่าใครโหวต'}</button>}
        {canClose && !closed && <button className="link small danger-text" onClick={onClose}>ปิดโหวต</button>}
      </div>
    </div>
  );
}

const POLL_CLOSE_OPTIONS: { key: string; label: string; ms: number | null }[] = [
  { key: 'none', label: 'ไม่กำหนด', ms: null }, { key: '1h', label: '1 ชั่วโมง', ms: 3600_000 },
  { key: '1d', label: '1 วัน', ms: 86400_000 }, { key: '3d', label: '3 วัน', ms: 3 * 86400_000 }, { key: '7d', label: '7 วัน', ms: 7 * 86400_000 },
];

function PollSheet({ onClose, onSend }: { onClose: () => void; onSend: (q: string, poll: { options: string[]; multi: boolean; closesAt: string | null }) => void }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [closeKey, setCloseKey] = useState('none');
  const [error, setError] = useState('');
  function submit() {
    const options = opts.map((o) => o.trim()).filter(Boolean);
    if (!q.trim()) return setError('พิมพ์คำถามก่อน');
    if (options.length < 2) return setError('ต้องมีตัวเลือกอย่างน้อย 2 ข้อ');
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return setError('มีตัวเลือกซ้ำกัน');
    const ms = POLL_CLOSE_OPTIONS.find((o) => o.key === closeKey)?.ms ?? null;
    onSend(q, { options, multi, closesAt: ms ? thaiAfter(ms) : null });
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>📊 สร้างโพล</b><button className="link" onClick={onClose}>ปิด</button></div>
        <input value={q} onChange={(e) => { setQ(e.target.value); setError(''); }} maxLength={POLL_QUESTION_MAX} placeholder="คำถาม" autoFocus />
        {opts.map((o, i) => (
          <div key={i} className="poll-edit-row">
            <input value={o} maxLength={POLL_OPTION_MAX} placeholder={`ตัวเลือกที่ ${i + 1}`}
              onChange={(e) => { setOpts((xs) => xs.map((x, k) => (k === i ? e.target.value : x))); setError(''); }} />
            {opts.length > 2 && <button className="link" onClick={() => setOpts((xs) => xs.filter((_, k) => k !== i))} aria-label="ลบตัวเลือกนี้">✕</button>}
          </div>
        ))}
        {opts.length < POLL_MAX_OPTIONS && <button className="btn btn-ghost btn-small" onClick={() => setOpts((xs) => [...xs, ''])}>+ เพิ่มตัวเลือก</button>}
        <label className="row-check"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> เลือกได้หลายข้อ</label>
        <label className="small">ปิดโหวตอัตโนมัติ
          <select value={closeKey} onChange={(e) => setCloseKey(e.target.value)}>
            {POLL_CLOSE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <p className="small muted">ทุกคนในห้องเห็นว่าใครโหวตอะไร · เปลี่ยนคำตอบได้จนกว่าโพลจะปิด</p>
        {error && <p className="error-text small">{error}</p>}
        <button className="btn btn-block" onClick={submit}>ส่งโพล</button>
      </div>
    </div>
  );
}

function PinsSheet({ pins, canPin, onClose, onJump, onUnpin }: {
  pins: RoomPin[]; canPin: boolean; onClose: () => void; onJump: (seq: number) => void; onUnpin: (seq: number) => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>📌 ประกาศ / ปักหมุด ({pins.length}/5)</b><button className="link" onClick={onClose}>ปิด</button></div>
        <ul className="search-results">
          {pins.map((p) => (
            <li key={p.seq} className="pin-item">
              <button onClick={() => onJump(p.seq)}>
                <span className="small muted">{p.sender ?? ''} · ปักเมื่อ {thaiShort(p.at)}</span>
                <span>{p.text}</span>
              </button>
              {canPin && <button className="link small danger-text" onClick={() => onUnpin(p.seq)}>เลิกปัก</button>}
            </li>
          ))}
        </ul>
        {!canPin && <p className="small muted">เลิกปักหมุดได้เฉพาะเจ้าของ/แอดมินห้อง</p>}
      </div>
    </div>
  );
}

