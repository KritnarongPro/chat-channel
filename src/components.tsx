// =====================================================================
// components.tsx — ชิ้นส่วนที่ใช้ซ้ำ: รูปโปรไฟล์, หัวหน้าจอ
// =====================================================================

import { ReactNode } from 'react';
import { Link } from 'react-router';

export function Avatar({ name, url, size = 40, bot = false }: { name: string; url?: string | null; size?: number; bot?: boolean }) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (bot) return <span className="avatar avatar-text" style={style} aria-label="บอท">🤖</span>;
  if (url) return <img className="avatar" src={url} alt="" style={style} referrerPolicy="no-referrer" />;
  return <span className="avatar avatar-text" style={style} aria-hidden="true">{name.slice(0, 1)}</span>;
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
