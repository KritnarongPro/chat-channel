// =====================================================================
// JoinPage.tsx — หน้าเปิดลิงก์เชิญ /join/<รหัส> (เปิดได้ทั้งคนยังไม่ล็อกอิน / รออนุมัติ / ใช้งานอยู่)
//   ยังไม่ล็อกอิน → "เข้าร่วมด้วย LINE" (ล็อกอินแล้วระบบอนุมัติ + พาเข้าห้องให้เลย)
//   ล็อกอินแล้ว → "เข้าร่วม" · ลิงก์ใช้ไม่ได้ → บอกเหตุผล
// =====================================================================

import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { thaiClock, thaiDate } from '../../shared/time';
import { LOGIN_ERRORS, Me, api, errMsg } from '../api';

interface InviteInfo {
  valid: boolean; problem: string | null; problemCode: string | null;
  room?: { type: string; title: string; description: string | null; memberCount: number };
  expiresAt?: string | null;
}

const JOIN_ERRORS: Record<string, string> = {
  INVITE_NOT_FOUND: 'ไม่พบลิงก์เชิญนี้',
  INVITE_REVOKED: 'ลิงก์เชิญนี้ถูกยกเลิกแล้ว',
  INVITE_EXPIRED: 'ลิงก์เชิญนี้หมดอายุแล้ว',
  INVITE_FULL: 'ลิงก์เชิญนี้มีคนใช้ครบจำนวนแล้ว',
  DB_FAILED: 'เข้าห้องไม่สำเร็จ (ฐานข้อมูลขัดข้อง) กดเข้าร่วมอีกครั้ง',
  INVITE_FAILED: 'ใช้ลิงก์เชิญไม่สำเร็จ กดเข้าร่วมอีกครั้ง',
};

export default function JoinPage({ me, reload }: { me: Me | null; reload: () => Promise<void> }) {
  const { code = '' } = useParams();
  const [qs] = useSearchParams();
  const nav = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => {
    const e = qs.get('error') ?? qs.get('login_error');
    return e ? (JOIN_ERRORS[e] ?? LOGIN_ERRORS[e] ?? `เข้าร่วมไม่สำเร็จ (รหัส ${e})`) : '';
  });

  useEffect(() => {
    api.get<InviteInfo>(`/api/invites/${encodeURIComponent(code)}`)
      .then(setInfo)
      .catch((e) => setLoadError(errMsg(e)));
  }, [code]);

  async function join() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ roomId: string }>(`/api/invites/${encodeURIComponent(code)}/join`);
      await reload();
      nav(`/room/${r.roomId}`, { replace: true });
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  const kind = info?.room?.type === 'channel' ? 'ชาเนล' : 'กลุ่ม';
  return (
    <div className="center join">
      <div className="join-icon" aria-hidden="true">{info?.room?.type === 'channel' ? '📢' : '👥'}</div>
      {loadError && <p className="error-text" role="alert">{loadError}</p>}
      {!info && !loadError && <p className="muted">กำลังโหลด…</p>}
      {info?.room && (
        <>
          <p className="muted small">คุณได้รับเชิญเข้า{kind}</p>
          <h2>{info.room.title}</h2>
          {info.room.description && <p className="small">{info.room.description}</p>}
          <p className="small muted">
            {info.room.memberCount} {info.room.type === 'channel' ? 'ผู้ติดตาม' : 'สมาชิก'}
            {info.expiresAt && ` · ลิงก์ใช้ได้ถึง ${thaiDate(info.expiresAt)} ${thaiClock(info.expiresAt)}`}
          </p>
        </>
      )}
      {info && !info.valid && <p className="error-text" role="alert">{info.problem}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {info?.valid && (
        me ? (
          <button className="btn btn-block join-btn" disabled={busy} onClick={() => void join()}>
            {busy ? 'กำลังเข้าร่วม…' : `เข้าร่วม${kind}`}
          </button>
        ) : (
          <>
            <a className="btn btn-line btn-block join-btn" href={`/api/auth/line/start?invite=${encodeURIComponent(code)}`}>เข้าร่วมด้วย LINE</a>
            <p className="small muted">ล็อกอินด้วย LINE ครั้งเดียว แล้วระบบพาเข้า{kind}ให้เลย</p>
          </>
        )
      )}
      {me && <button className="btn btn-ghost" onClick={() => nav('/', { replace: true })}>ไปหน้ารายการแชท</button>}
    </div>
  );
}
