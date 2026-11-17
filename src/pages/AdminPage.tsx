// =====================================================================
// AdminPage.tsx — แอดมิน: อนุมัติ / ระงับ / คืนสถานะผู้ใช้
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { thaiDate, thaiClock } from '../../shared/time';
import { User, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import { useNotify } from '../notice';
import Loading from '../Loading';

type AdminUser = User & { createdAt: string; loginVia: string[]; email: string | null };
const STATUS_TH: Record<User['status'], string> = { pending: 'รออนุมัติ', active: 'ใช้งานได้', blocked: 'ถูกระงับ' };

export default function AdminPage() {
  const { me } = useMe();
  const notify = useNotify();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      setUsers((await api.get<{ users: AdminUser[] }>('/api/admin/users')).users);
      setError('');
    } catch (e) {
      setError(`โหลดรายชื่อไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => {
    void load();
    // มีคนสมัครใหม่ระหว่างเปิดหน้านี้ (แจ้งแอดมิน 2026-11-17) → โหลดรายชื่อใหม่
    const onAdmin = () => void load();
    window.addEventListener('admin-activity', onAdmin);
    return () => window.removeEventListener('admin-activity', onAdmin);
  }, [load]);
  const pendingN = users?.filter((u) => u.status === 'pending').length ?? 0;

  async function setStatus(u: AdminUser, status: User['status']) {
    setBusyId(u.id);
    try {
      await api.post(`/api/admin/users/${encodeURIComponent(u.id)}/status`, { status });
      notify('success', `${u.displayName}: ${STATUS_TH[status]}`);
      await load();
    } catch (e) {
      notify('error', `เปลี่ยนสถานะ ${u.displayName} ไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="page">
      <TopBar title="แอดมิน: ผู้ใช้" back="/" />
      <div className="chips">
        <Link className="chip" to="/admin/bots">🤖 บอท</Link>
        <Link className="chip" to="/admin/forms">📝 ฟอร์ม</Link>
        <Link className="chip" to="/admin/stickers">😺 สติกเกอร์</Link>
        <Link className="chip" to="/orders">📦 ออเดอร์</Link>
      </div>
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {users === null && !error && <Loading variant="list" />}
      {pendingN > 0 && <div className="banner banner-warning">🆕 รออนุมัติ {pendingN} คน (อยู่บนสุดของรายการ)</div>}
      <ul className="user-list">
        {users?.map((u) => (
          <li key={u.id} className="user-item admin-user">
            <Avatar name={u.displayName} url={u.pictureUrl} size={36} />
            <div className="grow">
              <div>{u.displayName}{u.role === 'admin' && <span className="small muted"> · แอดมิน</span>}</div>
              <div className="small muted">
                {STATUS_TH[u.status]} · สมัคร {thaiDate(u.createdAt)} {thaiClock(u.createdAt)}
              </div>
              <div className="small muted">เข้าด้วย {u.loginVia.join(' + ') || '—'}{u.email ? ` · ${u.email}` : ''}</div>
            </div>
            {u.id !== me.user.id && (
              <div className="row-actions">
                {u.status !== 'active' && (
                  <button className="btn btn-small" disabled={busyId === u.id} onClick={() => void setStatus(u, 'active')}>อนุมัติ</button>
                )}
                {u.status !== 'blocked' && (
                  <button className="btn btn-small btn-danger" disabled={busyId === u.id} onClick={() => void setStatus(u, 'blocked')}>ระงับ</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
