/**
 * 외부 서비스 키 보관 구조.
 *
 * ┌────────────────────┬──────────────────────────────┬────────────────────────────┐
 * │ 값                 │ 어디에 두나                  │ 어떻게 읽나                │
 * ├────────────────────┼──────────────────────────────┼────────────────────────────┤
 * │ 네이버 Client ID   │ functions/.env               │ defineString (비밀 아님)   │
 * │ (서버용)           │                              │                            │
 * │ 네이버 Client ID   │ 루트 .env → VITE_NAVER_...   │ 프론트 빌드에 포함됨       │
 * │ (프론트용)         │                              │ (공개돼도 되는 값)         │
 * │ 네이버 Client      │ 운영: Firebase 시크릿        │ defineSecret               │
 * │ Secret             │ 로컬: functions/.secret.local│                            │
 * └────────────────────┴──────────────────────────────┴────────────────────────────┘
 *
 * ⚠️ Client Secret에는 절대 VITE_ 접두사를 붙이지 마세요.
 *    Vite는 VITE_로 시작하는 환경변수를 **번들에 그대로 인라인**하므로,
 *    붙이는 순간 브라우저에서 누구나 읽을 수 있습니다. 서버 전용 값은
 *    functions 쪽에만 두고 프론트로 내려보내지 않습니다.
 */

import { defineSecret, defineString } from "firebase-functions/params";

/** 네이버 로그인 Client ID — 공개 값이지만 서버 쪽 토큰 교환에도 필요합니다. */
export const NAVER_CLIENT_ID = defineString("NAVER_CLIENT_ID", { default: "" });

/** 네이버 로그인 Client Secret — 서버 전용. */
export const NAVER_CLIENT_SECRET = defineSecret("NAVER_CLIENT_SECRET");

/**
 * 기상청(공공데이터포털) 인증키 — 서버 전용 (16-3).
 *
 * 쿼리스트링에 그대로 실려 나가는 값이라 프론트에 두면 즉시 유출됩니다.
 * **「일반 인증키(Decoding)」를 넣으세요** — 이중 인코딩 문제는 lib/kma.ts 주석 참고.
 */
export const KMA_SERVICE_KEY = defineSecret("KMA_SERVICE_KEY");

/** 함수에 바인딩할 시크릿 목록. onRequest 옵션에 그대로 넘깁니다. */
export const RUNTIME_SECRETS = [NAVER_CLIENT_SECRET, KMA_SERVICE_KEY];

interface SecretLike {
  value(): string;
}

/**
 * 값을 안전하게 꺼냅니다. 없으면 **명확한 에러로 즉시 실패**합니다.
 *
 * 키가 없을 때 조용히 빈 문자열로 진행하면 "네이버 로그인이 가끔 안 된다" 같은
 * 재현 안 되는 증상으로 나타납니다. 어느 키가 어디에 없는지까지 메시지에 적되,
 * **값 자체는 절대 로그·에러 메시지에 남기지 않습니다.**
 */
export function requireSecret(param: SecretLike, name: string, where: string): string {
  let value = "";
  try {
    value = param.value();
  } catch {
    // 시크릿이 함수에 바인딩되지 않은 경우 value()가 던집니다.
    value = "";
  }
  if (!value) {
    throw new Error(
      `[설정 누락] ${name} 값이 없습니다. ${where}에 값을 넣은 뒤 다시 실행하세요.`
    );
  }
  return value;
}

export type ConfigState = "set" | "missing";

function stateOf(param: SecretLike): ConfigState {
  try {
    return param.value() ? "set" : "missing";
  } catch {
    return "missing";
  }
}

/**
 * 설정 여부만 돌려줍니다. **값은 어떤 경우에도 반환하지 않습니다** —
 * 이 결과는 관리자 화면·로그로 나가므로 값이 섞이면 그대로 유출입니다.
 */
export function configStatus(): Record<string, ConfigState> {
  return {
    NAVER_CLIENT_ID: stateOf(NAVER_CLIENT_ID),
    NAVER_CLIENT_SECRET: stateOf(NAVER_CLIENT_SECRET),
    KMA_SERVICE_KEY: stateOf(KMA_SERVICE_KEY),
  };
}
