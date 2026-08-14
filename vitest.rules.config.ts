import { defineConfig } from 'vitest/config'

// 보안규칙 테스트 전용 설정.
// 프론트엔드(src/)와 완전히 분리된 러너입니다 — 브라우저 DOM이 필요 없고,
// 에뮬레이터에 붙어 도는 통합 테스트라 실행 시간도 다릅니다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // 규칙 테스트는 같은 에뮬레이터 인스턴스를 공유하고 beforeEach마다
    // clearFirestore()로 전체를 비우므로, 병렬로 돌면 서로의 픽스처를 지웁니다.
    fileParallelism: false,
    // 에뮬레이터 첫 기동 직후 첫 요청이 느릴 수 있어 기본값보다 넉넉하게.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
})
