// =====================================================================
// SetupCard.tsx — การ์ดบนหน้ารายการแชท: ติดตั้งแอป + เปิดแจ้งเตือน
// แสดงเฉพาะขั้นที่ยังไม่ได้ทำ · ทำครบแล้วซ่อนเอง
// 2026-11-18 (ผู้ใช้เลือก): หน้ารายการแชทใช้แบบ compact = แถบบาง 1 บรรทัด แตะเพื่อดูขั้นตอนเต็ม
//   ✕ = ซ่อน 7 วัน (จำในเครื่อง) · หน้า ตั้งค่าแจ้งเตือน ยังแสดงการ์ดเต็มเสมอ
// =====================================================================

import { ReactElement, useCallback, useEffect, useState } from 'react';
import { api, errMsg } from './api';
import { useNotify } from './notice';
import {
  PushState, canOneClickInstall, enablePush, getPushState, inLineApp, inOtherInApp, isAndroid, isIOS, isStandalone,
  onPwaChange, oneClickInstall, openInExternalBrowser,
} from './pwa';

const HIDE_KEY = 'setup-bar-hidden-until';
const HIDE_DAYS = 7;

function hiddenUntil(): number {
  try {
    return Number(localStorage.getItem(HIDE_KEY)) || 0;
  } catch (e) {
    console.warn('อ่านค่าซ่อนแถบติดตั้งไม่ได้ — แสดงแถบตามปกติ', e);
    return 0;
  }
}

