/**
 * 카카오 로그인 연동 (스키마 15-7).
 *
 * 네이버와 같은 구조입니다 — 클라이언트는 **인가코드만** 넘기고, 프로필은 서버가
 * 카카오에 직접 물어봅니다. 클라이언트가 보내온 이름·이메일·전화번호는 어떤 경우에도
 * 쓰지 않습니다(2-1).
 *
 * **네이버와 다른 점 셋:**
 *  ① 토큰 교환에 `redirect_uri`가 필요합니다. 카카오는 인가 때 쓴 값과 같은지
 *     대조하므로, 인가를 시작한 쪽(프론트)이 쓴 값을 그대로 넘겨야 합니다.
 *  ② `client_secret`이 **선택**입니다. 콘솔에서 「사용함」으로 켠 앱만 보냅니다 —
 *     켜지 않았는데 보내면 오히려 거부됩니다.
 *  ③ 실패해도 HTTP 200에 `error`를 담아 주는 경우가 있어 상태코드만 봐서는 안 됩니다.
 *
 * **비즈 앱 전환 전에는 이메일·전화번호가 오지 않습니다.** 그래도 가입은 됩니다 —
 * 두 값 모두 없어도 되도록 설계돼 있습니다(2-1 / 15-4). 닉네임이 없으면 표시 이름은
 * `이용자XXXX`로 채워집니다.
 */

import { AppError } from "./errors";
import type { SocialProfile } from "./naver";

const TOKEN_ENDPOINT = "https://kauth.kakao.com/oauth/token";
const PROFILE_ENDPOINT = "https://kapi.kakao.com/v2/user/me";
export const AUTHORIZE_ENDPOINT = "https://kauth.kakao.com/oauth/authorize";

/** 테스트에서 갈아끼울 수 있도록 HTTP 호출부를 인터페이스로 분리합니다. */
export interface KakaoPort {
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<SocialProfile>;
}

interface KakaoCredentials {
  restApiKey: string;
  /** 콘솔에서 「사용함」으로 켰을 때만 값이 있습니다. 비어 있으면 보내지 않습니다 */
  clientSecret?: string;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 카카오 응답 → 우리 프로필.
 *
 * 응답 객체를 통째로 넘기지 않습니다 — 통째로 넘기면 나중에 누군가 저장하거나
 * 로그에 찍게 됩니다. 아래 4개 필드가 밖으로 나가는 전부입니다(개인정보 최소수집).
 * 실명(`name`)·성별·생일·연령대는 **의도적으로 읽지 않습니다**(15-1).
 */
export function toSocialProfile(response: Record<string, unknown>): SocialProfile {
  // 카카오 회원번호는 숫자로 옵니다. uid를 만드는 값이라 문자열로 고정합니다 —
  // 큰 정수라 JSON 파싱 과정에서 정밀도가 흔들리면 다른 사람 계정이 됩니다.
  const rawId = response.id;
  const id =
    typeof rawId === "number" && Number.isSafeInteger(rawId)
      ? String(rawId)
      : nonEmpty(rawId);
  if (!id) {
    throw new AppError("internal", "카카오 응답에 회원번호가 없습니다");
  }

  const account = (response.kakao_account ?? {}) as Record<string, unknown>;
  const profile = (account.profile ?? {}) as Record<string, unknown>;
  // 동의항목을 끄면 kakao_account에 아예 키가 없습니다. properties가 옛 경로라
  // 닉네임만 그쪽에서 한 번 더 찾아봅니다.
  const properties = (response.properties ?? {}) as Record<string, unknown>;

  return {
    providerUserId: id,
    nickname: nonEmpty(profile.nickname) ?? nonEmpty(properties.nickname),
    email: nonEmpty(account.email),
    // "+82 10-1234-5678" 형태로 옵니다. E.164 정규화는 upsert 쪽 normalizePhone이 합니다.
    phone: nonEmpty(account.phone_number),
    profileImageUrl:
      nonEmpty(profile.profile_image_url) ?? nonEmpty(properties.profile_image),
  };
}

/**
 * 토큰 교환 실패 원인 안내.
 *
 * 이 단계는 원인이 여러 갈래인데 **증상이 전부 같습니다** — 로그인이 안 되고
 * 「인가코드가 유효하지 않다」만 뜹니다. 실제로 겪은 순서대로 적어둡니다.
 */
function kakaoTokenErrorHint(code: string | null, error: unknown): string {
  if (code === "KOE010" || error === "invalid_client") {
    return (
      "Client Secret이 맞지 않습니다. 카카오 콘솔에서 「사용함」으로 켰다면 " +
      "functions/.secret.local의 KAKAO_CLIENT_SECRET에 값을 넣어야 하고, " +
      "켜지 않았다면 그 값을 비워둬야 합니다."
    );
  }
  if (code === "KOE101") {
    return "앱 키가 맞지 않습니다. KAKAO_REST_API_KEY가 REST API 키인지 확인하세요.";
  }
  if (code === "KOE320" || error === "invalid_grant") {
    return (
      "인가코드를 쓸 수 없습니다. 이미 사용됐거나(새로고침·중복 호출), 만료됐거나, " +
      "콜백 주소가 인가 때와 다릅니다. 로그인을 처음부터 다시 시도해 보세요."
    );
  }
  return "카카오 콘솔의 Redirect URI와 Client Secret 설정을 확인하세요.";
}

/** 인가 요청 주소. 서버가 만들어 302로 넘깁니다 — 근거는 routes/auth.ts */
export function buildAuthorizeUrl(params: {
  restApiKey: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.restApiKey,
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  return `${AUTHORIZE_ENDPOINT}?${query.toString()}`;
}

export function createKakaoPort(credentials: KakaoCredentials): KakaoPort {
  return {
    async exchangeCode(code, redirectUri) {
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: credentials.restApiKey,
        redirect_uri: redirectUri,
        code,
      });
      // 콘솔에서 켜지 않은 앱에 보내면 거부되므로 값이 있을 때만 넣습니다.
      if (credentials.clientSecret) {
        form.set("client_secret", credentials.clientSecret);
      }

      const res = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        // 본문을 그대로 내보내지 않습니다 — 요청 파라미터가 에코되는 경우가 있어
        // client_secret이 그대로 새어 나갈 수 있습니다.
        console.error("[kakao] token exchange failed", {
          status: res.status,
          error: body.error,
          code: body.error_code,
          description: body.error_description,
        });

        // **카카오 오류 코드는 화면까지 올립니다.** 비밀값이 아니고, 이 단계의
        // 실패는 원인이 여러 갈래(Client Secret 설정·콜백 주소 불일치·코드 재사용)인데
        // 증상이 전부 똑같아서 코드 없이는 추측밖에 할 수 없습니다.
        const code = typeof body.error_code === "string" ? body.error_code : null;
        const hint = kakaoTokenErrorHint(code, body.error);
        throw new AppError(
          "invalid-argument",
          `카카오 인증에 실패했습니다${code ? ` (${code})` : ""}. ${hint}`
        );
      }

      const accessToken = nonEmpty(body.access_token);
      if (!accessToken) {
        console.error("[kakao] token response has no access_token", {
          error: body.error,
        });
        throw new AppError("internal", "카카오 인증에 실패했습니다");
      }
      return accessToken;
    },

    async fetchProfile(accessToken) {
      const res = await fetch(PROFILE_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
      });
      if (!res.ok) {
        console.error("[kakao] profile fetch failed", { status: res.status });
        throw new AppError("internal", "카카오 프로필 조회에 실패했습니다");
      }
      const body = (await res.json()) as Record<string, unknown>;
      return toSocialProfile(body);
    },
  };
}
