// =====================================================================
// PictureCropper.tsx — ครอปรูปเป็นวงกลม (2026-11-18 — ผู้ใช้เลือก: ลากเลื่อน/ซูมเอง แบบ LINE)
//   นิ้วเดียว/เมาส์ = ลากเลื่อน · 2 นิ้ว = ถ่างซูม · แถบเลื่อน = ซูม (คอม/คนที่ถ่างนิ้วไม่ถนัด)
//   รูปต้องเต็มวงกลมเสมอ (ซูมออกได้ต่ำสุดเท่าพอดีวง) · ผลลัพธ์ = JPEG สี่เหลี่ยม PICTURE_SIDE px (แสดงเป็นวงกลมด้วย CSS)
//   อ่านรูปไม่ได้ / บันทึกไม่ได้ → ขึ้นเหตุผล ไม่ปิดเงียบ
// =====================================================================

import { PointerEvent as RPointerEvent, useEffect, useRef, useState } from 'react';
import { PICTURE_MAX_BYTES, PICTURE_SIDE } from '../shared/protocol';

const VIEW = 280;      // ขนาดวงกลมบนจอ (px)
const MAX_ZOOM = 4;    // ซูมได้สูงสุด 4 เท่าของขนาดพอดีวง

interface Props { file: File; title: string; busy?: boolean; onCancel: () => void; onDone: (blob: Blob) => void }

export default function PictureCropper({ file, title, busy, onCancel, onDone }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);                 // 1 = พอดีวง
  const [off, setOff] = useState({ x: 0, y: 0 });      // เลื่อนจากกึ่งกลาง (px บนจอ)
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  // ---------- โหลดรูป ----------
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { setImg(el); setZoom(1); setOff({ x: 0, y: 0 }); };
    el.onerror = () => setError('เครื่องนี้เปิดรูปนี้ไม่ได้ (อาจเป็น HEIC หรือไฟล์เสีย) — ลองเลือกรูปอื่น หรือถ่ายหน้าจอรูปนั้นแล้วเลือกใหม่');
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;  // สเกลที่ด้านสั้นพอดีวง
  const scale = base * zoom;
  const w = img ? img.naturalWidth * scale : 0;
  const h = img ? img.naturalHeight * scale : 0;

  /** เลื่อนได้แค่ไม่ให้เห็นขอบว่างในวงกลม */
  function clamp(o: { x: number; y: number }, s: number) {
    if (!img) return o;
    const mx = Math.max(0, (img.naturalWidth * s - VIEW) / 2);
    const my = Math.max(0, (img.naturalHeight * s - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  }
  function setZoomTo(z: number) {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(nz);
    setOff((o) => clamp({ x: o.x * (nz / zoom), y: o.y * (nz / zoom) }, base * nz));
  }

  // ---------- นิ้ว / เมาส์ ----------
  function down(e: RPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) setZoomTo(pinch.current.zoom * (d / pinch.current.dist));
    } else if (pointers.current.size === 1) {
      setOff((o) => clamp({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }, scale));
    }
  }
  function up(e: RPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  // ---------- ตัดเป็น JPEG ----------
  async function save() {
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = PICTURE_SIDE;
    canvas.height = PICTURE_SIDE;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setError('ตัดรูปไม่ได้ (เบราว์เซอร์ไม่รองรับ canvas)'); return; }
    // มุมซ้ายบนของรูปบนจอ เทียบกับมุมซ้ายบนของวงกลม → แปลงเป็นพิกัดในรูปจริง
    const left = VIEW / 2 - w / 2 + off.x;
    const top = VIEW / 2 - h / 2 + off.y;
    const sx = -left / scale, sy = -top / scale, side = VIEW / scale;
    ctx.fillStyle = '#fff';  // PNG โปร่งใส → พื้นขาว
    ctx.fillRect(0, 0, PICTURE_SIDE, PICTURE_SIDE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, PICTURE_SIDE, PICTURE_SIDE);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
    if (!blob) { setError('ตัดรูปไม่สำเร็จ — ลองเลือกรูปใหม่'); return; }
    if (blob.size > PICTURE_MAX_BYTES) { setError(`รูปที่ตัดแล้วยังใหญ่เกิน ${PICTURE_MAX_BYTES / 1024} KB — ลองรูปอื่น`); return; }
    onDone(blob);
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="sheet cropper" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>{title}</b><button className="link" disabled={busy} onClick={onCancel}>ยกเลิก</button></div>
        {error && <p className="error-text" role="alert">{error}</p>}
        {!img && !error && <p className="muted center">กำลังเปิดรูป…</p>}
        {img && (
          <>
            <div className="crop-view" style={{ width: VIEW, height: VIEW }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onWheel={(e) => setZoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
              role="img" aria-label="ตัวอย่างรูป — ลากเพื่อเลื่อน ถ่างนิ้วเพื่อซูม">
              <img src={img.src} alt="" draggable={false}
                style={{ width: w, height: h, transform: `translate(${VIEW / 2 - w / 2 + off.x}px, ${VIEW / 2 - h / 2 + off.y}px)` }} />
              <div className="crop-mask" aria-hidden="true" />
            </div>
            <label className="crop-zoom">
              <span aria-hidden="true">➖</span>
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZoomTo(Number(e.target.value))} aria-label="ซูม" />
              <span aria-hidden="true">➕</span>
            </label>
            <p className="small muted center-text">ลากเพื่อเลื่อน · ถ่างนิ้วหรือใช้แถบเพื่อซูม</p>
            <button className="btn btn-block" disabled={busy} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'ใช้รูปนี้'}</button>
          </>
        )}
      </div>
    </div>
  );
}
