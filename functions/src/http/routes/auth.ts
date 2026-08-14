/**
 * 소셜 로그인 엔드포인트 (스키마 15-7).
 *
 * 흐름: 네이버 → 프론트 콜백 화면(`/auth/naver/callback`) → 프론트가 **인가코드와
 * state만** 여기로 전달 → 서버가 토큰 교환·프로필 조회·`users` 처리 →
 * Custom Token 반환 → 프론트가 `signInWithCustomToken()`.
 *
 * **state 검증은 프론트가 합니다.** 인가 요청을 만든 쪽이 프론트라 난수도 거기서
 * 만들어 `sessionStorage`에 두고 콜백에서 대조합니다. 서버는 세션을 들고 있지
 * 않으므로 대조할 기준이 없고, 받은 state는 네이버 토큰 교환에 그대로 넘깁니다.
 *
 * 카카오는 아직 심사 전이라 붙이지 않았습니다. 붙일 때 `provider`만 갈라지고
 * 아래 `upsertSocialUser` 경로는 그대로 재사용합니다.
 */

import express, { type Router } from "express";
import { NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, requireSecret } from "../../config/secrets";
import { AppError } from "../../lib/errors";
import { auth } from "../../lib/firebase";
import { createNaverPort, type NaverPort } from "../../lib/naver";
import { upsertSocialUser, type SocialUpsertDeps } from "../../lib/socialAuth";
import { db } from "../../lib/firebase";
import { asyncHandler } from "../middleware";

/** 테스트에서 네이버 호출부와 Auth를 갈아끼우기 위한 주입 지점. */
export interface AuthRouteDeps {
  naverPort?: NaverPort;
  upsertDeps?: SocialUpsertDeps;
  createCustomToken?: (uid: string) => Promise<string>;
}

function defaultUpsertDeps(): SocialUpsertDeps {
  const a = auth();
  return {
    db: db(),
    authUser: {
      async getUser(uid) {
        try {
          const user = await a.getUser(uid);
          return { uid: user.uid };
        } catch {
          return null; // 없는 계정
        }
      },
      async createUser(uid) {
        await a.createUser({ uid });
      },
    },
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("invalid-argument", `${field} 값이 필요합니다`);
  }
  return value.trim();
}

export function buildAuthRouter(overrides: AuthRouteDeps = {}): Router {
  const router = express.Router();

  router.post(
    "/social/naver",
    asyncHandler(async (req, res) => {
      const code = requireString(req.body?.code, "code");
      const state = requireString(req.body?.state, "state");

      // 키가 없으면 조용히 실패하지 않고 어느 값이 어디에 없는지 알립니다.
      const naverPort =
        overrides.naverPort ??
        createNaverPort({
          clientId: requireSecret(
            { value: () => NAVER_CLIENT_ID.value() },
            "NAVER_CLIENT_ID",
            "functions/.env (로컬) 또는 함수 환경변수(운영)"
          ),
          clientSecret: requireSecret(
            NAVER_CLIENT_SECRET,
            "NAVER_CLIENT_SECRET",
            "functions/.secret.local (로컬) 또는 Firebase 시크릿(운영)"
          ),
        });

      const accessToken = await naverPort.exchangeCode(code, state);
      const profile = await naverPort.fetchProfile(accessToken);

      const result = await upsertSocialUser(
        { provider: "naver", profile, marketingAgreed: req.body?.marketingAgreed === true },
        overrides.upsertDeps ?? defaultUpsertDeps()
      );

      const mintToken =
        overrides.createCustomToken ?? ((uid: string) => auth().createCustomToken(uid));

      res.json({
        customToken: await mintToken(result.uid),
        isNew: result.isNew,
      });
    })
  );

  return router;
}
