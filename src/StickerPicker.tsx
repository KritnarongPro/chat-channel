// =====================================================================
// StickerPicker.tsx — แผงเลือกสติกเกอร์ในช่องพิมพ์ (เฟส 5) · แตะภาพ = ส่งทันที
// =====================================================================

import { useEffect, useState } from 'react';
import { StickerPack, api, errMsg, stickerUrl } from './api';

export default function StickerPicker({ onPick }: { onPick: (stickerId: string) => void }) {
  const [packs, setPacks] = useState<StickerPack[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);

  useEffect(() => {
    api.get<{ packs: StickerPack[] }>('/api/stickers')
      .then((d) => setPacks(d.packs))
      .catch((e) => setError(`โหลดสติกเกอร์ไม่สำเร็จ: ${errMsg(e)}`));
  }, []);

  if (error) return <div className="sticker-picker"><p className="small error-text" style={{ padding: 8 }}>{error}</p></div>;
  if (!packs) return <div className="sticker-picker"><p className="small muted" style={{ padding: 8 }}>กำลังโหลดสติกเกอร์…</p></div>;
  if (packs.length === 0) return <div className="sticker-picker"><p className="small muted" style={{ padding: 8 }}>ยังไม่มีสติกเกอร์ — แอดมินเพิ่มได้ที่ แอดมิน → สติกเกอร์</p></div>;
  const pack = packs[Math.min(tab, packs.length - 1)];
  return (
    <div className="sticker-picker">
      {packs.length > 1 && (
        <div className="sticker-tabs">
          {packs.map((p, i) => <button type="button" key={p.id} className={`chip ${i === tab ? 'on' : ''}`} onClick={() => setTab(i)}>{p.name}</button>)}
        </div>
      )}
      <div className="sticker-grid">
        {pack.stickers.map((s) => (
          <button type="button" key={s.id} onClick={() => onPick(s.id)} aria-label="ส่งสติกเกอร์">
            <img src={stickerUrl(s.id)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
