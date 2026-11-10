// =====================================================================
// OrdersPage.tsx — ออเดอร์: แอดมินเห็นทั้งหมด + เปลี่ยนสถานะ (ลูกค้าได้ข้อความแจ้งในห้อง) · ผู้ใช้ทั่วไปเห็นของตัวเอง
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ORDER_STATUS_TH, OrderStatus } from '../../shared/forms';
import { thaiClock, thaiDate } from '../../shared/time';
import { Order, api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';

const STATUSES = Object.keys(ORDER_STATUS_TH) as OrderStatus[];

export default function OrdersPage() {
  const notify = useNotify();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filter, setFilter] = useState<OrderStatus | ''>('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ orders: Order[]; isAdmin: boolean }>(`/api/orders${filter ? `?status=${filter}` : ''}`);
      setOrders(d.orders);
      setIsAdmin(d.isAdmin);
      setError('');
    } catch (e) {
      setError(`โหลดออเดอร์ไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function change(o: Order, status: OrderStatus) {
    const note = status === 'cancelled' || status === 'done'
      ? prompt(`หมายเหตุถึงลูกค้า (ไม่ใส่ก็ได้) — ออเดอร์ #${o.id}: ${ORDER_STATUS_TH[status]}`) ?? ''
      : '';
    setBusyId(o.id);
    try {
      const r = await api.post<{ warnings: string[] }>(`/api/orders/${o.id}/status`, { status, note });
      notify('success', `ออเดอร์ #${o.id}: ${ORDER_STATUS_TH[status]} — แจ้งลูกค้าในห้องแล้ว`);
      for (const w of r.warnings) notify('warning', w);
      await load();
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusyId(0);
    }
  }

  return (
    <div className="page">
      <TopBar title={isAdmin ? 'ออเดอร์ทั้งหมด' : 'ออเดอร์ของฉัน'} back="/" />
      <div className="chips">
        <button className={`chip ${filter === '' ? 'on' : ''}`} onClick={() => setFilter('')}>ทั้งหมด</button>
        {STATUSES.map((s) => <button key={s} className={`chip ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>{ORDER_STATUS_TH[s]}</button>)}
      </div>
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {orders === null && !error && <p className="center muted">กำลังโหลด…</p>}
      {orders?.length === 0 && <p className="center muted">ไม่มีออเดอร์</p>}
      {orders?.map((o) => (
        <div key={o.id} className="order-card">
          <div className="room-top">
            <b>#{o.id} · {o.formTitle}</b>
            <span className={`status status-${o.status}`}>{o.statusText}</span>
          </div>
          <div className="small muted">
            {o.userName} · {thaiDate(o.createdAt)} {thaiClock(o.createdAt)} · <Link to={`/room/${o.roomId}`}>{o.roomTitle ?? 'ห้องแชท'}</Link>
          </div>
          <table className="order-items"><tbody>
            {o.items.map((it) => <tr key={it.id}><td>{it.label}</td><td>{it.value ?? '-'}</td></tr>)}
          </tbody></table>
          {o.statusNote && <div className="small">หมายเหตุ: {o.statusNote}</div>}
          {isAdmin && (
            <div className="row-actions wrap">
              {STATUSES.filter((s) => s !== o.status).map((s) => (
                <button key={s} className={`btn btn-small ${s === 'cancelled' ? 'btn-ghost' : ''}`} disabled={busyId === o.id} onClick={() => void change(o, s)}>
                  {ORDER_STATUS_TH[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
