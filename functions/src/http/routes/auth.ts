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
 * 카카오도 같은 구조입니다(v19). 갈라지는 것은 토큰 교환·프로필 조회뿐이고
 * `upsertSocialUser` 아래는 그대로 재사용합니다.
 *
 * **카카오만 인가 시작을 서버가 대신합니다** (`GET /auth/social/kakao/start`).
 * 카카오는 인가 주소의 `client_id`에 **REST API 키**를 쓰는데, 그 키는 주소 검색
 * (`GET /external/kakao-map/search`)에도 쓰이고 **도메인 제한이 없습니다.** 프론트
 * 번들에 넣으면 긁어가서 우리 쿼터로 씁니다. 서버가 302로 넘기면 번들에는 남지
 * 않습니다. 네이버는 Client ID가 로그인 전용이라 프론트에서 바로 만듭니다.
 */

import express, { type Router } from "express";
import {
  KAKAO_CLIENT_SECRET,
  KAKAO_REST_API_KEY,
  NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET,
  optionalSecret,
  requireSecret,
} from "../../config/secrets";
import { AppError } from "../../lib/errors";
import { auth } from "../../lib/firebase";
import { buildAuthorizeUrl, createKakaoPort, type KakaoPort } from "../../lib/kakao";
import { createNaverPort, type NaverPort } from "../../lib/naver";
import { upsertSocialUser, type SocialUpsertDeps } from "../../lib/socialAuth";
import { db } from "../../lib/firebase";
import { asyncHandler } from "../middleware";

/** 테스트에서 네이버 호출부와 Auth를 갈아끼우기 위한 주입 지점. */
export interface AuthRouteDeps {
  naverPort?: NaverPort;
  kakaoPort?: KakaoPort;
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

/**
 * 카카오가 우리 대신 돌려보낼 주소. **미리 정해둔 목록 밖은 거부합니다.**
 *
 * 카카오도 콘솔에 등록된 주소만 받아주므로 이 검사가 없다고 뚫리지는 않습니다.
 * 다만 오타가 났을 때 **카카오 화면에서 알 수 없는 오류로 튕기는 대신** 우리 쪽에서
 * 무엇이 틀렸는지 알려주려고 둡니다 — 이런 값은 틀려도 조용히 실패합니다.
 */
const ALLOWED_KAKAO_REDIRECTS = [
  "http://localhost:5173/auth/kakao/callback",
  "https://foom.kr/auth/kakao/callback",
];

function assertAllowedRedirect(value: unknown): string {
  const uri = typeof value === "string" ? value.trim() : "";
  if (!ALLOWED_KAKAO_REDIRECTS.includes(uri)) {
    throw new AppError(
      "invalid-argument",
      "등록되지 않은 콜백 주소입니다. 카카오 콘솔의 Redirect URI와 같은 값인지 확인하세요."
    );
  }
  return uri;
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

  // 인가 시작 — 서버가 REST API 키를 붙여 카카오로 넘깁니다(위 주석 참고).
  //
  // state(CSRF 난수)는 **프론트가 만들어** sessionStorage에 두고 콜백에서 대조합니다.
  // 서버는 세션을 들고 있지 않아 대조할 기준이 없으므로, 여기서는 받은 값을
  // 그대로 실어 보내기만 합니다. 네이버와 같은 방식입니다.
  router.get(
    "/social/kakao/start",
    asyncHandler(async (req, res) => {
      const state = requireString(req.query.state, "state");
      const redirectUri = assertAllowedRedirect(req.query.redirectUri);

      const restApiKey = requireSecret(
        KAKAO_REST_API_KEY,
        "KAKAO_REST_API_KEY",
        "functions/.secret.local (로컬) 또는 Firebase 시크릿(운영)"
      );

      res.redirect(302, buildAuthorizeUrl({ restApiKey, redirectUri, state }));
    })
  );

  router.post(
    "/social/kakao",
    asyncHandler(async (req, res) => {
      const code = requireString(req.body?.code, "code");
      // 카카오는 **인가 때 쓴 주소와 같은지 대조**합니다. 네이버에는 없는 단계라
      // 프론트가 쓴 값을 그대로 받아 넘깁니다(값 자체는 위에서 검사합니다).
      const redirectUri = assertAllowedRedirect(req.body?.redirectUri);

      const kakaoPort =
        overrides.kakaoPort ??
        createKakaoPort({
          restApiKey: requireSecret(
            KAKAO_REST_API_KEY,
            "KAKAO_REST_API_KEY",
            "functions/.secret.local (로컬) 또는 Firebase 시크릿(운영)"
          ),
          // 콘솔에서 켜지 않았으면 빈 값입니다 — 그때는 보내지 않습니다.
          clientSecret: optionalSecret(KAKAO_CLIENT_SECRET),
        });

      const accessToken = await kakaoPort.exchangeCode(code, redirectUri);
      const profile = await kakaoPort.fetchProfile(accessToken);

      const result = await upsertSocialUser(
        { provider: "kakao", profile, marketingAgreed: req.body?.marketingAgreed === true },
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
