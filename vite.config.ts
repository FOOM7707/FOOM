import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 네이버 콜백 URL이 http://localhost:5173/auth/naver/callback 로 등록돼 있습니다(15-7).
  // 포트가 밀리면 로그인만 조용히 실패하므로, 5173을 못 잡으면 아예 뜨지 않게 합니다.
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
