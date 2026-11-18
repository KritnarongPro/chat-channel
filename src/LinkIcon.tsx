// =====================================================================
// LinkIcon.tsx — ไอคอนของลิงก์กลุ่ม (2026-11-18)
//   auto / upload → รูปจาก /api/pictures/<id> (โหลดไม่ได้ → ตัวอักษรแทน)
//   emoji → อีโมจิบนพื้นสี · letter → ตัวแรกของชื่อบนพื้นสี
// =====================================================================

import { useState } from 'react';
import type { LinkColor, LinkIconKind } from '../shared/protocol';

export interface LinkIconData { kind: LinkIconKind; pictureUrl: string | null; emoji: string | null; color: LinkColor }

export default function LinkIcon({ icon, title, size = 44 }: { icon: LinkIconData; title: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.26), fontSize: Math.round(size * 0.5) };
  if (icon.pictureUrl && !broken) {
    return <img className="link-icon link-icon-img" src={icon.pictureUrl} alt="" style={box} onError={() => setBroken(true)} />;
  }
  return (
    <span className={`link-icon link-c-${icon.color}`} style={box} aria-hidden="true">
      {icon.kind === 'emoji' && icon.emoji ? icon.emoji : [...title.trim()][0]?.toUpperCase() ?? '🔗'}
    </span>
  );
}
