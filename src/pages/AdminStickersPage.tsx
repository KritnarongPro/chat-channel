// =====================================================================
// AdminStickersPage.tsx — แอดมินระบบจัดการสติกเกอร์ (เฟส 5)
//   สร้างชุด → อัปภาพ (PNG/WEBP/GIF ไม่เกิน 512 KB เลือกหลายไฟล์ได้) → เปิด/ปิดชุดหรือรายภาพ
//   ปิดใช้ = ส่งใหม่ไม่ได้ แต่ข้อความเก่าในแชทยังแสดงได้ · ภาพต้องเป็นของเราเอง (ห้ามใช้สติกเกอร์ LINE ฯลฯ)
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { StickerPack, api, errMsg, stickerUrl } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';

const TYPES = ['image/png', 'image/webp', 'image/gif'];
const MAX = 512 * 1024;

export default function AdminStickersPage() {
  const notify = useNotify();
  const [packs, setPacks] = useState<StickerPack[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');

  const load = useCallback(async () => {
    try {
      setPacks((await api.get<{ packs: StickerPack[] }>('/api/admin/stickers')).packs);
      setError('');
    } catch (e) {
      setError(`โหลดสติกเกอร์ไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createPack() {
    setBusy('new');
    try {
      await api.post('/api/admin/stickers/packs', { name });
      notify('success', 'สร้างชุดสติกเกอร์แล้ว — อัปภาพได้เลย');
      setName('');
      await load();
    } catch (e) {
      notify('error', `สร้างชุดไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy('');
    }
  }

  async function upload(pack: StickerPack, files: FileList | null) {
    if (!files?.length) return;
    setBusy(pack.id);
    const failed: string[] = [];
    let okCount = 0;
    const list = [...files];
    for (const [i, f] of list.entries()) {
      setProgress(`กำลังอัป ${i + 1}/${list.length}: ${f.name}`);
      if (!TYPES.includes(f.type)) { failed.push(`${f.name}: รองรับเฉพาะ PNG, WEBP, GIF`); continue; }
      if (f.size > MAX) { failed.push(`${f.name}: ใหญ่เกิน 512 KB (${Math.round(f.size / 1024)} KB)`); continue; }
      try {
        await api.raw(`/api/admin/stickers/packs/${encodeURIComponent(pack.id)}/upload`, f, f.type);
        okCount += 1;
      } catch (e) {
        failed.push(`${f.name}: ${errMsg(e)}`);
      }
    }
    setProgress('');
    setBusy('');
    if (okCount) notify('success', `อัปสติกเกอร์สำเร็จ ${okCount} ภาพ`);
    if (failed.length) notify('error', `อัปไม่สำเร็จ ${failed.length} ภาพ — ${failed.join(' · ')}`);
    await load();
  }

  async function toggle(path: string, active: boolean, id: string) {
    setBusy(id);
    try {
      await api.post(path, { active });
      await load();
    } catch (e) {
      notify('error', `บันทึกไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="page">
      <TopBar title="แอดมิน: สติกเกอร์" back="/admin" />
      <div className="form-block">
        <div className="row">
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="ชื่อชุดใหม่ เช่น แมวเหมียว" />
          <button className="btn" disabled={busy === 'new' || !name.trim()} onClick={() => void createPack()}>สร้างชุด</button>
        </div>
        <p className="small muted">ภาพ PNG / WEBP / GIF (ขยับได้) ไม่เกิน 512 KB · แนะนำสี่เหลี่ยม 320×320 พื้นโปร่งใส · ใช้ภาพที่เราเป็นเจ้าของหรือได้รับอนุญาตเท่านั้น</p>
        {progress && <p className="small">{progress}</p>}
      </div>
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {packs === null && !error && <p className="center muted">กำลังโหลด…</p>}
      {packs?.length === 0 && <p className="center muted">ยังไม่มีชุดสติกเกอร์</p>}
      {packs?.map((p) => (
        <div key={p.id} className="note-card">
          <div className="row">
            <b className="grow">{p.name} {!p.active && <span className="small muted">(ปิดใช้)</span>}</b>
            <label className="btn btn-small">
              + อัปภาพ
              <input type="file" accept={TYPES.join(',')} multiple hidden disabled={busy === p.id}
                onChange={(e) => { void upload(p, e.target.files); e.target.value = ''; }} />
            </label>
            <button className="btn btn-small btn-ghost" disabled={busy === p.id}
              onClick={() => void toggle(`/api/admin/stickers/packs/${encodeURIComponent(p.id)}`, !p.active, p.id)}>
              {p.active ? 'ปิดชุด' : 'เปิดชุด'}
            </button>
          </div>
          {p.stickers.length === 0 && <span className="small muted">ยังไม่มีภาพ — ชุดที่ไม่มีภาพจะไม่แสดงให้ผู้ใช้</span>}
          <div className="sticker-grid">
            {p.stickers.map((s) => (
              <button key={s.id} title={s.active ? 'แตะเพื่อปิดภาพนี้' : 'แตะเพื่อเปิดภาพนี้'} disabled={busy === s.id}
                style={{ opacity: s.active ? 1 : 0.35 }}
                onClick={() => void toggle(`/api/admin/stickers/${encodeURIComponent(s.id)}`, !s.active, s.id)}>
                <img src={stickerUrl(s.id)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
