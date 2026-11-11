// =====================================================================
// main.tsx — จุดเริ่มหน้าเว็บ: โหลดข้อมูลผู้ใช้ (me) แล้วเลือกหน้าตามสถานะ
//   ยังไม่ล็อกอิน → หน้าเข้าสู่ระบบ · รออนุมัติ → หน้ารออนุมัติ · ใช้งานได้ → แชท
// =====================================================================

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { ApiError, Me, api, errMsg } from './api';
import { NoticeProvider } from './notice';
import { MeContext } from './me';
import LoginPage from './pages/LoginPage';
import PendingPage from './pages/PendingPage';
import ChatListPage from './pages/ChatListPage';
import NewChatPage from './pages/NewChatPage';
import ChatRoomPage from './pages/ChatRoomPage';
import AdminPage from './pages/AdminPage';
import ChannelsPage from './pages/ChannelsPage';
import SettingsPage from './pages/SettingsPage';
import { initPwa } from './pwa';
import AdminBotsPage from './pages/AdminBotsPage';
import AdminFormsPage from './pages/AdminFormsPage';
import FormFillPage from './pages/FormFillPage';
import OrdersPage from './pages/OrdersPage';
import JoinPage from './pages/JoinPage';
import './styles.css';

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'guest' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/me'));
      setState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setState('guest');
      } else {
        setError(errMsg(e));
        setState('error');
      }
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (e) {
      setError(`ออกจากระบบไม่สำเร็จ: ${errMsg(e)}`);
      setState('error');
      return;
    }
    setMe(null);
    setState('guest');
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const location = useLocation();
  if (state === 'loading') return <div className="center muted">กำลังโหลด…</div>;

  // ลิงก์เชิญ /join/<รหัส>: เปิดได้ทั้งยังไม่ล็อกอิน / รออนุมัติ / ใช้งานอยู่
  if (location.pathname.startsWith('/join/') && state !== 'error') {
    return (
      <Routes>
        <Route path="/join/:code" element={<JoinPage me={state === 'ready' ? me : null} reload={reload} />} />
      </Routes>
    );
  }
  if (state === 'error') {
    return (
      <div className="center">
        <p className="error-text">{error}</p>
        <button className="btn" onClick={() => { setState('loading'); void reload(); }}>ลองใหม่</button>
      </div>
    );
  }
  if (state === 'guest' || !me) return <LoginPage />;

  return (
    <MeContext.Provider value={{ me, reload, logout }}>
      {me.user.status !== 'active' ? (
        <PendingPage />
      ) : (
        <Routes>
          <Route index element={<ChatListPage />} />
          <Route path="new" element={<NewChatPage />} />
          <Route path="room/:id" element={<ChatRoomPage />} />
          <Route path="channels" element={<ChannelsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="form/:formId" element={<FormFillPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="admin/bots" element={me.user.role === 'admin' ? <AdminBotsPage /> : <Navigate to="/" replace />} />
          <Route path="admin/forms" element={me.user.role === 'admin' ? <AdminFormsPage /> : <Navigate to="/" replace />} />
          <Route path="admin" element={me.user.role === 'admin' ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </MeContext.Provider>
  );
}

// ติดตั้งแอป + แจ้งเตือน: ต้องดักเหตุการณ์ติดตั้งตั้งแต่เปิดหน้า
initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NoticeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </NoticeProvider>
  </StrictMode>,
);
