// =====================================================================
// AccountPage.tsx — บัญชีที่ผูก (LINE / Google)
//   ผู้ใช้เลือก: ผูกเองที่หน้านี้ (ไม่จับคู่อีเมลอัตโนมัติ)
//   เข้าด้วย LINE → "ผูก Google" · สมัครด้วย Google → "ผูก LINE" · เลิกผูก Google ได้เมื่อยังมี LINE
//   ผลการผูกกลับมาที่หน้านี้: ?linked=line|google หรือ ?link_error=รหัส (แปลเป็นภาษาไทย)
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { LOGIN_ERRORS, api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';

interface Identities { line: boolean; google: { email: string | null } | null; googleReady: boolean }

export default function AccountPage() {
  const notify = useNotify();
  const nav = useNavigate();
  const [ids, setIds] = useState<Identities | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setIds(await api.get<Identities>('/api/me/identities'));
      setError('');
    } catch (e) {
      setError(`โหลดข้อมูลบัญชีไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);

  useEffect(() => {
    // ผลจากการผูกบัญชี → แจ้งครั้งเดียวแล้วล้างออกจาก URL
    const qs = new URLSearchParams(location.search);
    const linked = qs.get('linked');
    const err = qs.get('link_error');
    if (linked) notify('success', linked === 'google' ? 'ผูกบัญชี Google แล้ว — ครั้งหน้าเข้าด้วย Google ได้เลย' : 'ผูกบัญชี LINE แล้ว — ครั้งหน้าเข้าด้วย LINE ได้เลย');
    if (err) notify('error', `ผูกบัญชีไม่สำเร็จ: ${LOGIN_ERRORS[err] ?? `รหัส ${err}`}`);
    if (linked || err) nav('/account', { replace: true });
    void load();
  }, [load, nav, notify]);

  async function unlink() {
    if (!confirm('เลิกผูกบัญชี Google? หลังจากนี้ต้องเข้าด้วย LINE')) return;
    setBusy(true);
    try {
      await api.post('/api/me/identities/google/unlink');
      notify('success', 'เลิกผูก Google แล้ว');
      await load();
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar title="บัญชี" back="/" />
      {error && <div className="banner banner-error" role="alert">{error} <button className="link" onClick={() => void load()}>ลองใหม่</button></div>}
      {!ids && !error && <p className="center muted">กำลังโหลด…</p>}
      {ids && (
        <div className="form-block">
          <h3 className="section-title">ช่องทางเข้าสู่ระบบ</h3>
          <div className="note-card">
            <div className="row">
              <b className="grow">LINE</b>
              {ids.line ? <span className="small">✅ ผูกแล้ว</span>
                : <a className="btn btn-small btn-line-small" href="/api/auth/line/link">ผูก LINE</a>}
            </div>
          </div>
          <div className="note-card">
            <div className="row">
              <b className="grow">Google</b>
              {ids.google ? (
                <>
                  <span className="small">✅ {ids.google.email ?? 'ผูกแล้ว'}</span>
                  {ids.line && <button className="link" disabled={busy} onClick={() => void unlink()}>เลิกผูก</button>}
                </>
              ) : ids.googleReady ? (
                <a className="btn btn-small btn-google" href="/api/auth/google/link"><span className="g-logo" aria-hidden="true">G</span> ผูก Google</a>
              ) : (
                <span className="small muted">ผู้ดูแลยังไม่ได้เปิดใช้ Google</span>
              )}
            </div>
          </div>
          <p className="small muted">
            ผูกไว้ทั้ง 2 ทาง = เข้าทางไหนก็เจอบัญชีเดิม (เพื่อน แชท กลุ่ม เหมือนกันหมด)<br />
            ถ้าบัญชี Google/LINE นั้นเคยสมัครแยกไว้แล้ว จะผูกไม่ได้ — แจ้งแอดมินให้ช่วยจัดการ
          </p>
        </div>
      )}
    </div>
  );
}
