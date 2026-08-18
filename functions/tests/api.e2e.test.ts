/**
 * 함수 에뮬레이터에 실제 HTTP 요청을 보내 진입부를 확인합니다 (6-2 ①).
 *
 * 단위 테스트(authz.test.ts)와 별개로 이 파일이 필요한 이유:
 * 미들웨어가 라우터에 **실제로 붙어 있는지**는 코드를 읽어서는 알 수 없습니다.
 * `adminRouter.use(...)` 한 줄을 빠뜨려도 단위 테스트는 전부 통과합니다.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { callApi, createSignedUpUser, issueIdToken, testAuth } from "./helpers";

describe("GET /health — 공개", () => {
  it("로그인 없이 200을 돌려준다", async () => {
    const res = await callApi("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("Hosting rewrite 경로(/api 접두사)로도 같은 응답이 온다", async () => {
    // 배포 환경에서는 /api/health 가 접두사째로 함수에 전달됩니다.
    const res = await callApi("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("/admin/* 진입부", () => {
  let consumerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const consumerUid = await createSignedUpUser();
    consumerToken = await issueIdToken(consumerUid);

    const adminUid = await createSignedUpUser();
    // 클레임을 먼저 심고 나서 토큰을 발급해야 토큰에 admin이 담깁니다.
    await testAuth.setCustomUserClaims(adminUid, { admin: true });
    adminToken = await issueIdToken(adminUid);
  });

  it("토큰 없이 호출하면 401 unauthenticated", async () => {
    const res = await callApi("/admin/health");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("깨진 토큰이면 401 unauthenticated", async () => {
    const res = await callApi("/admin/health", { idToken: "not-a-real-token" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("로그인했지만 관리자가 아니면 403 permission-denied", async () => {
    const res = await callApi("/admin/health", { idToken: consumerToken });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("permission-denied");
  });

  it("admin 클레임이 있으면 통과한다", async () => {
    const res = await callApi("/admin/health", { idToken: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(true);
  });

  it("설정 상태 조회는 값이 아니라 set/missing 만 돌려준다", async () => {
    const res = await callApi("/admin/config/status", { idToken: adminToken });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.config).sort()).toEqual([
      "NAVER_CLIENT_ID",
      "NAVER_CLIENT_SECRET",
    ]);
    for (const value of Object.values(res.body.config)) {
      expect(["set", "missing"]).toContain(value);
    }
  });

  it("일반 사용자는 설정 상태도 볼 수 없다", async () => {
    const res = await callApi("/admin/config/status", { idToken: consumerToken });
    expect(res.status).toBe(403);
  });

  // 심사 엔드포인트를 라우터에 붙일 때 차단선 뒤에 붙였는지 확인합니다.
  // 라우터 안쪽에 붙어 있으므로 새 경로를 추가해도 자동으로 보호되지만,
  // 실수로 app.ts 쪽에 직접 매달면 이 테스트가 잡아냅니다.
  const GUARDED = [
    { path: "/admin/providers", method: "GET" },
    { path: "/admin/programs", method: "GET" },
    { path: "/admin/providers/누군가/approve", method: "POST" },
    { path: "/admin/programs/뭔가/review", method: "POST" },
  ];

  for (const { path, method } of GUARDED) {
    it(`${method} ${path} — 비로그인 401 / 일반 사용자 403`, async () => {
      const body = method === "POST" ? { decision: "approved" } : undefined;

      const anon = await callApi(path, { method, body });
      expect(anon.status).toBe(401);

      const consumer = await callApi(path, { method, idToken: consumerToken, body });
      expect(consumer.status).toBe(403);
    });
  }

  it("관리자는 심사 목록을 조회할 수 있다", async () => {
    const res = await callApi("/admin/providers?status=pending", { idToken: adminToken });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.providers)).toBe(true);
  });
});

describe("GET /users/me", () => {
  it("로그인하지 않으면 401", async () => {
    const res = await callApi("/users/me");
    expect(res.status).toBe(401);
  });

  it("로그인하면 본인 정보를 돌려준다", async () => {
    const uid = await createSignedUpUser();
    const res = await callApi("/users/me", { idToken: await issueIdToken(uid) });

    expect(res.status).toBe(200);
    expect(res.body.user.uid).toBe(uid);
    expect(res.body.user.role).toBe("consumer");
    expect(res.body.isAdmin).toBe(false);
  });
});

describe("없는 경로", () => {
  it("404를 같은 에러 형식으로 돌려준다", async () => {
    const res = await callApi("/이런경로는없다");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not-found");
  });
});
