// =====================================================================
// MessageContent.tsx — แสดงเนื้อหาข้อความตามชนิด: ข้อความ / รูป / ไฟล์ / เสียง / สติกเกอร์ (เฟส 5)
// ไฟล์ครบ 180 วัน → "ไฟล์หมดอายุ" · เปิด/เล่นไม่ได้ → บอกเหตุผล + ทางเลือกดาวน์โหลด
// ชุด 2 (2026-11-17): วิดีโอ · ลิงก์ในข้อความกดได้ + ตัวอย่างลิงก์แรก (รูปผ่านเซิร์ฟเวอร์เรา)
// =====================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ChatMessage } from '../shared/protocol';
import { FILE_RETENTION_DAYS } from '../shared/protocol';
import { nowThai } from '../shared/time';
import { formatDuration, formatSize } from './media';
import { LinkPreviewInfo, api, errMsg, stickerUrl } from './api';

export default function MessageContent({ m, roomId }: { m: ChatMessage; roomId: string }) {
  const [broken, setBroken] = useState(false);
  const f = m.file;
  const caption = m.body ? <div className="bubble-body">{m.body}</div> : null;

  // ---------- เฟส 4: การ์ดฟอร์ม → กดเปิดหน้ากรอก ----------
  if (m.kind === 'form') {
    return (
      <>
        {caption}
        <div className="form-card">
          <div className="small muted">📝 ฟอร์ม</div>
          <b>{m.extra?.formTitle ?? 'ฟอร์ม'}</b>
          {m.extra?.formId
            ? <Link className="btn btn-small" to={`/form/${encodeURIComponent(m.extra.formId)}?room=${encodeURIComponent(roomId)}`}>กรอกฟอร์ม</Link>
            : <span className="small error-text">การ์ดฟอร์มนี้ไม่มีรหัสฟอร์ม</span>}
        </div>
      </>
    );
  }
  // ---------- เฟส 5: สติกเกอร์ · ข้อความแจ้งโน้ตใหม่ ----------
  if (m.kind === 'sticker') {
    return m.extra?.stickerId
      ? <img className="sticker-img" src={stickerUrl(m.extra.stickerId)} alt="สติกเกอร์" loading="lazy" />
      : <span className="small error-text">สติกเกอร์นี้ไม่มีรหัสภาพ</span>;
  }
  if (m.kind === 'text' && m.extra?.noteId) {
    return (
      <>
        <div className="bubble-body">{m.body}</div>
        <Link className="small" to={`/note/${encodeURIComponent(m.extra.noteId)}`}>เปิดโน้ต</Link>
      </>
    );
  }
  // ข้อความแจ้งออเดอร์ → ลิงก์ไปหน้าออเดอร์
  if (m.kind === 'text' && m.extra?.orderId) {
    return (
      <>
        <div className="bubble-body">{m.body}</div>
        <Link className="small" to="/orders">ดูออเดอร์</Link>
      </>
    );
  }

  if (m.kind === 'text' || !f) {
    const link = firstUrl(m.body);
    return (
      <>
        <div className="bubble-body"><Linkified text={m.body} /></div>
        {link && <LinkPreview url={link} />}
      </>
    );
  }

  const url = `/api/files/${encodeURIComponent(f.id)}`;
  if (f.expiresAt && f.expiresAt < nowThai()) {
    return (
      <>
        <div className="file-expired">ไฟล์หมดอายุแล้ว (เก็บไว้ {FILE_RETENTION_DAYS} วัน){f.name ? ` · ${f.name}` : ''}</div>
        {caption}
      </>
    );
  }

  if (m.kind === 'image') {
    return (
      <>
        {broken ? (
          <div className="file-broken">โหลดรูปไม่สำเร็จ — <a href={url} target="_blank" rel="noreferrer">ลองเปิดอีกครั้ง</a></div>
        ) : (
          <a href={url} target="_blank" rel="noreferrer">
            <img
              className="msg-image"
              src={url}
              alt={f.name}
              loading="lazy"
              width={f.width ?? undefined}
              height={f.height ?? undefined}
              onError={() => setBroken(true)}
            />
          </a>
        )}
        {caption}
      </>
    );
  }

  if (m.kind === 'video') {
    return (
      <>
        {/* #t=0.1 = ให้ iPhone แสดงภาพเฟรมแรกเป็นภาพปก */}
        <video className="msg-video" controls playsInline preload="metadata" src={`${url}#t=0.1`}
          width={f.width ?? undefined} height={f.height ?? undefined} onError={() => setBroken(true)} />
        <div className="small muted">🎬 วิดีโอ{f.durationMs ? ` · ${formatDuration(f.durationMs)}` : ''} · {formatSize(f.size)}</div>
        {broken && (
          <div className="file-broken">
            เครื่องนี้เล่นวิดีโอชนิดนี้ไม่ได้ ({f.mime}{f.mime === 'video/quicktime' ? ' — ไฟล์ .mov จาก iPhone บาง Android เล่นไม่ได้' : ''}) — <a href={url} download={f.name}>ดาวน์โหลดไปเปิด</a>
          </div>
        )}
        {caption}
      </>
    );
  }

  if (m.kind === 'voice') {
    return (
      <>
        <audio className="msg-audio" controls preload="metadata" src={url} onError={() => setBroken(true)} />
        <div className="small muted">
          ข้อความเสียง{f.durationMs ? ` · ${formatDuration(f.durationMs)}` : ''}
        </div>
        {broken && (
          <div className="file-broken">
            เครื่องนี้เล่นเสียงชนิดนี้ไม่ได้ ({f.mime}) — <a href={url} download={f.name}>ดาวน์โหลดไปเปิด</a>
          </div>
        )}
        {caption}
      </>
    );
  }

  return (
    <>
      <a className="file-card" href={url} download={f.name}>
        <span className="file-icon" aria-hidden="true">📄</span>
        <span className="file-info">
          <span className="file-name">{f.name}</span>
          <span className="small muted">{formatSize(f.size)} · แตะเพื่อดาวน์โหลด</span>
        </span>
      </a>
      {caption}
    </>
  );
}

