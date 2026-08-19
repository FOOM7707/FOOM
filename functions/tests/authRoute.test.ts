/**
 * POST /auth/social/naver · /auth/social/kakao 배선 확인.
 *
 * 네이버 서버는 에뮬레이터에 없으므로 HTTP 호출부(NaverPort)만 스텁으로 갈아끼우고
 * 나머지(라우터 연결, 입력 검증, 에러 형식, Firestore 기록)는 실제로 돌립니다.
 * 로직 테스트(socialAuth.test.ts)와 별개로 이 파일이 필요한 이유는,
 * 라우터를 app에 붙이는 줄을 빠뜨려도 로직 테스트는 전부 통과하기 때문입니다.
 */

import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app";
import type { KakaoPort } from "../src/lib/kakao";
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

/** 카카오 대신 고정 응답을 돌려주는 스텁. */
const kakaoPort: KakaoPort = {
  async exchangeCode(code) {
    if (code === "bad-code") {
      const { AppError } = await import("../src/lib/errors");
      throw new AppError("invalid-argument", "인가코드가 유효하지 않습니다");
    }
    return "stub-kakao-token";
  },
  async fetchProfile() {
    // 비즈 앱 전환 전 상태 — 이메일·전화번호가 오지 않습니다.
    return {
      providerUserId: "kakao-route-1",
      nickname: "카카오테스트",
      email: null,
      phone: null,
      profileImageUrl: null,
    };
  },
};

const KAKAO_REDIRECT = "http://localhost:5173/auth/kakao/callback";

beforeAll(async () => {
  // defineSecret은 실행 시점에 process.env를 읽습니다. 인가 시작 경로가 REST API
  // 키를 요구하므로 테스트 값으로 채웁니다(실제 키는 필요 없습니다).
  process.env.KAKAO_REST_API_KEY = "test-rest-key";

  const app = createApp({
    naverPort,
    kakaoPort,
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

async function get(path: string) {
  // 302를 그대로 보려면 따라가지 않게 해야 합니다.
  return fetch(`${baseUrl}${path}`, { redirect: "manual" });
}

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

describe("POST /auth/social/kakao", () => {
  it("인가코드로 Custom Token을 발급한다", async () => {
    const res = await post("/auth/social/kakao", {
      code: "good",
      redirectUri: KAKAO_REDIRECT,
    });
    expect(res.status).toBe(200);
    // uid에 공급자 접두사가 붙어야 네이버 식별자와 우연히 겹쳐도 다른 계정이 됩니다.
    expect(res.body.customToken).toBe("stub-token-for-kakao_kakao-route-1");
  });

  it("users 문서에 authProvider=kakao로 기록된다", async () => {
    await post("/auth/social/kakao", { code: "good", redirectUri: KAKAO_REDIRECT });
    const snap = await testDb.doc("users/kakao_kakao-route-1").get();
    expect(snap.exists).toBe(true);
    expect(snap.get("authProvider")).toBe("kakao");
    expect(snap.get("role")).toBe("consumer");
  });

  it("이메일·전화번호가 없어도 가입된다 (비즈 앱 전환 전 상태)", async () => {
    await post("/auth/social/kakao", { code: "good", redirectUri: KAKAO_REDIRECT });
    const snap = await testDb.doc("users/kakao_kakao-route-1").get();
    // 표시 이름은 닉네임에서 나옵니다. 닉네임도 없으면 `이용자XXXX`로 채워집니다(2-1).
    expect(snap.get("name")).toBe("카카오테스트");
    expect(snap.get("email") ?? null).toBeNull();
    expect(snap.get("phone") ?? null).toBeNull();
  });

  it("등록되지 않은 콜백 주소는 거부한다", async () => {
    const res = await post("/auth/social/kakao", {
      code: "good",
      redirectUri: "https://evil.example.com/auth/kakao/callback",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-argument");
  });

  it("콜백 주소가 없으면 400", async () => {
    const res = await post("/auth/social/kakao", { code: "good" });
    expect(res.status).toBe(400);
  });

  it("code가 없으면 400", async () => {
    const res = await post("/auth/social/kakao", { redirectUri: KAKAO_REDIRECT });
    expect(res.status).toBe(400);
  });

  it("카카오가 인가코드를 거절하면 같은 에러 형식으로 내려간다", async () => {
    const res = await post("/auth/social/kakao", {
      code: "bad-code",
      redirectUri: KAKAO_REDIRECT,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-argument");
  });
});

describe("GET /auth/social/kakao/start", () => {
  it("카카오 인가 화면으로 302를 보낸다", async () => {
    const res = await get(
      `/auth/social/kakao/start?state=s1&redirectUri=${encodeURIComponent(KAKAO_REDIRECT)}`
    );
    expect(res.status).toBe(302);

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://kauth.kakao.com/oauth/authorize"
    );
    expect(location.searchParams.get("client_id")).toBe("test-rest-key");
    expect(location.searchParams.get("state")).toBe("s1");
    expect(location.searchParams.get("redirect_uri")).toBe(KAKAO_REDIRECT);
  });

  it("state가 없으면 400 — CSRF 난수 없이 시작하면 콜백에서 대조할 값이 없다", async () => {
    const res = await get(
      `/auth/social/kakao/start?redirectUri=${encodeURIComponent(KAKAO_REDIRECT)}`
    );
    expect(res.status).toBe(400);
  });

  it("등록되지 않은 콜백 주소는 거부한다", async () => {
    const res = await get(
      "/auth/social/kakao/start?state=s1&redirectUri=https%3A%2F%2Fevil.example.com%2Fcb"
    );
    expect(res.status).toBe(400);
  });
});
