/**
 * 네이버 로그인 연동 (스키마 15-7).
 *
 * **프로필은 서버가 네이버에 직접 물어봅니다.** 클라이언트가 보내오는 것은
 * 인가코드와 state뿐이고, 이름·이메일·전화번호는 절대 클라이언트 값을 쓰지
 * 않습니다(2-1 / 5번 `POST /auth/identity/verify`와 같은 원칙).
 *
 * 실명·성별·생일·연령대는 응답에 섞여 와도 **여기서 걷어내고 밖으로 내보내지
 * 않습니다.** 아래 `toSocialProfile`이 통과시키는 4개 필드가 전부입니다.
 */

import { AppError } from "./errors";

const TOKEN_ENDPOINT = "https://nid.naver.com/oauth2.0/token";
const PROFILE_ENDPOINT = "https://openapi.naver.com/v1/nid/me";

/** 우리가 실제로 쓰는 값만 추린 프로필. 이 밖의 항목은 저장도 전달도 하지 않습니다. */
export interface SocialProfile {
  /** 공급자 내부 식별자 — Firebase uid를 만드는 데 씁니다 */
  providerUserId: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  profileImageUrl: string | null;
}

/** 테스트에서 갈아끼울 수 있도록 HTTP 호출부를 인터페이스로 분리합니다. */
export interface NaverPort {
  exchangeCode(code: string, state: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<SocialProfile>;
}

interface NaverCredentials {
  clientId: string;
  clientSecret: string;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 네이버 응답 → 우리 프로필.
 *
 * `name`(실명)·`gender`·`birthday`·`birthyear`·`age`는 **의도적으로 읽지 않습니다.**
 * 응답 객체를 통째로 넘기지 않는 이유이기도 합니다 — 통째로 넘기면 나중에 누군가
 * 저장하거나 로그에 찍게 됩니다(15-1, 개인정보 최소수집).
 */
export function toSocialProfile(response: Record<string, unknown>): SocialProfile {
  const id = nonEmpty(response.id);
  if (!id) {
    throw new AppError("internal", "네이버 응답에 식별자가 없습니다");
  }
  return {
    providerUserId: id,
    nickname: nonEmpty(response.nickname),
    email: nonEmpty(response.email),
    phone: nonEmpty(response.mobile),
    profileImageUrl: nonEmpty(response.profile_image),
  };
}

export function createNaverPort(credentials: NaverCredentials): NaverPort {
  return {
    async exchangeCode(code, state) {
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        state,
      });

      const res = await fetch(`${TOKEN_ENDPOINT}?${params.toString()}`, {
        method: "GET",
      });
      if (!res.ok) {
        // 네이버가 돌려준 본문을 그대로 내보내지 않습니다 — client_secret이
        // 에코되는 경우가 있어 그대로 노출하면 시크릿이 새어 나갑니다.
        console.error("[naver] token exchange failed", { status: res.status });
        throw new AppError("internal", "네이버 인증에 실패했습니다");
      }

      const body = (await res.json()) as Record<string, unknown>;
      const accessToken = nonEmpty(body.access_token);
      if (!accessToken) {
        // 네이버는 실패해도 HTTP 200에 error 필드를 담아 보내는 경우가 있습니다.
        console.error("[naver] token response has no access_token", {
          error: body.error,
        });
        throw new AppError("invalid-argument", "인가코드가 유효하지 않습니다");
      }
      return accessToken;
    },

    async fetchProfile(accessToken) {
      const res = await fetch(PROFILE_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        console.error("[naver] profile fetch failed", { status: res.status });
        throw new AppError("internal", "네이버 프로필 조회에 실패했습니다");
      }

      const body = (await res.json()) as Record<string, unknown>;
      if (body.resultcode !== "00") {
        console.error("[naver] profile resultcode not 00", {
          resultcode: body.resultcode,
        });
        throw new AppError("internal", "네이버 프로필 조회에 실패했습니다");
      }
      return toSocialProfile((body.response ?? {}) as Record<string, unknown>);
    },
  };
}
