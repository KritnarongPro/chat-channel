// =====================================================================
// gestures.ts — ท่าทางนิ้วบนมือถือ/iPad (2026-11-18)
//   useWide()        จอกว้าง ≥ 768px (iPad ทั้งแนวตั้ง/แนวนอน, คอม) → แบ่ง 2 ช่อง
//   useEdgeSwipeBack ปัดจากขอบซ้ายเพื่อย้อนกลับ — เปิดเฉพาะแอปที่ติดตั้งบน iPhone/iPad
//                    (Safari ธรรมดา + Android มีท่าย้อนกลับของระบบอยู่แล้ว ถ้าทำซ้ำจะย้อน 2 หน้า)
//   useSwipeReply    ปัดข้อความไปทางขวาเพื่อตอบกลับ (แบบ LINE)
// ไม่เรียก preventDefault (listener แบบ passive) → การเลื่อนขึ้นลงปกติไม่สะดุด
// =====================================================================

import { RefObject, TouchEvent as RTouchEvent, useEffect, useRef, useState } from 'react';

export const WIDE_QUERY = '(min-width: 768px)';
/** เริ่มแตะห่างขอบซ้ายไม่เกินเท่านี้ = ท่าย้อนกลับ (ปัดตอบกลับจะไม่เริ่มในโซนนี้) */
export const EDGE_PX = 24;
const BACK_TRIGGER_PX = 90;
const REPLY_TRIGGER_PX = 64;
const REPLY_MAX_PX = 90;
const SLOP_PX = 10;

export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** แอปที่เปิดจากไอคอนหน้าจอโฮมของ iPhone/iPad — ไม่มีปุ่ม/ท่าย้อนกลับของ Safari */
export function needsOwnBackSwipe(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// ---------------------------------------------------------------------
// ปัดจากขอบซ้าย → ย้อนกลับ (หน้าเลื่อนตามนิ้ว ปล่อยเกิน 90px = ย้อน)
// ---------------------------------------------------------------------
export function useEdgeSwipeBack(enabled: boolean, target: RefObject<HTMLElement | null>, onBack: () => void) {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    let st: { x: number; y: number; mode: 'idle' | 'h' | 'off'; dx: number } | null = null;
    const el = () => target.current;
    const reset = (animate: boolean) => {
      const e = el();
      if (!e) return;
      e.style.transition = animate ? 'transform .18s ease-out' : '';
      e.style.transform = '';
      if (animate) window.setTimeout(() => { e.style.transition = ''; }, 200);
    };
    const start = (ev: TouchEvent) => {
      const t = ev.touches[0];
      st = ev.touches.length === 1 && t.clientX <= EDGE_PX ? { x: t.clientX, y: t.clientY, mode: 'idle', dx: 0 } : null;
    };
    const move = (ev: TouchEvent) => {
      if (!st || st.mode === 'off') return;
      const t = ev.touches[0];
      const dx = t.clientX - st.x, dy = t.clientY - st.y;
      if (st.mode === 'idle') {
        if (Math.abs(dy) > SLOP_PX && Math.abs(dy) > dx) { st.mode = 'off'; return; }
        if (dx > SLOP_PX) st.mode = 'h'; else return;
      }
      st.dx = Math.max(0, dx);
      const e = el();
      if (e) e.style.transform = `translateX(${st.dx}px)`;
    };
    const end = () => {
      if (st?.mode === 'h') {
        const go = st.dx >= BACK_TRIGGER_PX;
        reset(!go);
        if (go) back.current();
      }
      st = null;
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      reset(false);
    };
  }, [enabled, target]);
}

// ---------------------------------------------------------------------
// ปัดข้อความไปทางขวา → ตอบกลับ
//   start(e, item, bubbleEl) / move(e) / end() ผูกกับ onTouchStart/Move/End ของบับเบิล
//   onDrag = นิ้วขยับเกิน 10px (ใช้ยกเลิกการกดค้างเปิดเมนู)
// ---------------------------------------------------------------------
export function useSwipeReply<T>(onReply: (item: T) => void, onDrag: () => void) {
  const st = useRef<{ x: number; y: number; item: T; el: HTMLElement; mode: 'idle' | 'h' | 'off'; dx: number; enabled: boolean } | null>(null);
  const cb = useRef({ onReply, onDrag });
  cb.current = { onReply, onDrag };

  function paint(el: HTMLElement, dx: number) {
    el.style.transform = dx ? `translateX(${dx}px)` : '';
    const row = el.closest<HTMLElement>('.bubble-row');
    if (!row) return;
    if (dx) {
      row.dataset.swipe = dx >= REPLY_TRIGGER_PX ? 'ready' : 'on';
      row.style.setProperty('--swipe', String(Math.min(1, dx / REPLY_TRIGGER_PX)));
    } else {
      delete row.dataset.swipe;
      row.style.removeProperty('--swipe');
    }
  }

  return {
    start(e: RTouchEvent, item: T, el: HTMLElement, enabled: boolean) {
      const t = e.touches[0];
      st.current = e.touches.length === 1 && t.clientX > EDGE_PX
        ? { x: t.clientX, y: t.clientY, item, el, mode: 'idle', dx: 0, enabled }
        : null;
    },
    move(e: RTouchEvent) {
      const s = st.current;
      if (!s || s.mode === 'off') return;
      const t = e.touches[0];
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (s.mode === 'idle') {
        if (Math.abs(dx) <= SLOP_PX && Math.abs(dy) <= SLOP_PX) return;
        cb.current.onDrag();
        s.mode = s.enabled && dx > SLOP_PX && Math.abs(dy) < dx * 0.6 ? 'h' : 'off';
        if (s.mode === 'off') return;
      }
      s.dx = Math.min(REPLY_MAX_PX, Math.max(0, dx));
      paint(s.el, s.dx);
    },
    end() {
      const s = st.current;
      st.current = null;
      if (!s || s.mode !== 'h') return;
      s.el.style.transition = 'transform .15s ease-out';
      paint(s.el, 0);
      window.setTimeout(() => { s.el.style.transition = ''; }, 170);
      if (s.dx >= REPLY_TRIGGER_PX) {
        navigator.vibrate?.(10);
        cb.current.onReply(s.item);
      }
    },
  };
}
