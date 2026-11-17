// =====================================================================
// LoginPage.tsx — เข้าสู่ระบบด้วย LINE หรือ Google (+ แสดงเหตุผลถ้าล็อกอินไม่สำเร็จ)
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
      <a className="btn btn-line login-btn" href="/api/auth/line/start">เข้าสู่ระบบด้วย LINE</a>
      <a className="btn btn-google login-btn" href="/api/auth/google/start">
        <span className="g-logo" aria-hidden="true">G</span> เข้าสู่ระบบด้วย Google
      </a>
      <p className="muted small">ผู้ใช้ใหม่ต้องรอแอดมินอนุมัติก่อนใช้งาน</p>
      <p className="muted small">มีบัญชีที่เข้าด้วย LINE อยู่แล้ว? เข้าด้วย LINE ก่อน แล้วกด "ผูก Google" ในเมนู ☰ → บัญชี<br />
        (ถ้าเข้าด้วย Google ตรง ๆ จะเป็นบัญชีใหม่แยกกัน)</p>
      <p className="small"><a href="/privacy">นโยบายความเป็นส่วนตัว</a></p>
    </div>
  );
}
