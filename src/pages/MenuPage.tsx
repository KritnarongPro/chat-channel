// =====================================================================
// MenuPage.tsx — แท็บ "เมนู" ของแถบล่าง (2026-11-18 — แทนแผ่นเมนู ☰ บนหัวรายการแชท)
//   โน้ต · หน้าตาแอป · บัญชี · แจ้งเตือน · ออเดอร์ · แอดมิน (+ จำนวนรออนุมัติ) · ออกจากระบบ
// =====================================================================

import { Link } from 'react-router';
import { Avatar, TopBar } from '../components';
import { useCounts } from '../counts';
import { useMe } from '../me';

export default function MenuPage() {
  const { me, logout } = useMe();
  const { pendingUsers } = useCounts();
  return (
    <div className="page">
      <TopBar title="เมนู" />
      <div className="menu-profile">
        <Avatar name={me.user.displayName} url={me.user.pictureUrl} size={52} />
        <div className="grow">
          <b className="ellipsis">{me.user.displayName}</b>
          <div className="small muted">{me.user.role === 'admin' ? 'แอดมินระบบ' : 'สมาชิก'}</div>
        </div>
      </div>
      <ul className="menu-list menu-page">
        <li><Link to="/notes">🗒 โน้ตของฉัน (Keep)</Link></li>
        <li><Link to="/appearance">🎨 หน้าตาแอป (ธีม / ตัวอักษร)</Link></li>
        <li><Link to="/account">👤 บัญชี (Gmail ที่ใช้เข้า)</Link></li>
        <li><Link to="/settings">🔔 ตั้งค่าแจ้งเตือน / ติดตั้งแอป</Link></li>
        <li><Link to="/orders">📦 ออเดอร์</Link></li>
        {me.user.role === 'admin' && (
          <li>
            <Link to="/admin">
              🛠 แอดมิน
              {pendingUsers > 0 && <span className="badge push-right">รออนุมัติ {pendingUsers}</span>}
              {pendingUsers < 0 && <span className="small error-text push-right">นับคนรออนุมัติไม่ได้</span>}
            </Link>
          </li>
        )}
        <li><button className="danger-text" onClick={() => void logout()}>🚪 ออกจากระบบ</button></li>
      </ul>
    </div>
  );
}
