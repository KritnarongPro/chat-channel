// =====================================================================
// AdminBotsPage.tsx — แอดมิน: สร้าง/แก้/ปิดบอท, ดู token (ครั้งเดียว), webhook, ทดสอบส่ง, ดูเหตุผลที่ส่งไม่สำเร็จ
// =====================================================================

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { thaiClock, thaiDate } from '../../shared/time';
import { Bot, api, errMsg } from '../api';
import { TopBar } from '../components';
import { useNotify } from '../notice';

const when = (iso: string | null) => (iso ? `${thaiDate(iso)} ${thaiClock(iso)}` : '-');

export default function AdminBotsPage() {
  const notify = useNotify();
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [hook, setHook] = useState('');
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setBots((await api.get<{ bots: Bot[] }>('/api/admin/bots')).bots);
      setError('');
    } catch (e) {
      setError(`โหลดรายการบอทไม่สำเร็จ: ${errMsg(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, okText?: string) {
    setBusy(key);
    try {
      await fn();
      if (okText) notify('success', okText);
      await load();
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusy('');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await act('create', async () => {
      const r = await api.post<{ id: string; token: string }>('/api/admin/bots', { name: name.trim(), webhookUrl: hook.trim() || null });
      setNewToken({ name: name.trim(), token: r.token });
      setName('');
      setHook('');
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', 'คัดลอกแล้ว');
    } catch (err) {
      console.error(err);
      notify('error', 'คัดลอกไม่ได้ — กดค้างที่ข้อความแล้วคัดลอกเอง');
    }
  }

  return (
    <div className="page">
      <TopBar title="แอดมิน: บอท" back="/admin" />
      <form className="form-block card-like" onSubmit={create}>
        <b>สร้างบอทใหม่</b>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="ชื่อบอท เช่น ผู้ช่วยร้าน" />
        <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="webhook URL (https://… จาก n8n) — ใส่ทีหลังได้" />
        <button className="btn" disabled={busy === 'create' || !name.trim()}>สร้างบอท</button>
      </form>

      {newToken && (
        <div className="setup-card">
          <b>token ของ "{newToken.name}" — แสดงครั้งเดียว</b>
          <code className="token">{newToken.token}</code>
          <div className="row-actions">
            <button className="btn btn-small" onClick={() => void copy(newToken.token)}>คัดลอก token</button>
            <button className="btn btn-small btn-ghost" onClick={() => setNewToken(null)}>เก็บแล้ว ปิดได้</button>
          </div>
          <p className="small">นำไปใส่ใน n8n (หัว Authorization: Bearer token) — ถ้าทำหาย กด "สร้าง token ใหม่"</p>
        </div>
      )}

      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {bots === null && !error && <p className="center muted">กำลังโหลด…</p>}
      {bots?.length === 0 && <p className="center muted">ยังไม่มีบอท</p>}
      <ul className="user-list">
        {bots?.map((b) => (
          <li key={b.id} className="bot-item">
            <div><b>🤖 {b.name}</b> <span className="small muted">token …{b.tokenHint} · {b.enabled ? 'เปิดใช้' : 'ปิดอยู่'}</span></div>
            <BotWebhook bot={b} busy={busy === b.id} onSave={(url) => act(b.id, () => api.post(`/api/admin/bots/${b.id}`, { webhookUrl: url || null }), 'บันทึก webhook แล้ว')} />
            <div className="small">
              webhook secret (ใส่ตรวจหัว X-Bot-Secret ใน n8n): <code>{b.webhookSecret}</code>{' '}
              <button className="link" onClick={() => void copy(b.webhookSecret)}>คัดลอก</button>
            </div>
            <div className="small muted">ส่งถึงบอทสำเร็จล่าสุด {when(b.lastDeliveryAt)}</div>
            {b.lastError && b.failCount > 0 && <div className="small error-text">ส่งไม่สำเร็จล่าสุด {when(b.lastErrorAt)} ({b.failCount} ครั้งติด): {b.lastError}</div>}
            <div className="row-actions wrap">
              <button className="btn btn-small" disabled={busy === b.id} onClick={() => void act(b.id, () => api.post(`/api/admin/bots/${b.id}/test`), 'ส่งข้อความทดสอบถึง webhook สำเร็จ')}>ทดสอบ webhook</button>
              <button className="btn btn-small btn-ghost" disabled={busy === b.id} onClick={() => void act(b.id, () => api.post(`/api/admin/bots/${b.id}`, { enabled: !b.enabled }), b.enabled ? 'ปิดบอทแล้ว' : 'เปิดบอทแล้ว')}>{b.enabled ? 'ปิดบอท' : 'เปิดบอท'}</button>
              <button
                className="btn btn-small btn-ghost"
                disabled={busy === b.id}
                onClick={() => {
                  if (!confirm(`สร้าง token ใหม่ให้ ${b.name}? token เดิมจะใช้ไม่ได้ทันที`)) return;
                  void act(b.id, async () => {
                    const r = await api.post<{ token: string }>(`/api/admin/bots/${b.id}/token`);
                    setNewToken({ name: b.name, token: r.token });
                  });
                }}
              >
                สร้าง token ใหม่
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="small muted pad">เพิ่มบอทเข้ากลุ่ม/ชาเนลได้จากปุ่ม "+ เพิ่มสมาชิก" ในห้อง · ให้บอทโพสต์ในชาเนลได้ ต้องตั้งบอทเป็นแอดมินชาเนล</p>
    </div>
  );
}

function BotWebhook({ bot, busy, onSave }: { bot: Bot; busy: boolean; onSave: (url: string) => Promise<void> }) {
  const [url, setUrl] = useState(bot.webhookUrl ?? '');
  const changed = url.trim() !== (bot.webhookUrl ?? '');
  return (
    <div className="row-actions">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webhook URL (https://…)" />
      <button className="btn btn-small" disabled={busy || !changed} onClick={() => void onSave(url.trim())}>บันทึก</button>
    </div>
  );
}
