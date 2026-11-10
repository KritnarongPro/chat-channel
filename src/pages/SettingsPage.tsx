// =====================================================================
// SettingsPage.tsx — ตั้งค่าแจ้งเตือน: สถานะเครื่องนี้, ส่งทดสอบ, รายการเครื่อง + เหตุผลที่ส่งไม่สำเร็จล่าสุด
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { thaiClock, thaiDate } from '../../shared/time';
import { api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';
import { PushState, currentEndpoint, disablePush, enablePush, getPushState } from '../pwa';
import SetupCard from '../SetupCard';

interface Device {
  id: string; endpoint: string; label: string | null; createdAt: string; lastSuccessAt: string | null;
  lastError: string | null; lastErrorAt: string | null; failCount: number;
}
const STATE_TH: Record<PushState, string> = {
  on: 'เปิดอยู่', off: 'ปิดอยู่', denied: 'ถูกปิดสิทธิ์ในเครื่อง', 'need-install': 'ต้องติดตั้งแอปก่อน (iPhone)', unsupported: 'เบราว์เซอร์ไม่รองรับ',
};
const when = (iso: string | null) => (iso ? `${thaiDate(iso)} ${thaiClock(iso)}` : '-');

export default function SettingsPage() {
  const notify = useNotify();
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await getPushState());
      setMine(await currentEndpoint());
      setDevices((await api.get<{ devices: Device[] }>('/api/push/devices')).devices);
      setError('');
    } catch (e) {
      setError(`โหลดสถานะแจ้งเตือนไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    try {
      await fn();
      notify('success', okText);
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await api.post<{ sent: number; failed: number; errors: string[] }>('/api/push/test');
      if (r.failed) notify('warning', `ส่งได้ ${r.sent} เครื่อง ไม่สำเร็จ ${r.failed} เครื่อง: ${r.errors[0] ?? ''}`);
      else notify('success', `ส่งแจ้งเตือนทดสอบแล้ว ${r.sent} เครื่อง — ถ้าไม่เด้ง ดูว่าเครื่องปิดเสียง/โหมดโฟกัสอยู่ไหม`);
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusy(false);
      void load();
    }
  }

  return (
    <div className="page">
      <TopBar title="ตั้งค่าแจ้งเตือน" back="/" />
      <SetupCard />
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      <div className="form-block">
        <div>เครื่องนี้: <b>{state ? STATE_TH[state] : '…'}</b></div>
        {state === 'off' && <button className="btn" disabled={busy} onClick={() => void run(enablePush, 'เปิดแจ้งเตือนแล้ว')}>🔔 เปิดแจ้งเตือนเครื่องนี้</button>}
        {state === 'on' && (
          <div className="row-actions">
            <button className="btn" disabled={busy} onClick={() => void test()}>ส่งแจ้งเตือนทดสอบ</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => void run(disablePush, 'ปิดแจ้งเตือนเครื่องนี้แล้ว')}>ปิดแจ้งเตือนเครื่องนี้</button>
          </div>
        )}
        <p className="small muted">ปิดเสียงรายห้องได้ที่ปุ่ม 🔔 มุมขวาบนในแต่ละห้อง</p>
      </div>

      <h3 className="section-title">เครื่องที่รับแจ้งเตือน</h3>
      {devices?.length === 0 && <p className="center muted">ยังไม่มีเครื่องที่เปิดแจ้งเตือน</p>}
      <ul className="user-list">
        {devices?.map((d) => (
          <li key={d.id} className="user-item admin-user">
            <div className="grow">
              <div>{d.label ?? 'ไม่ทราบชื่อเครื่อง'}{d.endpoint === mine && <span className="small muted"> · เครื่องนี้</span>}</div>
              <div className="small muted">ส่งสำเร็จล่าสุด {when(d.lastSuccessAt)}</div>
              {d.lastError && (
                <div className="small error-text">ส่งไม่สำเร็จล่าสุด {when(d.lastErrorAt)} ({d.failCount} ครั้งติด): {d.lastError}</div>
              )}
            </div>
            <button
              className="btn btn-small btn-ghost"
              disabled={busy}
              onClick={() => void run(() => api.post('/api/push/unsubscribe', { id: d.id }), 'เอาเครื่องออกแล้ว')}
            >
              เอาออก
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
