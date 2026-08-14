/**
 * 네이버 로그인 시작 (스키마 15-7).
 *
 * 인가 요청은 프론트가 만들고, 인가코드를 받은 뒤부터는 서버가 처리합니다.
 * 이름·이메일·전화번호는 **서버가 네이버에 직접 물어보므로** 여기서 다루지 않습니다.
 */

const AUTHORIZE_ENDPOINT = "https://nid.naver.com/oauth2.0/authorize";

const STATE_KEY = "foom.naver.oauth.state";
const RETURN_TO_KEY = "foom.naver.oauth.returnTo";

/**
 * 콜백 주소. 네이버 개발자센터에 등록된 문자열과 **완전히 일치**해야 합니다.
 *
 * 등록된 값 (15-7):
 *   http://localhost:5173/auth/naver/callback
 *   https://foom.kr/auth/naver/callback
 *
 * origin에서 만들기 때문에 두 환경 모두 자동으로 맞습니다. 다만 로컬에서는
 * `127.0.0.1:5173`이 아니라 **`localhost:5173`으로 접속**해야 합니다 —
 * 등록된 문자열이 localhost이고, 다르면 네이버가 요청을 거부합니다.
 */
export function naverCallbackUrl(): string {
  return `${window.location.origin}/auth/naver/callback`;
}

/**
 * CSRF 방어용 난수를 만들어 보관합니다.
 *
 * 이게 없으면 공격자가 자기 인가코드를 피해자 브라우저에서 실행시켜
 * **피해자 세션에 공격자의 네이버 계정을 붙일 수 있습니다.**
 * 콜백에서 반드시 대조합니다.
 */
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

/** 네이버 로그인 화면으로 이동합니다. */
export function startNaverLogin(returnTo: string = window.location.pathname): void {
  const clientId = import.meta.env.VITE_NAVER_CLIENT_ID;
  if (!clientId) {
    // 키가 없을 때 조용히 아무 일도 일어나지 않으면 원인을 찾기 어렵습니다.
    throw new Error(
      "[설정 누락] VITE_NAVER_CLIENT_ID 값이 없습니다. .env 파일을 확인하세요."
    );
  }

  sessionStorage.setItem(RETURN_TO_KEY, returnTo);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: naverCallbackUrl(),
    state: issueState(),
  });

  window.location.href = `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}
