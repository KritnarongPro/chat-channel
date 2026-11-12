// =====================================================================
// AppearancePage.tsx — หน้าตาแอป (เฟส 5): ธีม สว่าง/มืด/ตามเครื่อง + ขนาดตัวอักษรแชท 5 ระดับ
//   กดแล้วเห็นผลทันที → บันทึกที่บัญชี (ทุกเครื่องเหมือนกัน) · บันทึกไม่ผ่าน → คืนค่าเดิม + แจ้ง error
// =====================================================================

import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';
import { FONT_LABELS, Prefs, Theme, applyPrefs, cachedPrefs } from '../prefs';

const THEMES: { key: Theme; label: string }[] = [
  { key: 'system', label: '📱 ตามเครื่อง' }, { key: 'light', label: '☀️ สว่าง' }, { key: 'dark', label: '🌙 มืด' },
];

export default function AppearancePage() {
  const notify = useNotify();
  const [p, setP] = useState<Prefs>(cachedPrefs());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ prefs: Prefs }>('/api/me/prefs')
      .then((d) => { setP(d.prefs); applyPrefs(d.prefs); })
      .catch((e) => notify('error', `โหลดค่าหน้าตาแอปไม่สำเร็จ: ${errMsg(e)}`));
  }, [notify]);

  async function save(next: Prefs) {
    const before = p;
    setP(next);
    applyPrefs(next);
    setSaving(true);
    try {
      await api.post('/api/me/prefs', next);
    } catch (e) {
      setP(before);
      applyPrefs(before);
      notify('error', `บันทึกไม่สำเร็จ (คืนค่าเดิมแล้ว): ${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <TopBar title="หน้าตาแอป" back="/" />
      <div className="form-block">
        <h3 className="section-title">ธีม</h3>
        <div className="seg">
          {THEMES.map((t) => (
            <button key={t.key} className={`chip ${p.theme === t.key ? 'on' : ''}`} disabled={saving} onClick={() => void save({ ...p, theme: t.key })}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="small muted">"ตามเครื่อง" = มืด/สว่างตามที่ตั้งไว้ในมือถือหรือคอม</p>

        <h3 className="section-title">ขนาดตัวอักษรในแชท</h3>
        <div className="seg">
          {FONT_LABELS.map((label, i) => (
            <button key={label} className={`chip ${p.fontLevel === i + 1 ? 'on' : ''}`} disabled={saving} onClick={() => void save({ ...p, fontLevel: i + 1 })}>
              {i + 1} · {label}
            </button>
          ))}
        </div>
        <div className="font-preview">ตัวอย่างข้อความ: สวัสดีครับ วันนี้ส่งปุ๋ยได้กี่โมง?</div>
        <p className="small muted">ค่าจะถูกจำไว้ที่บัญชี — เปิดจากเครื่องไหนก็เหมือนกัน</p>
      </div>
    </div>
  );
}
