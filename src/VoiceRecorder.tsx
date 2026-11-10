// =====================================================================
// VoiceRecorder.tsx — อัดข้อความเสียง (กดเริ่ม → กดส่ง / ยกเลิก) ยาวสุด 5 นาที (หยุดเองเมื่อครบ)
// ไมค์ใช้ไม่ได้ / ไม่ได้รับอนุญาต / เบราว์เซอร์ไม่รองรับ → แจ้งเหตุผล
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { MAX_VOICE_SECONDS } from '../shared/protocol';
import { formatDuration, pickVoiceMime, voiceExt } from './media';
import type { OutgoingFile } from './useRoomSocket';

export default function VoiceRecorder({ onDone, onCancel, onError }: {
  onDone: (f: OutgoingFile) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const sendOnStop = useRef(false);
  const cbs = useRef({ onDone, onCancel, onError });
  cbs.current = { onDone, onCancel, onError };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let tick: number | undefined;
    let cancelled = false;

    (async () => {
      const mime = pickVoiceMime();
      if (!mime) { cbs.current.onError('เบราว์เซอร์นี้อัดเสียงไม่ได้'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        cbs.current.onError(
          name === 'NotAllowedError' ? 'ไม่ได้รับอนุญาตให้ใช้ไมค์ — เปิดสิทธิ์ไมค์ในการตั้งค่าเบราว์เซอร์'
          : name === 'NotFoundError' ? 'ไม่พบไมค์ในเครื่องนี้'
          : `เปิดไมค์ไม่ได้ (${name || 'ไม่ทราบสาเหตุ'})`,
        );
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onerror = () => cbs.current.onError('อัดเสียงผิดพลาดระหว่างอัด');
      rec.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        if (!sendOnStop.current) return;
        const durationMs = Date.now() - startedAt.current;
        const type = (rec.mimeType || mime).split(';')[0];
        const blob = new Blob(chunks.current, { type });
        if (blob.size === 0) { cbs.current.onError('อัดเสียงไม่ได้ข้อมูล (ไฟล์ว่าง) ลองใหม่อีกครั้ง'); return; }
        cbs.current.onDone({ kind: 'voice', blob, mime: type, name: `ข้อความเสียง.${voiceExt(type)}`, durationMs });
      };
      rec.start(1000);
      startedAt.current = Date.now();
      setReady(true);
      tick = window.setInterval(() => {
        const s = (Date.now() - startedAt.current) / 1000;
        setElapsed(s);
        if (s >= MAX_VOICE_SECONDS) { sendOnStop.current = true; rec.stop(); clearInterval(tick); }
      }, 250);
    })();

    return () => {
      cancelled = true;
      if (tick) clearInterval(tick);
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function finish(send: boolean) {
    sendOnStop.current = send;
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    if (!send) cbs.current.onCancel();
  }

  return (
    <div className="recorder" role="group" aria-label="อัดข้อความเสียง">
      <span className="rec-dot" aria-hidden="true" />
      <span className="rec-time">
        {ready ? formatDuration(elapsed * 1000) : 'กำลังเปิดไมค์…'} / {formatDuration(MAX_VOICE_SECONDS * 1000)}
      </span>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => finish(false)}>ยกเลิก</button>
      <button type="button" className="btn btn-small" disabled={!ready} onClick={() => finish(true)}>ส่งเสียง</button>
    </div>
  );
}
