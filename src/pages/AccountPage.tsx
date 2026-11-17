// =====================================================================
// AccountPage.tsx — บัญชีที่ผูก (LINE / Google)
//   2026-11-17 เลิกใช้ LINE: ทางเข้าคือ Gmail อย่างเดียว · หน้านี้แสดงสถานะ (ผูก Gmail บังคับที่ LinkGooglePage)
//   ไม่มีปุ่ม "ผูก LINE" / "เลิกผูก Gmail" แล้ว (เลิกผูก = เข้าบัญชีไม่ได้)
//   ผลการผูกกลับมาที่หน้านี้: ?linked=google หรือ ?link_error=รหัส (แปลเป็นภาษาไทย)
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { LOGIN_ERRORS, api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';
import Loading from '../Loading';

interface Identities { line: boolean; google: { email: string | null } | null; googleReady: boolean }

export default function AccountPage() {
  const notify = useNotify();
  const nav = useNavigate();
  const [ids, setIds] = useState<Identities | null>(null);
  const [error, setError] = useState('');

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
    if (linked) notify('success', 'ผูก Gmail แล้ว — ครั้งหน้าเข้าด้วย Gmail ได้เลย (เพื่อนและแชทเดิมอยู่ครบ)');
    if (err) notify('error', `ผูกบัญชีไม่สำเร็จ: ${LOGIN_ERRORS[err] ?? `รหัส ${err}`}`);
    if (linked || err) nav('/account', { replace: true });
    void load();
  }, [load, nav, notify]);

  return (
    <div className="page">
      <TopBar title="บัญชี" back="/" />
      {error && <div className="banner banner-error" role="alert">{error} <button className="link" onClick={() => void load()}>ลองใหม่</button></div>}
      {!ids && !error && <Loading variant="card" />}
      {ids && (
        <div className="form-block">
          <h3 className="section-title">บัญชีที่ใช้เข้าสู่ระบบ</h3>
          <div className="note-card">
            <div className="row">
              <b className="grow">LINE</b>
              <span className="small muted">{ids.line ? 'เคยผูกไว้ (เลิกใช้เข้าสู่ระบบแล้ว)' : 'ไม่ได้ใช้'}</span>
            </div>
          </div>
          <div className="note-card">
            <div className="row">
              <b className="grow">Google</b>
              {ids.google ? (
                <span className="small">✅ {ids.google.email ?? 'ผูกแล้ว'}</span>
              ) : ids.googleReady ? (
                <a className="btn btn-small btn-google" href="/api/auth/google/link"><span className="g-logo" aria-hidden="true">G</span> ผูก Google</a>
              ) : (
                <span className="small muted">ผู้ดูแลยังไม่ได้เปิดใช้ Google</span>
              )}
            </div>
          </div>
          <p className="small muted">เข้าสู่ระบบด้วย Gmail ที่ผูกไว้ · ต้องการเปลี่ยนบัญชี Gmail แจ้งแอดมินให้ช่วยจัดการ</p>
        </div>
      )}
    </div>
  );
}