export default function SetupCard({ compact = false }: { compact?: boolean }) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => compact && hiddenUntil() > Date.now());
  const [push, setPush] = useState<PushState | null>(null);
  const [oneClick, setOneClick] = useState(canOneClickInstall());
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const standalone = isStandalone();

  const refresh = useCallback(() => {
    getPushState().then(setPush).catch((e) => { console.error(e); setPush('unsupported'); });
  }, []);
  useEffect(() => { refresh(); return onPwaChange(() => setOneClick(canOneClickInstall())); }, [refresh]);

  async function install() {
    const r = await oneClickInstall();
    if (r === 'accepted') notify('success', 'ติดตั้งแล้ว — เปิดแอปจากไอคอน "VELA CHAT" บนหน้าจอโฮมได้เลย');
    else if (r === 'dismissed') notify('warning', 'ยกเลิกการติดตั้ง — กดปุ่มอีกครั้งได้ทุกเมื่อ');
  }

  async function turnOnPush() {
    setBusy(true);
    try {
      await enablePush();
      await api.post('/api/push/test');
      notify('success', 'เปิดแจ้งเตือนแล้ว และส่งแจ้งเตือนทดสอบไปที่เครื่องนี้');
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  // ---------- เปิดจากในแอป LINE / Facebook: ติดตั้งและแจ้งเตือนไม่ได้ ต้องออกไปเบราว์เซอร์ก่อน ----------
  function hide() {
    try {
      localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_DAYS * 86_400_000));
      notify('success', `ซ่อนแถบนี้ ${HIDE_DAYS} วัน — ทำต่อได้ที่ เมนู → ตั้งค่าแจ้งเตือน / ติดตั้งแอป`);
    } catch (e) {
      notify('warning', `จำการซ่อนไว้ในเครื่องไม่ได้ (${errMsg(e)}) — ซ่อนแค่ตอนนี้ เปิดแอปใหม่จะเห็นอีก`);
    }
    setHidden(true);
  }

  /** compact: แถบบาง 1 บรรทัด → แตะเปิดการ์ดเต็มในแผ่นล่าง */
  function bar(label: string, card: ReactElement) {
    if (hidden) return null;
    return (
      <div className="setup-bar">
        <button className="setup-bar-main" onClick={() => setOpen(true)}><span className="setup-bar-text">{label}</span><span className="setup-bar-go">ดูวิธี ›</span></button>
        <button className="setup-bar-x" onClick={hide} aria-label={`ซ่อนแถบนี้ ${HIDE_DAYS} วัน`} title={`ซ่อน ${HIDE_DAYS} วัน`}>✕</button>
        {open && (
          <div className="sheet-backdrop" onClick={() => setOpen(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-head"><b>ติดตั้งแอป / แจ้งเตือน</b><button className="link" onClick={() => setOpen(false)}>ปิด</button></div>
              {card}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (inLineApp || inOtherInApp) {
    const card = (
      <div className="setup-card">
        <b>เปิดอยู่ในแอป{inLineApp ? ' LINE' : 'อื่น'}</b>
        <p className="small">ติดตั้งแอปและรับแจ้งเตือนได้เฉพาะใน {isIOS ? 'Safari' : 'Chrome'} — ต้องเข้าสู่ระบบอีกครั้งหลังเปิด</p>
        {inLineApp ? (
          <button className="btn btn-block" onClick={openInExternalBrowser}>เปิดใน {isIOS ? 'Safari' : 'Chrome'} (คลิกเดียว)</button>
        ) : (
          <p className="small">แตะเมนู ⋯ มุมขวาบน → "เปิดในเบราว์เซอร์"</p>
        )}
      </div>
    );
    return compact ? bar(`⚠️ เปิดในแอป${inLineApp ? ' LINE' : 'อื่น'} — ไม่ได้รับแจ้งเตือน`, card) : card;
  }

  const needInstall = !standalone;
  const needPush = push === 'off' || push === 'need-install' || push === 'denied';
  if (push === null || (!needInstall && !needPush)) return null;

  const card = (
    <div className="setup-card">
      {needInstall && (
        <div className="setup-step">
          <div><b>① ติดตั้งแอปลงหน้าจอโฮม</b>{isIOS && <span className="small"> — iPhone ต้องทำขั้นนี้ก่อนจึงจะรับแจ้งเตือนได้</span>}</div>
          {oneClick ? (
            <button className="btn btn-block" onClick={() => void install()}>📲 ติดตั้งแอป (คลิกเดียว)</button>
          ) : isIOS ? (
            <button className="btn btn-block" onClick={() => setShowIosGuide(true)}>📲 ติดตั้งบน iPhone (ดูวิธี 2 ขั้น)</button>
          ) : (
            <p className="small">แตะเมนู ⋮ ของเบราว์เซอร์ → "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก"{isAndroid ? '' : ' (บนคอมใช้ไอคอน ⊕ ในช่องที่อยู่เว็บ)'}</p>
          )}
        </div>
      )}
      {needPush && (
        <div className="setup-step">
          <div><b>{needInstall ? '②' : '🔔'} เปิดแจ้งเตือน</b></div>
          {push === 'need-install' ? (
            <p className="small">หลังติดตั้งแล้ว ให้เปิดแอปจากไอคอน "VELA CHAT" บนหน้าจอโฮม แล้วกดปุ่มเปิดแจ้งเตือนที่จะขึ้นตรงนี้</p>
          ) : push === 'denied' ? (
            <p className="small error-text">เครื่องนี้ปิดสิทธิ์แจ้งเตือนของเว็บนี้ไว้ — เปิดได้ที่การตั้งค่า{isIOS ? ' → แจ้งเตือน → แชท' : 'ของเบราว์เซอร์ → การแจ้งเตือน'} แล้วกลับมาที่นี่</p>
          ) : (
            <button className="btn btn-block" disabled={busy} onClick={() => void turnOnPush()}>
              {busy ? 'กำลังเปิด…' : '🔔 เปิดแจ้งเตือน (คลิกเดียว)'}
            </button>
          )}
        </div>
      )}
      {push === 'unsupported' && !needInstall && <p className="small muted">เบราว์เซอร์นี้ไม่รองรับแจ้งเตือน</p>}

      {showIosGuide && (
        <div className="sheet-backdrop" onClick={() => setShowIosGuide(false)}>
          <div className="sheet ios-guide" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><b>ติดตั้งบน iPhone</b><button className="link" onClick={() => setShowIosGuide(false)}>ปิด</button></div>
            <ol className="guide-steps">
              <li>แตะปุ่ม <b>แชร์</b> <span className="share-icon" aria-hidden="true">⬆︎</span> ของ Safari<br /><span className="small muted">อยู่แถบล่างของจอ — ถ้าไม่เห็น แตะ <b>⋯</b> ก่อน</span></li>
              <li>เลื่อนหา แล้วแตะ <b>"เพิ่มไปยังหน้าจอโฮม"</b> → <b>เพิ่ม</b></li>
              <li>เปิดแอปจากไอคอน <b>"VELA CHAT"</b> บนหน้าจอโฮม แล้วกด <b>เปิดแจ้งเตือน</b></li>
            </ol>
            <p className="small muted">Apple ไม่อนุญาตให้เว็บติดตั้งตัวเองได้ จึงต้องทำ 2 ขั้นนี้ด้วยมือ (ทำครั้งเดียว)</p>
            <div className="guide-arrow" aria-hidden="true">⬇︎</div>
          </div>
        </div>
      )}
    </div>
  );
  if (!compact) return card;
  return bar(
    needInstall ? '📲 ติดตั้งแอป + เปิดแจ้งเตือน'
    : push === 'denied' ? '🔔 เครื่องนี้ปิดแจ้งเตือนไว้'
    : '🔔 ยังไม่ได้เปิดแจ้งเตือน',
    card,
  );
}
