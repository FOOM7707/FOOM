/**
 * 공통 진입부 (스키마 6-2 ①, 13번 P0).
 *
 * **보안규칙은 Admin SDK에 적용되지 않으므로, /admin/* 에서는 이 미들웨어가
 * 유일한 차단선입니다.** 여기를 통과하면 Firestore의 어떤 문서든 읽고 쓸 수
 * 있습니다. 프론트엔드 라우트 가드는 UX 장치일 뿐 보안이 아닙니다(12-3).
 *
 * 라우터에 한 번만 붙입니다 — 경로마다 각자 검사하게 두면 새 엔드포인트를
 * 추가할 때 빠뜨리고, 빠뜨린 사실이 화면에 드러나지 않습니다.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { assertAdmin, assertSignedIn, type AuthClaims } from "../lib/authz";
import { AppError, toErrorResponse } from "../lib/errors";
import { auth } from "../lib/firebase";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** authenticate 통과 시에만 채워집니다. */
      auth?: AuthClaims;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

/**
 * Authorization: Bearer <idToken> 검증.
 *
 * checkRevoked는 P1입니다(6-2 ②). 켜면 호출마다 Auth 서버 왕복이 붙어
 * 수십 ms가 추가되므로 /admin/* 과 정산 엔드포인트에만 켤 예정입니다.
 * TODO(P1, 6-2 ②): /admin/* 에 한해 verifyIdToken(token, true)로 전환하고,
 *                  권한 회수 시 revokeRefreshTokens와 짝을 맞춰 동작 확인.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = bearerToken(req);
    if (!token) {
      throw new AppError("unauthenticated", "로그인이 필요합니다");
    }

    let decoded;
    try {
      decoded = await auth().verifyIdToken(token, false);
    } catch {
      // 만료·위조·프로젝트 불일치를 구분해 알려주지 않습니다 —
      // 공격자에게 토큰을 다듬을 힌트가 됩니다.
      throw new AppError("unauthenticated", "인증 정보가 유효하지 않습니다");
    }

    req.auth = assertSignedIn(decoded as unknown as AuthClaims);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * 토큰이 있으면 해석하고, 없으면 그냥 통과시킵니다.
 *
 * 비로그인도 볼 수 있지만 로그인하면 더 보이는 경로에 씁니다 —
 * 예: 게시된 프로그램은 누구나, 자기 draft는 소유자만.
 * **토큰이 깨진 경우는 통과시키지 않습니다.** 조용히 비로그인으로 강등시키면
 * 만료된 토큰을 든 사용자가 "왜 내 것만 안 보이지"를 겪게 됩니다.
 */
export const optionalAuthenticate: RequestHandler = async (req, _res, next) => {
  if (!bearerToken(req)) {
    next();
    return;
  }
  await authenticate(req, _res, next);
};

/** authenticate 다음에 붙입니다. Custom Claims의 admin === true 만 통과. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  try {
    assertAdmin(req.auth);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Express 5는 async 핸들러의 rejection을 자동으로 next()로 넘겨주지만,
 * 버전이 바뀌어도 에러가 조용히 사라지지 않도록 명시적으로 감쌉니다.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError("not-found", "존재하지 않는 엔드포인트입니다"));
};

/** 모든 에러는 여기 한 곳에서 같은 형식으로 나갑니다. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const { status, body } = toErrorResponse(err);
  if (status >= 500) {
    // 5xx만 로그에 남깁니다. 401/403은 정상적인 차단이라 로그를 채울 이유가 없습니다.
    console.error("[api] unhandled error", err);
  }
  res.status(status).json(body);
}
