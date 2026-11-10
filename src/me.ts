// =====================================================================
// me.ts — ข้อมูลผู้ใช้ที่ล็อกอินอยู่ (ใช้ได้ทุกหน้าที่อยู่หลังล็อกอิน)
// =====================================================================

import { createContext, useContext } from 'react';
import type { Me } from './api';

export interface MeCtx { me: Me; reload: () => Promise<void>; logout: () => Promise<void> }
export const MeContext = createContext<MeCtx | null>(null);

export function useMe(): MeCtx {
  const v = useContext(MeContext);
  if (!v) throw new Error('useMe ต้องอยู่ภายใต้ผู้ใช้ที่ล็อกอินแล้ว');
  return v;
}
