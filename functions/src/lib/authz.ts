/**
 * 권한 판단 — 순수 함수만 둡니다.
 *
 * 네트워크(토큰 검증)와 분리해 둔 이유: 이 판단이 뚫리면 정산 지급 API가 그대로
 * 열리므로(6-2 ①), 에뮬레이터 없이도 항상 돌아가는 단위 테스트로 고정해야 합니다.
 */

import { AppError } from "./errors";

/**
 * ID 토큰에서 우리가 실제로 보는 값만 추린 형태.
 * firebase-admin의 DecodedIdToken을 그대로 받되, 검사에 쓰는 필드만 명시합니다.
 */
export interface AuthClaims {
  uid: string;
  /** Custom Claims. 보안규칙의 isAdmin()도 이 값만 봅니다(12-3). */
  admin?: unknown;
  [key: string]: unknown;
}

/** 로그인 여부. 통과하면 이후 코드에서 uid를 안전하게 쓸 수 있습니다. */
export function assertSignedIn(claims: AuthClaims | undefined | null): AuthClaims {
  if (!claims || typeof claims.uid !== "string" || claims.uid.length === 0) {
    throw new AppError("unauthenticated", "로그인이 필요합니다");
  }
  return claims;
}

/**
 * 관리자 여부.
 *
 * `=== true`로 엄격히 비교합니다. 'false' 같은 문자열이나 1 같은 값이 들어와도
 * truthy로 통과하지 않게 하려는 것으로, Custom Claims는 임의 JSON이라
 * 값의 타입을 우리가 보장할 수 없습니다.
 */
export function assertAdmin(claims: AuthClaims | undefined | null): AuthClaims {
  const signedIn = assertSignedIn(claims);
  if (signedIn.admin !== true) {
    throw new AppError("permission-denied", "관리자 권한이 필요합니다");
  }
  return signedIn;
}

export function isAdmin(claims: AuthClaims | undefined | null): boolean {
  return !!claims && claims.admin === true;
}
