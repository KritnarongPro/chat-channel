// =====================================================================
// components.tsx — ชิ้นส่วนที่ใช้ซ้ำ: รูปโปรไฟล์, หัวหน้าจอ
// =====================================================================

import { ReactNode, useState } from 'react';
import { Link } from 'react-router';

export function Avatar({ name, url, size = 40, bot = false }: { name: string; url?: string | null; size?: number; bot?: boolean }) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (bot) return <span className="avatar avatar-text" style={style} aria-label="บอท">🤖</span>;
  if (url) return <img className="avatar" src={url} alt="" style={style} referrerPolicy="no-referrer" />;
  return <span className="avatar avatar-text" style={style} aria-hidden="true">{name.slice(0, 1)}</span>;
}

/** โลโก้เต็ม VELA CHAT (2026-11-18) — หน้าเข้าสู่ระบบ / ลิงก์เชิญ / รออนุมัติ · โหลดไม่ได้ → ตัวหนังสือแทน */
export function BrandLogo({ size = 'large' }: { size?: 'large' | 'small' }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <h1 className={`brand-text brand-logo-${size}`}>VELA CHAT</h1>;
  return (
    <img className={`brand-logo brand-logo-${size}`} src="/icons/logo-full.webp" alt="VELA CHAT" width={720} height={512}
      onError={() => setBroken(true)} />
  );
}

export function TopBar({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? <Link to={back} className="topbar-back" aria-label="ย้อนกลับ">‹</Link> : <span className="topbar-gap" />}
      <div className="topbar-title">{title}</div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
