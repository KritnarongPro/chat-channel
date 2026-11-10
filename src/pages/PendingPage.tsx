// =====================================================================
// PendingPage.tsx — บัญชีรออนุมัติ
// ถ้ายังไม่มีแอดมินเลย → กรอก SETUP_TOKEN เพื่อเป็นแอดมินคนแรก (ทำได้ครั้งเดียว)
// =====================================================================

import { FormEvent, useState } from 'react';
import { api, errMsg } from '../api';
import { useMe } from '../me';
import { useNotify } from '../notice';

export default function PendingPage() {
  const { me, reload, logout } = useMe();
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function claim(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) { setError('กรุณากรอกรหัสตั้งค่า'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/setup/claim-admin', { token: token.trim() });
      notify('success', 'ตั้งเป็นแอดมินเรียบร้อย');
      await reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <h2>สวัสดี {me.user.displayName}</h2>
      <p>บัญชีของคุณ <b>รอแอดมินอนุมัติ</b> — เมื่ออนุมัติแล้วกด "ตรวจอีกครั้ง"</p>
      <button className="btn" onClick={() => void reload()}>ตรวจอีกครั้ง</button>

      {!me.hasAdmin && (
        <form className="card" onSubmit={claim}>
          <p className="small">ระบบยังไม่มีแอดมิน — ถ้าคุณคือผู้ดูแล ให้กรอก SETUP_TOKEN ที่ตั้งไว้ใน Cloudflare</p>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="รหัสตั้งค่า (SETUP_TOKEN)" />
          {error && <p className="error-text">{error}</p>}
          <button className="btn" disabled={busy}>{busy ? 'กำลังตรวจ…' : 'เป็นแอดมินคนแรก'}</button>
        </form>
      )}

      <button className="btn btn-ghost" onClick={() => void logout()}>ออกจากระบบ</button>
    </div>
  );
}
