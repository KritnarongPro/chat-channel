// =====================================================================
// LinkEditSheet.tsx — เพิ่ม/แก้ลิงก์ของกลุ่ม (2026-11-18 — เจ้าของ/แอดมินห้อง)
//   วางลิงก์ → ดึงชื่อจากเว็บให้ (/api/link-preview — ดึงไม่ได้บอกเหตุผล ให้พิมพ์เอง)
//   ไอคอน: อัตโนมัติ (เซิร์ฟเวอร์ดึงตอนบันทึก) · อีโมจิ + สี · อัปรูป (ครอปวงกลมเดิม) · ตัวอักษร
//   ข้อมูลไม่ผ่าน/บันทึกไม่ได้ → ขึ้นเหตุผลที่ช่องนั้น หรือแจ้งเตือน (ไม่ปิดแผ่นเงียบ ๆ)
// =====================================================================

import { useMemo, useRef, useState } from 'react';
import {
  LINK_CATEGORY_MAX, LINK_COLORS, LINK_TITLE_MAX, LinkColor, ROOM_LINKS_PINNED_MAX, RoomLink,
} from '../shared/protocol';
import { api, errMsg } from './api';
import LinkIcon from './LinkIcon';
import { useNotify } from './notice';
import PictureCropper from './PictureCropper';

type IconChoice = 'auto' | 'emoji' | 'upload' | 'letter';
const QUICK_EMOJI = ['📊', '🧮', '📄', '🗂', '📦', '🛒', '📅', '💬', '🎨', '🔧', '📈', '🌱'];

