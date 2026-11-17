// =====================================================================
// Loading.tsx — หน้าโหลดแบบโครงร่างเทากะพริบ (ผู้ใช้เลือก 2026-11-17 แทนหน้าขาว "กำลังโหลด…")
//   variant: list = รายการแชท/รายชื่อ · bubbles = ข้อความในห้อง · card = หน้าตั้งค่า/ฟอร์ม · inline = แถบเล็ก
//   shell = เปิดแอปครั้งแรก (หัวแอป + รายการ)
//   โหลดเกิน 10 วิ → แจ้ง "โหลดช้ากว่าปกติ" + ปุ่มลองใหม่ (ไม่ปล่อยค้างเงียบ) — ไม่ส่ง onRetry = โหลดหน้าใหม่ทั้งหน้า
// =====================================================================

import { useEffect, useState } from 'react';

export const SLOW_MS = 10_000;

/** true เมื่อรอนานเกิน ms (นับใหม่ทุกครั้งที่ component นี้ขึ้นจอ) */
export function useSlow(ms = SLOW_MS) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return slow;
}

export function SlowNotice({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="banner banner-warning slow-notice" role="status">
      โหลดช้ากว่าปกติ — เน็ตอาจช้า หรือเซิร์ฟเวอร์ยังไม่ตอบ{' '}
      <button className="link" onClick={() => (onRetry ? onRetry() : window.location.reload())}>ลองใหม่</button>
    </div>
  );
}

const WIDTHS = [72, 55, 84, 63, 46, 78, 59, 68];

export default function Loading({ variant = 'list', rows, onRetry }: {
  variant?: 'list' | 'bubbles' | 'card' | 'inline' | 'shell';
  rows?: number;
  onRetry?: () => void;
}) {
  const slow = useSlow();
  const n = rows ?? (variant === 'bubbles' ? 7 : variant === 'card' ? 4 : variant === 'inline' ? 1 : 8);
  const body = (
    <div className={`skel skel-${variant}`} aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: n }, (_, i) => {
        const w = WIDTHS[i % WIDTHS.length];
        if (variant === 'bubbles') {
          const mine = i % 3 === 1;
          return (
            <div key={i} className={`skel-bubble-row ${mine ? 'mine' : ''}`}>
              <div className="skel-box skel-bubble" style={{ width: `${Math.max(30, w - 10)}%`, height: i % 2 ? 36 : 54 }} />
            </div>
          );
        }
        if (variant === 'card') {
          return (
            <div key={i} className="skel-card">
              <div className="skel-box skel-line" style={{ width: '35%' }} />
              <div className="skel-box skel-field" />
            </div>
          );
        }
        if (variant === 'inline') return <div key={i} className="skel-box skel-line" style={{ width: '60%', margin: 8 }} />;
        return (
          <div key={i} className="skel-row">
            <div className="skel-box skel-avatar" />
            <div className="skel-text">
              <div className="skel-box skel-line" style={{ width: `${w}%` }} />
              <div className="skel-box skel-line skel-sub" style={{ width: `${Math.max(30, w - 20)}%` }} />
            </div>
          </div>
        );
      })}
      <span className="sr-only">กำลังโหลด…</span>
    </div>
  );
  if (variant === 'shell') {
    return (
      <div className="page">
        <div className="topbar">
          <div className="skel-box skel-line" style={{ width: 120, height: 18 }} />
          <div className="topbar-title" />
          <div className="skel-box skel-avatar" style={{ width: 28, height: 28 }} />
        </div>
        {slow && <SlowNotice onRetry={onRetry} />}
        <div className="skel skel-list">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skel-row">
              <div className="skel-box skel-avatar" />
              <div className="skel-text">
                <div className="skel-box skel-line" style={{ width: `${WIDTHS[i]}%` }} />
                <div className="skel-box skel-line skel-sub" style={{ width: `${Math.max(30, WIDTHS[i] - 20)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <>
      {slow && <SlowNotice onRetry={onRetry} />}
      {body}
    </>
  );
}
