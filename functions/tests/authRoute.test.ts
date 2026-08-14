/**
 * POST /auth/social/naver 배선 확인.
 *
 * 네이버 서버는 에뮬레이터에 없으므로 HTTP 호출부(NaverPort)만 스텁으로 갈아끼우고
 * 나머지(라우터 연결, 입력 검증, 에러 형식, Firestore 기록)는 실제로 돌립니다.
 * 로직 테스트(socialAuth.test.ts)와 별개로 이 파일이 필요한 이유는,
 * 라우터를 app에 붙이는 줄을 빠뜨려도 로직 테스트는 전부 통과하기 때문입니다.
 */

import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app";
import type { NaverPort, SocialProfile } from "../src/lib/naver";
import { testAuth, testDb } from "./helpers";

let server: Server;
let baseUrl: string;

/** 네이버 대신 고정 응답을 돌려주는 스텁. */
const stubProfile: SocialProfile = {
  providerUserId: "route-test-1",
  nickname: "라우트테스트",
  email: "route@example.com",
  phone: "010-2222-3333",
  profileImageUrl: null,
};

const naverPort: NaverPort = {
  async exchangeCode(code) {
    if (code === "bad-code") {
      const { AppError } = await import("../src/lib/errors");
      throw new AppError("invalid-argument", "인가코드가 유효하지 않습니다");
    }
    return "stub-access-token";
  },
  async fetchProfile() {
    return stubProfile;
  },
};

beforeAll(async () => {
  const app = createApp({
    naverPort,
    upsertDeps: {
      db: testDb,
      authUser: {
        async getUser(uid) {
          try {
            const u = await testAuth.getUser(uid);
            return { uid: u.uid };
          } catch {
            return null;
          }
        },
        async createUser(uid) {
          await testAuth.createUser({ uid });
        },
      },
    },
    createCustomToken: async (uid) => `stub-token-for-${uid}`,
  });

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("POST /auth/social/naver", () => {
  it("인가코드로 Custom Token을 발급한다", async () => {
    const res = await post("/auth/social/naver", { code: "good", state: "s1" });
    expect(res.status).toBe(200);
    expect(res.body.customToken).toBe("stub-token-for-naver_route-test-1");
    expect(typeof res.body.isNew).toBe("boolean");
  });

  it("users 문서가 실제로 만들어진다", async () => {
    await post("/auth/social/naver", { code: "good", state: "s1" });
    const snap = await testDb.doc("users/naver_route-test-1").get();
    expect(snap.exists).toBe(true);
    expect(snap.get("authProvider")).toBe("naver");
    expect(snap.get("role")).toBe("consumer");
  });

  it("Hosting rewrite 경로(/api 접두사)로도 동작한다", async () => {
    const res = await post("/api/auth/social/naver", { code: "good", state: "s1" });
    expect(res.status).toBe(200);
  });

  it("code가 없으면 400 invalid-argument", async () => {
    const res = await post("/auth/social/naver", { state: "s1" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-argument");
  });

  it("state가 없으면 400 invalid-argument", async () => {
    const res = await post("/auth/social/naver", { code: "good" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-argument");
  });

  it("네이버가 인가코드를 거절하면 같은 에러 형식으로 내려간다", async () => {
    const res = await post("/auth/social/naver", { code: "bad-code", state: "s1" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-argument");
  });

  it("로그인 엔드포인트는 인증 없이 열려 있다 (관리자 검사 대상 아님)", async () => {
    // /admin/* 과 달리 토큰 없이 호출돼야 정상입니다.
    const res = await post("/auth/social/naver", { code: "good", state: "s1" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
