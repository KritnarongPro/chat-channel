// =====================================================================
// notice.tsx — แถบแจ้งเตือนกลางหน้าจอ (error / คำเตือน / สำเร็จ)
// ใช้: const notify = useNotify(); notify('error', 'ข้อความ')
// =====================================================================

import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

type Kind = 'error' | 'warning' | 'success';
interface Notice { id: number; kind: Kind; text: string }

const Ctx = createContext<(kind: Kind, text: string) => void>(() => {
  console.error('NoticeProvider ไม่ได้ครอบหน้าเว็บ');
});

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notice[]>([]);
  const notify = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
    // error ค้างไว้จนกว่าผู้ใช้กดปิด · อย่างอื่นหายเองใน 5 วินาที
    if (kind !== 'error') setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      <div className="notices">
        {items.map((n) => (
          <div key={n.id} className={`notice notice-${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'}>
            <span>{n.text}</span>
            <button aria-label="ปิด" onClick={() => setItems((xs) => xs.filter((x) => x.id !== n.id))}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useNotify = () => useContext(Ctx);
