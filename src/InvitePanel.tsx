// =====================================================================
// InvitePanel.tsx — จัดการลิงก์เชิญของกลุ่ม/ชาเนล (เจ้าของ/แอดมินห้อง)
// สร้าง (อายุ + จำนวนคน) · คัดลอก · แชร์ไป LINE · QR code · ยกเลิก · ดูว่าใครเข้ามาผ่านลิงก์ไหน
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { thaiClock, thaiDate } from '../shared/time';
import { api, errMsg } from './api';
import { useNotify } from './notice';

interface Invite {
  code: string; url: string; createdBy: string; createdAt: string; expiresAt: string | null; maxUses: number | null;
  useCount: number; revokedAt: string | null; problem: string | null; joined: { name: string; at: string }[];
}
const when = (iso: string) => `${thaiDate(iso)} ${thaiClock(iso)}`;

export default function InvitePanel({ roomId, roomTitle }: { roomId: string; roomTitle: string }) {
  const notify = useNotify();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState('');
  const [expiresIn, setExpiresIn] = useState('7d');
  const [maxUses, setMaxUses] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ code: string; dataUrl: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setInvites((await api.get<{ invites: Invite[] }>(`/api/rooms/${encodeURIComponent(roomId)}/invites`)).invites);
      setError('');
    } catch (e) {
      setError(`โหลดลิงก์เชิญไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, [roomId]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (maxUses && !/^\d+$/.test(maxUses)) { notify('error', 'จำนวนคนต้องเป็นตัวเลข หรือเว้นว่าง = ไม่จำกัด'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ url: string }>(`/api/rooms/${encodeURIComponent(roomId)}/invites`, { expiresIn, maxUses: maxUses || null });
      await copy(r.url, 'สร้างลิงก์แล้ว และคัดลอกให้แล้ว');
      setMaxUses('');
      await load();
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, okText = 'คัดลอกลิงก์แล้ว') {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', okText);
    } catch (err) {
      console.error(err);
      notify('warning', 'คัดลอกอัตโนมัติไม่ได้ — กดค้างที่ลิงก์แล้วคัดลอกเอง');
    }
  }

  async function revoke(inv: Invite) {
    if (!confirm('ยกเลิกลิงก์นี้? คนที่ยังไม่ได้กดจะเข้าไม่ได้อีก (คนที่เข้ามาแล้วยังอยู่)')) return;
    try {
      await api.post(`/api/rooms/${encodeURIComponent(roomId)}/invites/${encodeURIComponent(inv.code)}/revoke`);
      notify('success', 'ยกเลิกลิงก์แล้ว');
      await load();
    } catch (e) {
      notify('error', errMsg(e));
    }
  }

  async function showQr(inv: Invite) {
    try {
      setQr({ code: inv.code, dataUrl: await QRCode.toDataURL(inv.url, { width: 260, margin: 1 }) });
    } catch (err) {
      console.error(err);
      notify('error', 'สร้าง QR code ไม่สำเร็จ');
    }
  }

  const shareText = (url: string) => `เชิญเข้าร่วม "${roomTitle}" ในแชทส่วนตัว\n${url}`;

  return (
    <div className="invite-panel">
      <b>ลิงก์เชิญ</b>
      <div className="row-actions">
        <select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} aria-label="อายุลิงก์">
          <option value="1d">หมดอายุใน 1 วัน</option>
          <option value="7d">หมดอายุใน 7 วัน</option>
          <option value="30d">หมดอายุใน 30 วัน</option>
          <option value="never">ไม่หมดอายุ</option>
        </select>
        <input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" placeholder="จำนวนคน (ว่าง = ไม่จำกัด)" />
      </div>
      <button className="btn btn-block" disabled={busy} onClick={() => void create()}>{busy ? 'กำลังสร้าง…' : '+ สร้างลิงก์เชิญ'}</button>
      <p className="small muted">คนที่กดลิงก์และล็อกอิน LINE จะได้รับอนุมัติเข้าระบบทันที — ส่งลิงก์ให้เฉพาะคนที่ต้องการ</p>

      {error && <p className="error-text small">{error}</p>}
      {invites?.map((inv) => {
        const dead = !!inv.problem;
        return (
          <div key={inv.code} className={`invite-item ${dead ? 'dead' : ''}`}>
            <code className="token">{inv.url}</code>
            <div className="small muted">
              ใช้แล้ว {inv.useCount}{inv.maxUses ? `/${inv.maxUses}` : ''} คน · {inv.expiresAt ? `หมดอายุ ${when(inv.expiresAt)}` : 'ไม่หมดอายุ'} · สร้างโดย {inv.createdBy}
            </div>
            {dead && <div className="small error-text">ใช้ไม่ได้แล้ว: {inv.problem}</div>}
            {inv.joined.length > 0 && (
              <details className="small">
                <summary>ใครเข้ามาผ่านลิงก์นี้ ({inv.joined.length})</summary>
                <ul>{inv.joined.map((j) => <li key={j.name + j.at}>{j.name} · {when(j.at)}</li>)}</ul>
              </details>
            )}
            {!dead && (
              <div className="row-actions wrap">
                <button className="btn btn-small" onClick={() => void copy(inv.url)}>คัดลอก</button>
                <a className="btn btn-small btn-line-small" href={`https://line.me/R/share?text=${encodeURIComponent(shareText(inv.url))}`} target="_blank" rel="noreferrer">แชร์ไป LINE</a>
                <button className="btn btn-small btn-ghost" onClick={() => void showQr(inv)}>QR code</button>
                <button className="btn btn-small btn-ghost error-text" onClick={() => void revoke(inv)}>ยกเลิกลิงก์</button>
              </div>
            )}
            {qr?.code === inv.code && (
              <div className="qr">
                <img src={qr.dataUrl} alt={`QR code ลิงก์เชิญ ${roomTitle}`} width={260} height={260} />
                <button className="link" onClick={() => setQr(null)}>ซ่อน QR</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