export default function LinkEditSheet({ roomId, link, categories, pinnedCount, onClose, onSaved }: {
  roomId: string;
  link: RoomLink | null;            // null = เพิ่มใหม่
  categories: string[];
  pinnedCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const [url, setUrl] = useState(link?.url ?? '');
  const [title, setTitle] = useState(link?.title ?? '');
  const [category, setCategory] = useState<string | null>(link?.category ?? null);
  const [newCat, setNewCat] = useState('');
  const [pinned, setPinned] = useState(link ? link.pinned : pinnedCount < ROOM_LINKS_PINNED_MAX);
  const [icon, setIcon] = useState<IconChoice>(link ? (link.icon.kind === 'auto' ? 'auto' : link.icon.kind) : 'auto');
  const [emoji, setEmoji] = useState(link?.icon.emoji ?? '📊');
  const [color, setColor] = useState<LinkColor>(link?.icon.color ?? 'blue');
  const [upload, setUpload] = useState<Blob | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [fetchNote, setFetchNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadPreview = useMemo(() => (upload ? URL.createObjectURL(upload) : null), [upload]);

  // ---------- ดึงชื่อจากเว็บ (เฉพาะตอนยังไม่ได้ตั้งชื่อ) ----------
  async function fillTitle() {
    const u = url.trim();
    if (!/^https?:\/\/\S+/i.test(u)) return;
    try {
      const p = await api.get<{ status: string; title: string | null; siteName: string | null; error: string | null }>(
        `/api/link-preview?url=${encodeURIComponent(u)}`);
      const t = (p.siteName && p.title && p.title.length > 40 ? p.siteName : p.title ?? p.siteName)?.slice(0, LINK_TITLE_MAX);
      if (p.status === 'ok' && t) {
        if (!title.trim()) setTitle(t);
        setFetchNote({ ok: true, text: `ดึงชื่อจากเว็บแล้ว: ${t}` });
      } else {
        setFetchNote({ ok: false, text: `ดึงชื่ออัตโนมัติไม่ได้ (${p.error ?? 'ไม่มีชื่อในหน้าเว็บ'}) — พิมพ์ชื่อเอง` });
      }
    } catch (e) {
      setFetchNote({ ok: false, text: `ดึงชื่ออัตโนมัติไม่ได้ (${errMsg(e)}) — พิมพ์ชื่อเอง` });
    }
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!/^https?:\/\/\S+$/i.test(url.trim())) e.url = 'ลิงก์ต้องขึ้นต้นด้วย https:// หรือ http://';
    if (!title.trim()) e.title = 'กรุณาตั้งชื่อลิงก์';
    else if ([...title.trim()].length > LINK_TITLE_MAX) e.title = `ชื่อยาวเกิน ${LINK_TITLE_MAX} ตัวอักษร`;
    if (newCat.trim() && [...newCat.trim()].length > LINK_CATEGORY_MAX) e.category = `ชื่อหมวดยาวเกิน ${LINK_CATEGORY_MAX} ตัวอักษร`;
    if (icon === 'upload' && !upload && link?.icon.kind !== 'upload') e.icon = 'เลือกรูปไอคอนก่อน';
    if (icon === 'emoji' && !emoji.trim()) e.icon = 'เลือกอีโมจิ 1 ตัว';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    const iconKind = icon === 'upload' ? (link ? 'keep' : 'letter') : icon;  // อัปรูป = บันทึกลิงก์ก่อน แล้วส่งรูปตาม
    const body = {
      url: url.trim(), title: title.trim(), category: newCat.trim() || category, pinned,
      icon: { kind: iconKind, emoji: icon === 'emoji' ? emoji.trim() : undefined, color },
    };
    try {
      const r = link
        ? await api.post<{ link: RoomLink; warning: string | null }>(`/api/rooms/${encodeURIComponent(roomId)}/links/${link.id}`, body)
        : await api.post<{ link: RoomLink; warning: string | null }>(`/api/rooms/${encodeURIComponent(roomId)}/links`, body);
      if (r.warning) notify('warning', r.warning);
      if (icon === 'upload' && upload) {
        try {
          await api.raw(`/api/rooms/${encodeURIComponent(roomId)}/links/${r.link.id}/icon`, upload, 'image/jpeg');
        } catch (e) {
          notify('warning', `บันทึกลิงก์แล้ว แต่อัปรูปไอคอนไม่สำเร็จ: ${errMsg(e)} — ลองแก้ไขลิงก์แล้วอัปใหม่`);
        }
      }
      notify('success', link ? `แก้ลิงก์ "${r.link.title}" แล้ว` : `เพิ่มลิงก์ "${r.link.title}" แล้ว`);
      onSaved();
      onClose();
    } catch (e) {
      notify('error', `${link ? 'แก้' : 'เพิ่ม'}ลิงก์ไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!link || !confirm(`ลบลิงก์ "${link.title}"? สมาชิกจะไม่เห็นลิงก์นี้อีก`)) return;
    setBusy(true);
    try {
      await api.post(`/api/rooms/${encodeURIComponent(roomId)}/links/${link.id}/delete`);
      notify('success', `ลบลิงก์ "${link.title}" แล้ว`);
      onSaved();
      onClose();
    } catch (e) {
      notify('error', `ลบลิงก์ไม่สำเร็จ: ${errMsg(e)}`);
      setBusy(false);
    }
  }

  const previewIcon = icon === 'upload' && uploadPreview
    ? { kind: 'upload' as const, pictureUrl: uploadPreview, emoji: null, color }
    : icon === 'upload' && link?.icon.kind === 'upload'
      ? link.icon
      : icon === 'auto' && link?.icon.kind === 'auto' && link.url === url.trim()
        ? link.icon
        : { kind: icon === 'emoji' ? 'emoji' as const : 'letter' as const, pictureUrl: null, emoji: icon === 'emoji' ? emoji : null, color };

  // ตัวครอปอยู่นอกพื้นหลังของแผ่นนี้ — ไม่งั้นแตะในตัวครอปแล้วแผ่นเพิ่มลิงก์ปิดตาม
  return (
    <>
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet link-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>{link ? 'แก้ไขลิงก์' : 'เพิ่มลิงก์'}</b><button className="link" disabled={busy} onClick={onClose}>ยกเลิก</button></div>

        <label className="field">
          <span className="small muted">ลิงก์</span>
          <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={url} placeholder="https://"
            onChange={(e) => { setUrl(e.target.value); setErrors((x) => ({ ...x, url: '' })); }} onBlur={() => void fillTitle()} />
          {errors.url && <span className="small error-text">{errors.url}</span>}
          {fetchNote && <span className={`small ${fetchNote.ok ? 'ok-text' : 'muted'}`}>{fetchNote.text}</span>}
        </label>

        <label className="field">
          <span className="small muted">ชื่อที่แสดง</span>
          <input value={title} maxLength={80} placeholder="เช่น ระบบสต๊อก" onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: '' })); }} />
          {errors.title && <span className="small error-text">{errors.title}</span>}
        </label>

        <div className="field">
          <span className="small muted">หมวด</span>
          <div className="seg">
            <button type="button" className={`chip ${category === null && !newCat ? 'on' : ''}`} onClick={() => { setCategory(null); setNewCat(''); }}>ไม่มีหมวด</button>
            {categories.map((c) => (
              <button type="button" key={c} className={`chip ${category === c && !newCat ? 'on' : ''}`} onClick={() => { setCategory(c); setNewCat(''); }}>{c}</button>
            ))}
          </div>
          <input value={newCat} maxLength={60} placeholder="หรือพิมพ์หมวดใหม่" onChange={(e) => setNewCat(e.target.value)} />
          {errors.category && <span className="small error-text">{errors.category}</span>}
        </div>

        <div className="field">
          <span className="small muted">ไอคอน</span>
          <div className="link-icon-row">
            <LinkIcon icon={previewIcon} title={title || '?'} size={52} />
            <div className="seg">
              {(['auto', 'emoji', 'upload', 'letter'] as const).map((k) => (
                <button type="button" key={k} className={`chip ${icon === k ? 'on' : ''}`} onClick={() => { setIcon(k); setErrors((x) => ({ ...x, icon: '' })); }}>
                  {k === 'auto' ? 'จากเว็บ' : k === 'emoji' ? 'อีโมจิ' : k === 'upload' ? 'อัปรูป' : 'ตัวอักษร'}
                </button>
              ))}
            </div>
          </div>
          {icon === 'auto' && <span className="small muted">ระบบดึงไอคอนของเว็บตอนบันทึก — ดึงไม่ได้จะใช้ตัวอักษรและบอกเหตุผล</span>}
          {icon === 'emoji' && (
            <div className="emoji-pick">
              {QUICK_EMOJI.map((e) => (
                <button type="button" key={e} className={emoji === e ? 'on' : ''} onClick={() => setEmoji(e)} aria-label={`อีโมจิ ${e}`}>{e}</button>
              ))}
              <input value={QUICK_EMOJI.includes(emoji) ? '' : emoji} maxLength={8} placeholder="อื่น ๆ" aria-label="พิมพ์อีโมจิอื่น"
                onChange={(e) => setEmoji(e.target.value)} />
            </div>
          )}
          {icon === 'upload' && (
            <>
              <button type="button" className="btn btn-small" onClick={() => fileInput.current?.click()}>🖼 {upload || link?.icon.kind === 'upload' ? 'เปลี่ยนรูป' : 'เลือกรูป'}</button>
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCropFile(f); }} />
            </>
          )}
          {(icon === 'emoji' || icon === 'letter') && (
            <div className="color-pick" role="radiogroup" aria-label="สีพื้นไอคอน">
              {LINK_COLORS.map((c) => (
                <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={`สี ${c}`}
                  className={`link-c-${c} ${color === c ? 'on' : ''}`} onClick={() => setColor(c)} />
              ))}
            </div>
          )}
          {errors.icon && <span className="small error-text">{errors.icon}</span>}
        </div>

        <label className="row-check">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)}
            disabled={!pinned && !link?.pinned && pinnedCount >= ROOM_LINKS_PINNED_MAX} />
          <span>ปักไว้บนแถบลิงก์ด่วนในห้อง{!pinned && !link?.pinned && pinnedCount >= ROOM_LINKS_PINNED_MAX ? ` (เต็ม ${ROOM_LINKS_PINNED_MAX} อันแล้ว)` : ''}</span>
        </label>

        <button className="btn btn-block" disabled={busy} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        {link && <button className="btn btn-ghost btn-block danger-text" disabled={busy} onClick={() => void remove()}>🗑 ลบลิงก์นี้</button>}
      </div>
    </div>
      {cropFile && (
        <PictureCropper file={cropFile} title="ไอคอนลิงก์" onCancel={() => setCropFile(null)}
          onDone={(b) => { setUpload(b); setCropFile(null); setErrors((x) => ({ ...x, icon: '' })); }} />
      )}
    </>
  );
}
