/**
 * Cloud Functions API 호출 공통부.
 *
 * 경로는 항상 `/api/...` 상대경로입니다 — 배포에서는 Hosting rewrite가, 로컬에서는
 * Vite 프록시가 함수로 넘겨줍니다. 절대 URL을 쓰면 두 환경 중 하나가 깨집니다.
 *
 * 서버 에러 형식(`{ error: { code, message } }`)을 그대로 예외로 옮겨서,
 * 화면이 사용자에게 보여줄 문구를 서버 한 곳에서 관리하게 합니다.
 */

import { firebaseAuth } from "./firebaseClient";

export type ApiErrorCode =
  | "unauthenticated"
  | "permission-denied"
  | "invalid-argument"
  | "failed-precondition"
  | "not-found"
  | "internal"
  | "network";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** true면 로그인하지 않았을 때 즉시 실패시킵니다 */
  requireAuth?: boolean;
}

async function authHeader(requireAuth: boolean): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    if (requireAuth) {
      throw new ApiError("unauthenticated", "로그인이 필요합니다");
    }
    return {};
  }
  // 매 호출마다 SDK가 캐시된 토큰을 주고, 만료가 임박하면 알아서 갱신합니다.
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, requireAuth = false } = options;

  const headers: Record<string, string> = await authHeader(requireAuth);
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const code = (payload?.error?.code as ApiErrorCode) ?? "internal";
    const message = payload?.error?.message ?? "요청을 처리하지 못했습니다";
    throw new ApiError(code, message, res.status);
  }

  return payload as T;
}