// ---------------------------------------------------------------------
// ลิงก์ในข้อความ (2026-11-17)
// ---------------------------------------------------------------------
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
/** ตัดเครื่องหมายท้ายลิงก์ที่มักเป็นของประโยค เช่น "ดูที่ https://a.com/x)." */
const trimUrl = (u: string) => u.replace(/[).,!?;:'"\]]+$/, '');

export function firstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? trimUrl(m[0]) : null;
}

function Linkified({ text }: { text: string }) {
  const parts: (string | { url: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push({ url });
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => (typeof p === 'string' ? p : <a key={i} href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a>))}</>;
}

// เก็บผลไว้ในหน้าเดียวกัน — ลิงก์เดิมหลายข้อความไม่ต้องถามเซิร์ฟเวอร์ซ้ำ
const previewCache = new Map<string, Promise<LinkPreviewInfo>>();

function LinkPreview({ url }: { url: string }) {
  const [info, setInfo] = useState<LinkPreviewInfo | null>(null);
  const [error, setError] = useState('');
  const [imgBroken, setImgBroken] = useState(false);
  useEffect(() => {
    let alive = true;
    let p = previewCache.get(url);
    if (!p) {
      p = api.get<LinkPreviewInfo>(`/api/link-preview?url=${encodeURIComponent(url)}`);
      previewCache.set(url, p);
      p.catch(() => previewCache.delete(url));  // ไม่สำเร็จ (เช่น เน็ตหลุด) → เปิดใหม่ลองอีกครั้งได้
    }
    p.then((d) => { if (alive) setInfo(d); }).catch((e) => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [url]);

  if (error) return <div className="link-preview-fail small muted">ไม่มีตัวอย่างลิงก์: {error}</div>;
  if (!info) return null;
  if (info.status === 'failed') return <div className="link-preview-fail small muted">ไม่มีตัวอย่างลิงก์: {info.error ?? 'ดึงข้อมูลไม่ได้'}</div>;
  return (
    <a className="link-preview" href={url} target="_blank" rel="noopener noreferrer">
      {info.hasImage && !imgBroken && (
        <img src={`/api/link-preview/image?url=${encodeURIComponent(url)}`} alt="" loading="lazy" onError={() => setImgBroken(true)} />
      )}
      <span className="link-preview-text">
        {info.siteName && <span className="small muted">{info.siteName}</span>}
        {info.title && <b>{info.title}</b>}
        {info.description && <span className="small">{info.description}</span>}
        {info.hasImage && imgBroken && <span className="small muted">(โหลดรูปตัวอย่างไม่ได้)</span>}
      </span>
    </a>
  );
}

