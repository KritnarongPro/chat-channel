import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// ---------------------------------------------------------------------
// รหัสเวอร์ชันของแต่ละ build (เวลาไทย + ค่าสุ่ม) — ฝังในโค้ดหน้าเว็บ และเขียน dist/version.json
// หน้าเว็บที่เปิดค้างไว้จะโหลด version.json มาเทียบ ถ้าไม่ตรง = มีเวอร์ชันใหม่ → แจ้งให้โหลดใหม่
// ---------------------------------------------------------------------
const BUILD_ID =
  new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace(/[-:T]/g, '') + '-' +
  Math.random().toString(36).slice(2, 8);

function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId: BUILD_ID }) });
    },
  };
}

// npm run dev → หน้าเว็บที่ :5173 ส่ง /api (รวม WebSocket) ไปที่ wrangler dev (:8787)
export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
});
