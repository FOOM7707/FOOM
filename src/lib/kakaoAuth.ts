/**
 * 카카오 로그인 시작 (스키마 15-7).
 *
 * **네이버와 다른 점이 하나 있습니다 — 인가 주소를 서버가 만듭니다.**
 *
 * 카카오는 인가 주소의 `client_id`에 **REST API 키**를 씁니다. 그런데 그 키는
 * 주소 검색(`GET /external/kakao-map/search`)에도 쓰이고 **도메인 제한이 없습니다.**
 * 프론트 번들에 넣으면 긁어가서 우리 쿼터로 씁니다 — 봇은 OAuth 버튼을 누르지
 * 않지만 번들은 훑습니다. 그래서 `/api/auth/social/kakao/start`로 보내고 서버가
 * 키를 붙여 302로 넘깁니다.
 *
 * 네이버는 Client ID가 로그인 전용이라 프론트에서 바로 만듭니다(`naverAuth.ts`).
 *
 * **state(CSRF 난수)는 여기서 만듭니다.** 서버는 세션을 들고 있지 않아 대조할
 * 기준이 없으므로, 만든 쪽이 `sessionStorage`에 두고 콜백에서 대조합니다.
 */

const STATE_KEY = "foom.kakao.oauth.state";
const RETURN_TO_KEY = "foom.kakao.oauth.returnTo";

/**
 * 콜백 주소. **카카오 콘솔에 등록된 문자열과 완전히 일치해야 합니다.**
 *
 * 등록된 값:
 *   http://localhost:5173/auth/kakao/callback
 *   https://foom.kr/auth/kakao/callback
 *
 * 서버도 같은 목록을 갖고 있어 목록 밖 주소는 거부합니다(routes/auth.ts).
 * 로컬에서는 `127.0.0.1:5173`이 아니라 **`localhost:5173`으로 접속**해야 합니다 —
 * 카카오 입장에서 둘은 다른 주소입니다(네이버와 같은 함정).
 */
export function kakaoCallbackUrl(): string {
  return `${window.location.origin}/auth/kakao/callback`;
}

function issueState(): string {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  return state;
}

export function consumeState(): string | null {
  const state = sessionStorage.getItem(STATE_KEY);
  // 한 번 쓰면 버립니다 — 재사용되면 방어 의미가 없습니다.
  sessionStorage.removeItem(STATE_KEY);
  return state;
}

export function consumeReturnTo(): string {
  const path = sessionStorage.getItem(RETURN_TO_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  // 외부 주소로 튕겨나가지 않도록 내부 경로만 허용합니다.
  if (path && path.startsWith("/") && !path.startsWith("//")) return path;
  return "/";
}

/** 카카오 로그인 화면으로 이동합니다(서버 경유). */
export function startKakaoLogin(returnTo: string = window.location.pathname): void {
  sessionStorage.setItem(RETURN_TO_KEY, returnTo);

  const params = new URLSearchParams({
    state: issueState(),
    redirectUri: kakaoCallbackUrl(),
  });

  window.location.href = `/api/auth/social/kakao/start?${params.toString()}`;
}
