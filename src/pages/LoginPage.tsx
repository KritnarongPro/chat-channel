// =====================================================================
// LoginPage.tsx — เข้าสู่ระบบด้วย LINE (+ แสดงเหตุผลถ้าล็อกอินไม่สำเร็จ)
// =====================================================================

import { LOGIN_ERRORS } from '../api';

export default function LoginPage() {
  const code = new URLSearchParams(location.search).get('login_error');
  const reason = code ? (LOGIN_ERRORS[code] ?? `เข้าสู่ระบบไม่สำเร็จ (รหัส ${code})`) : null;

  return (
    <div className="center login">
      <h1>แชทส่วนตัว</h1>
      <p className="muted">แชท กลุ่ม และชาเนลสำหรับกลุ่มของเรา</p>
      {reason && <p className="error-text" role="alert">{reason}</p>}
      <a className="btn btn-line" href="/api/auth/line/start">เข้าสู่ระบบด้วย LINE</a>
      <p className="muted small">ผู้ใช้ใหม่ต้องรอแอดมินอนุมัติก่อนใช้งาน</p>
    </div>
  );
}
