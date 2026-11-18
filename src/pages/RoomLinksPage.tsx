// =====================================================================
// RoomLinksPage.tsx — หน้ารวมลิงก์ของกลุ่ม/ชาเนล (2026-11-18)
//   แบ่งตามหมวด · แตะ = เปิดลิงก์ (แท็บใหม่) · เจ้าของ/แอดมินห้อง: + เพิ่ม และ ⋯ แก้/ลบ/ปัก
//   เปิดจาก: แถบลิงก์ด่วน "ทั้งหมด" หรือ ⋯ ในห้อง → ลิงก์ของกลุ่ม
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { RoomLink } from '../../shared/protocol';
import { api, errMsg } from '../api';
import { TopBar } from '../components';
import LinkEditSheet from '../LinkEditSheet';
import LinkIcon from '../LinkIcon';
import Loading from '../Loading';

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export default function RoomLinksPage() {
  const { id = '' } = useParams();
  const [links, setLinks] = useState<RoomLink[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RoomLink | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ links: RoomLink[]; canEdit: boolean }>(`/api/rooms/${encodeURIComponent(id)}/links`);
      setLinks(d.links);
      setCanEdit(d.canEdit);
      setError('');
    } catch (e) {
      setError(`โหลดลิงก์ไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const categories = [...new Set((links ?? []).map((l) => l.category).filter((c): c is string => !!c))];
  const groups: [string, RoomLink[]][] = [
    ...categories.map((c) => [c, (links ?? []).filter((l) => l.category === c)] as [string, RoomLink[]]),
    ['ทั่วไป', (links ?? []).filter((l) => !l.category)],
  ].filter(([, ls]) => ls.length > 0) as [string, RoomLink[]][];
  const pinnedCount = (links ?? []).filter((l) => l.pinned).length;

  return (
    <div className="page">
      <TopBar title="ลิงก์ของกลุ่ม" back={`/room/${encodeURIComponent(id)}`}
        right={canEdit ? <button className="btn btn-small btn-ghost" onClick={() => setEditing('new')}>＋ เพิ่ม</button> : null} />
      {error && <div className="banner banner-error" role="alert">{error} <button className="link" onClick={() => void load()}>ลองใหม่</button></div>}
      {links === null && !error && <Loading variant="list" onRetry={() => void load()} />}
      {links?.length === 0 && (
        <div className="center">
          <div className="empty-pane-icon" aria-hidden="true">🔗</div>
          {canEdit ? (
            <>
              <p className="muted">รวมลิงก์แอปทำงาน เอกสาร หรือเว็บที่ใช้บ่อยไว้ให้ทุกคนในกลุ่มกดใช้</p>
              <button className="btn" onClick={() => setEditing('new')}>＋ เพิ่มลิงก์แรก</button>
            </>
          ) : <p className="muted">เจ้าของ/แอดมินยังไม่ได้เพิ่มลิงก์</p>}
        </div>
      )}
      {groups.map(([name, ls]) => (
        <section key={name}>
          <h3 className="section-title small muted">{name}</h3>
          <ul className="link-list">
            {ls.map((l) => (
              <li key={l.id}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="link-row">
                  <LinkIcon icon={l.icon} title={l.title} />
                  <span className="grow">
                    <b className="ellipsis">{l.title}</b>
                    <span className="small muted ellipsis">{hostOf(l.url)}</span>
                  </span>
                  {l.pinned && <span className="small link-pin" title="ปักไว้บนแถบลิงก์ด่วน" aria-label="ปักไว้บนแถบด่วน">📌</span>}
                  <span className="muted" aria-hidden="true">↗</span>
                </a>
                {canEdit && (
                  <button className="icon-btn link-more" onClick={() => setEditing(l)} aria-label={`แก้ไข ${l.title}`}>⋯</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {links && links.length > 0 && canEdit && (
        <p className="small muted pad">📌 = อยู่บนแถบลิงก์ด่วนในห้อง ({pinnedCount}/8) · แตะ ⋯ เพื่อแก้ไข ปัก หรือลบ</p>
      )}
      {editing && (
        <LinkEditSheet roomId={id} link={editing === 'new' ? null : editing} categories={categories}
          pinnedCount={pinnedCount} onClose={() => setEditing(null)} onSaved={() => void load()} />
      )}
    </div>
  );
}
