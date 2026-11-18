// =====================================================================
// ProfilePage.tsx — โปรไฟล์ของฉัน: เปลี่ยนรูป (ครอปวงกลม) + ชื่อที่แสดง (2026-11-18)
//   ค่าเริ่มต้นมาจาก Gmail · ตั้งเองแล้วล็อกอินครั้งถัดไปไม่ถูกทับ · มีปุ่มกลับไปใช้ของ Gmail
//   เปิดจาก: เมนู → แตะแถวโปรไฟล์
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROFILE_NAME_MAX, PROFILE_NAME_MIN } from '../../shared/protocol';
import { MyProfile, api, errMsg } from '../api';
import { Avatar, TopBar } from '../components';
import { useMe } from '../me';
import { useNotify } from '../notice';
import Loading from '../Loading';
import PictureCropper from '../PictureCropper';

export default function ProfilePage() {
  const { reload } = useMe();
  const notify = useNotify();
  const [p, setP] = useState<MyProfile | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'' | 'name' | 'picture'>('');
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ profile: MyProfile }>('/api/me/profile');
      setP(d.profile);
      setName(d.profile.displayName);
      setError('');
    } catch (e) {
      setError(`โหลดโปรไฟล์ไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** บันทึกแล้ว: อัปเดตหน้านี้ + ข้อมูล me ทั้งแอป (เมนู/หัวแชท) */
  function saved(next: MyProfile, msg: string) {
    setP(next);
    setName(next.displayName);
    notify('success', msg);
    void reload();
  }

  async function uploadPicture(blob: Blob) {
    setBusy('picture');
    try {
      const d = await api.raw<{ profile: MyProfile }>('/api/me/picture', blob, 'image/jpeg');
      setFile(null);
      saved(d.profile, 'เปลี่ยนรูปโปรไฟล์แล้ว');
    } catch (e) {
      notify('error', `เปลี่ยนรูปไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy('');
    }
  }

  async function resetPicture() {
    if (!confirm('กลับไปใช้รูปจาก Gmail? รูปที่อัปไว้จะถูกลบ')) return;
    setBusy('picture');
    try {
      saved((await api.post<{ profile: MyProfile }>('/api/me/picture/reset')).profile, 'กลับไปใช้รูปจาก Gmail แล้ว');
    } catch (e) {
      notify('error', `เปลี่ยนรูปไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy('');
    }
  }

  // ตรวจชื่อก่อนส่ง (เซิร์ฟเวอร์ตรวจซ้ำเสมอ) — นับตามตัวอักษรจริง เหมือนเซิร์ฟเวอร์
  const clean = name.replace(/\s+/gu, ' ').trim();
  const len = [...clean].length;
  const nameProblem = len < PROFILE_NAME_MIN ? `ชื่อต้องมีอย่างน้อย ${PROFILE_NAME_MIN} ตัวอักษร`
    : len > PROFILE_NAME_MAX ? `ชื่อยาวเกิน ${PROFILE_NAME_MAX} ตัวอักษร` : '';

  async function saveName(value: string | null) {
    if (value !== null && nameProblem) { notify('error', nameProblem); return; }
    setBusy('name');
    try {
      const d = await api.post<{ profile: MyProfile }>('/api/me/name', { name: value });
      saved(d.profile, value === null ? 'กลับไปใช้ชื่อจาก Gmail แล้ว' : 'บันทึกชื่อแล้ว');
    } catch (e) {
      notify('error', `บันทึกชื่อไม่สำเร็จ: ${errMsg(e)}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="page">
      <TopBar title="โปรไฟล์" back="/menu" />
      {error && <div className="banner banner-error" role="alert">{error} <button className="link" onClick={() => void load()}>ลองใหม่</button></div>}
      {!p && !error && <Loading variant="card" />}
      {p && (
        <>
          <div className="profile-hero">
            <button className="profile-pic" onClick={() => input.current?.click()} disabled={!!busy} aria-label="เปลี่ยนรูปโปรไฟล์">
              <Avatar name={p.displayName} url={p.pictureUrl} size={112} />
              <span className="profile-pic-cam" aria-hidden="true">📷</span>
            </button>
            <div className="seg">
              <button className="btn btn-small" disabled={!!busy} onClick={() => input.current?.click()}>
                {busy === 'picture' ? 'กำลังบันทึก…' : 'เปลี่ยนรูป'}
              </button>
              {p.pictureCustom && (
                <button className="btn btn-small btn-ghost" disabled={!!busy} onClick={() => void resetPicture()}>ใช้รูปจาก Gmail</button>
              )}
            </div>
            <input ref={input} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setFile(f); }} />
          </div>

          <div className="form-block">
            <label className="field">
              <b>ชื่อที่แสดง</b>
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={busy === 'name'}
                onKeyDown={(e) => { if (e.key === 'Enter' && clean !== p.displayName) void saveName(clean); }} />
            </label>
            <div className={`small ${nameProblem ? 'error-text' : 'muted'}`}>
              {nameProblem || `${len} / ${PROFILE_NAME_MAX} ตัวอักษร`}
            </div>
            <div className="seg">
              <button className="btn btn-small" disabled={!!busy || !!nameProblem || clean === p.displayName} onClick={() => void saveName(clean)}>
                {busy === 'name' ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}
              </button>
              {p.nameCustom && p.oauthName && (
                <button className="btn btn-small btn-ghost" disabled={!!busy} onClick={() => void saveName(null)}>
                  ใช้ชื่อจาก Gmail ({p.oauthName})
                </button>
              )}
            </div>
          </div>
          <p className="small muted pad">
            เพื่อน ๆ จะเห็นรูปและชื่อใหม่ทุกที่ รวมถึงข้อความเก่าในห้องที่คุณยังเป็นสมาชิก ·
            แจ้งเตือนที่เด้งไปแล้วยังเป็นชื่อเดิม · ล็อกอินครั้งถัดไประบบจะไม่เอาของ Gmail มาทับ
          </p>
        </>
      )}
      {file && (
        <PictureCropper file={file} title="รูปโปรไฟล์" busy={busy === 'picture'} onCancel={() => setFile(null)} onDone={(b) => void uploadPicture(b)} />
      )}
    </div>
  );
}
