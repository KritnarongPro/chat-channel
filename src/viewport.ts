// =====================================================================
// viewport.ts — กันหน้าแชทเด้งขึ้นบนตอนคีย์บอร์ดขึ้น/หาย (iPad / iPhone — เจอ 2026-11-18)
//
// อาการ: พิมพ์แชทแล้วช่องพิมพ์ลอยไปค้างบนสุดของจอ ข้างล่างว่าง (ภาพจากผู้ใช้บน iPad)
// สาเหตุ: (1) Safari เลื่อนทั้งหน้า (layout viewport) ขึ้นตอนคีย์บอร์ดขึ้น แต่พอคีย์บอร์ดหายไม่เลื่อนกลับ
//         (2) ช่องพิมพ์เล็กกว่า 16px (ตัวอักษรระดับ 1–2) → iOS ซูมหน้าเองตอนแตะ (แก้ใน styles.css)
// วิธีแก้: หน้าแชท (html.chat-open) สูงเท่าส่วนที่มองเห็นจริง (visualViewport.height → --app-h)
//         แล้วดึงหน้ากลับ scrollTop 0 ทุกครั้งที่ขนาดเปลี่ยน / ออกจากช่องพิมพ์
// =====================================================================

let installed = false;

export function installViewportFix() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const root = document.documentElement;
  const vv = window.visualViewport;

  const apply = () => {
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--app-h', `${Math.round(h)}px`);
    // หน้าแชทล็อกความสูงไว้แล้ว → หน้าไม่ควรเลื่อนเลย ถ้า Safari เลื่อนไว้ ให้ดึงกลับ
    if (root.classList.contains('chat-open') && (window.scrollY !== 0 || (vv && vv.offsetTop !== 0))) {
      window.scrollTo(0, 0);
    }
  };
  const later = () => requestAnimationFrame(apply);

  apply();
  vv?.addEventListener('resize', later);
  vv?.addEventListener('scroll', later);
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', () => setTimeout(apply, 300));
  // ออกจากช่องพิมพ์ (คีย์บอร์ดหาย) → iOS ปรับขนาดช้ากว่า event นิดหน่อย จึงเช็กซ้ำ 2 รอบ
  document.addEventListener('focusout', () => {
    setTimeout(apply, 50);
    setTimeout(apply, 350);
  });
}

/** เปิดหน้าแชท: ล็อกความสูงหน้าเท่าส่วนที่มองเห็นจริง (เรียกใน useEffect ของหน้าแชท) */
export function lockChatViewport(): () => void {
  const root = document.documentElement;
  root.classList.add('chat-open');
  window.scrollTo(0, 0);
  return () => root.classList.remove('chat-open');
}
