// =====================================================================
// LinkGooglePage.tsx — บังคับผูก Gmail (2026-11-17 เลิกใช้ LINE)
//   คนเดิมที่เข้าด้วย LINE อย่างเดียว ต้องผูก Gmail ก่อนใช้งาน → บัญชีเดิม (เพื่อน แชท กลุ่ม) อยู่ครบ
//   ผลการผูกกลับมาเป็น ?link_error=รหัส → แสดงเหตุผลภาษาไทย (ผูกสำเร็จ → me.needsGoogle = false → เข้าแอปปกติ)
// =====================================================================

import { LOGIN_ERRORS } from '../api';
import { useMe } from '../me';
import { escapeInAppBrowser } from '../pwa';

export default function LinkGooglePage() {
  const { me, logout } = useMe();
  const code = new URLSearchParams(location.search).get('link_error');
  const reason = code ? (LOGIN_ERRORS[code] ?? `ผูก Gmail ไม่สำเร็จ (รหัส ${code})`) : null;
  const blocked = escapeInAppBrowser();

  return (
    <div className="center login">
      <h1>ผูก Gmail ก่อนใช้งาน</h1>
      <p>สวัสดี {me.user.displayName}</p>
      <p className="muted">ระบบเลิกใช้การเข้าสู่ระบบด้วย LINE แล้ว กรุณาผูกบัญชี Gmail ครั้งเดียว<br />
        เพื่อน แชท และกลุ่มเดิมของคุณจะอยู่ครบ ครั้งหน้าเข้าด้วย Gmail ได้เลย</p>
      {reason && <p className="error-text" role="alert">{reason}</p>}
      {blocked ? (
        <p className="error-text" role="alert">{blocked}</p>
      ) : (
        <a className="btn btn-google login-btn" href="/api/auth/google/link">
          <span className="g-logo" aria-hidden="true">G</span> ผูก Gmail
        </a>
      )}
      <button className="btn btn-ghost" onClick={() => void logout()}>ออกจากระบบ</button>
    </div>
  );
}
