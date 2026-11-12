// =====================================================================
// MessageContent.tsx — แสดงเนื้อหาข้อความตามชนิด: ข้อความ / รูป / ไฟล์ / เสียง / สติกเกอร์ (เฟส 5)
// ไฟล์ครบ 180 วัน → "ไฟล์หมดอายุ" · เปิด/เล่นไม่ได้ → บอกเหตุผล + ทางเลือกดาวน์โหลด
// =====================================================================

import { useState } from 'react';
import { Link } from 'react-router';
import type { ChatMessage } from '../shared/protocol';
import { FILE_RETENTION_DAYS } from '../shared/protocol';
import { nowThai } from '../shared/time';
import { formatDuration, formatSize } from './media';
import { stickerUrl } from './api';

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

  if (m.kind === 'text' || !f) return <div className="bubble-body">{m.body}</div>;

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
