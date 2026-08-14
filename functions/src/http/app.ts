/**
 * Express 앱 조립.
 *
 * 이번 세션은 **기반만** 만듭니다. 업무 API(5번 목록)는 다음 세션에서
 * 이 라우터에 붙입니다. 지금 있는 경로는 진입부가 실제로 동작하는지
 * 확인하기 위한 최소한의 것뿐입니다.
 *
 * CORS를 코드에서 처리하지 않는 이유: Hosting rewrite로 /api/** 를 이 함수에
 * 연결해 **같은 오리진**으로 만들었습니다(firebase.json). 교차 출처 요청이
 * 아예 발생하지 않으므로 프리플라이트도 없고, 프론트는 상대경로만 씁니다(6-2).
 */

import express, { type Express, type Router } from "express";
import { configStatus } from "../config/secrets";
import {
  authenticate,
  errorHandler,
  notFoundHandler,
  requireAdmin,
} from "./middleware";
import { buildAuthRouter, type AuthRouteDeps } from "./routes/auth";

function buildRouter(authDeps: AuthRouteDeps): Router {
  const router = express.Router();

  // 공개 — 로그인 불필요. 배포·에뮬레이터 동작 확인용.
  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "foom-api",
      time: new Date().toISOString(),
    });
  });

  // 소셜 로그인 — 로그인 전에 호출되므로 인증 미들웨어를 붙이지 않습니다.
  router.use("/auth", buildAuthRouter(authDeps));

  // ── /admin/* ───────────────────────────────────────────────────────────
  // 이 두 줄이 관리자 API 전체의 차단선입니다(6-2 ①).
  const adminRouter = express.Router();
  adminRouter.use(authenticate, requireAdmin);

  adminRouter.get("/health", (req, res) => {
    res.json({ status: "ok", uid: req.auth?.uid, admin: true });
  });

  // 키가 설정됐는지만 확인합니다. **값은 절대 내보내지 않습니다.**
  adminRouter.get("/config/status", (_req, res) => {
    res.json({ config: configStatus() });
  });

  router.use("/admin", adminRouter);

  return router;
}

export function createApp(authDeps: AuthRouteDeps = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const router = buildRouter(authDeps);

  // 같은 라우터를 두 곳에 붙입니다.
  //  - "/"     : 함수를 직접 호출할 때 (에뮬레이터 URL, 함수 트리거 URL)
  //  - "/api"  : Hosting rewrite를 거칠 때. rewrite는 경로를 잘라내지 않고
  //              /api/health 를 그대로 함수에 넘기므로 접두사가 남습니다.
  // 한쪽만 붙이면 로컬에서는 되는데 배포하면 404가 나거나 그 반대가 됩니다.
  app.use("/", router);
  app.use("/api", router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
