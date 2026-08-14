import { defineConfig } from "vitest/config";

// functions 전용 테스트. 루트의 보안규칙 테스트(tests/rules/, vitest.rules.config.ts)와
// 완전히 분리돼 있습니다 — 실행 대상 에뮬레이터도 다릅니다(여기: auth+functions+firestore).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // 같은 에뮬레이터 인스턴스를 공유하므로 파일 병렬 실행을 끕니다.
    fileParallelism: false,
  },
});
