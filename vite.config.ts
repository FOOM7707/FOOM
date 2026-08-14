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
    // 배포 환경에서는 Hosting rewrite가 /api/** 를 함수로 보냅니다(firebase.json).
    // 로컬에는 그게 없으므로 개발 서버가 대신 함수 에뮬레이터로 넘깁니다.
    // 덕분에 프론트 코드는 로컬이든 배포든 "/api/..." 하나만 부르면 됩니다.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5001",
        changeOrigin: true,
        rewrite: (path) => `/demo-foom/asia-northeast3/api${path}`,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
