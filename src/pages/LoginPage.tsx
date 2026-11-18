// =====================================================================
// LoginPage.tsx — เข้าสู่ระบบด้วย Gmail (+ แสดงเหตุผลถ้าล็อกอินไม่สำเร็จ)
//   2026-11-17 เลิกใช้ LINE: เหลือลิงก์เล็ก "เคยเข้าด้วย LINE" ให้คนเดิมเข้ามาผูก Gmail (สมัครใหม่ด้วย LINE ไม่ได้)
//   เปิดจากในแอป LINE → พาออกไป Chrome/Safari อัตโนมัติ (Google ไม่ให้ล็อกอินในแอป)
// =====================================================================

import { LOGIN_ERRORS } from '../api';
import { escapeInAppBrowser } from '../pwa';
import { BrandLogo } from '../components';

export default function LoginPage() {
  const code = new URLSearchParams(location.search).get('login_error');
  const reason = code ? (LOGIN_ERRORS[code] ?? `เข้าสู่ระบบไม่สำเร็จ (รหัส ${code})`) : null;
  const blocked = escapeInAppBrowser();

  return (
    <div className="center login">
      <BrandLogo />
      <p className="muted">แชท กลุ่ม และชาเนลสำหรับกลุ่มของเรา</p>
      {reason && <p className="error-text" role="alert">{reason}</p>}
      {blocked ? (
        <p className="error-text" role="alert">{blocked}</p>
      ) : (
        <a className="btn btn-google login-btn" href="/api/auth/google/start">
          <span className="g-logo" aria-hidden="true">G</span> เข้าสู่ระบบด้วย Gmail
        </a>
      )}
      <p className="muted small">ผู้ใช้ใหม่ต้องรอแอดมินอนุมัติก่อนใช้งาน</p>
      <p className="small muted">เคยใช้ด้วย LINE และยังไม่ได้ผูก Gmail? <a href="/api/auth/line/start">เข้าด้วย LINE ครั้งสุดท้าย</a> แล้วระบบจะให้ผูก Gmail (เพื่อนและแชทเดิมอยู่ครบ)</p>
      <p className="small"><a href="/privacy">นโยบายความเป็นส่วนตัว</a></p>
    </div>
  );
}
