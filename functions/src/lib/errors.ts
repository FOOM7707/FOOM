/**
 * 에러 응답 형식 통일.
 *
 * 코드값은 Firebase `HttpsError`와 같은 이름을 씁니다. 지금은 REST(onRequest+Express)
 * 구조지만(6-2 ① 채택 근거), 나중에 일부 엔드포인트를 callable로 옮기더라도
 * 코드 문자열을 그대로 들고 갈 수 있습니다.
 *
 * 문서 6-2의 예시는 `new AppError('unauthenticated', 401)`처럼 HTTP 상태를 인자로
 * 넘겼지만, 여기서는 코드에서 상태를 유도합니다. 상태를 매번 손으로 적으면
 * 'permission-denied'에 401을 붙이는 식의 불일치가 생기고, 그건 컴파일러가 못 잡습니다.
 */

export type ErrorCode =
  | "unauthenticated"
  | "permission-denied"
  | "invalid-argument"
  | "failed-precondition"
  | "not-found"
  | "internal";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  "permission-denied": 403,
  "invalid-argument": 400,
  "failed-precondition": 400,
  "not-found": 404,
  internal: 500,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  unauthenticated: "로그인이 필요합니다",
  "permission-denied": "권한이 없습니다",
  "invalid-argument": "요청 값이 올바르지 않습니다",
  "failed-precondition": "선행 조건이 충족되지 않았습니다",
  "not-found": "대상을 찾을 수 없습니다",
  internal: "서버 오류가 발생했습니다",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export interface ErrorResponseBody {
  error: { code: ErrorCode; message: string };
}

/**
 * 클라이언트로 내보낼 응답 본문.
 * AppError가 아닌 예외는 내부 사정이 새어 나가지 않도록 internal로 뭉갭니다 —
 * 스택이나 Firestore 오류 문구가 그대로 나가면 그 자체가 정보 노출입니다.
 */
export function toErrorResponse(err: unknown): {
  status: number;
  body: ErrorResponseBody;
} {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message } },
    };
  }
  return {
    status: STATUS_BY_CODE.internal,
    body: { error: { code: "internal", message: DEFAULT_MESSAGE.internal } },
  };
}
