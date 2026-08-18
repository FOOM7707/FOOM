/**
 * Express 앱 조립.
 *
 * 5번의 REST 경로를 이 라우터 하나에 모읍니다. 지금 붙어 있는 것은
 * 인증(소셜 로그인)·사용자·프로그램·관리자 심사이고, 예약·결제·검색은
 * 아직 없습니다.
 *
 * CORS를 코드에서 처리하지 않는 이유: Hosting rewrite로 /api/** 를 이 함수에
 * 연결해 **같은 오리진**으로 만들었습니다(firebase.json). 교차 출처 요청이
 * 아예 발생하지 않으므로 프리플라이트도 없고, 프론트는 상대경로만 씁니다(6-2).
 */

import express, { type Express, type Router } from "express";
import { errorHandler, notFoundHandler } from "./middleware";
import { buildAdminRouter, type AdminRouteDeps } from "./routes/admin";
import { buildAuthRouter, type AuthRouteDeps } from "./routes/auth";
import { buildExternalRouter, type ExternalRouteDeps } from "./routes/external";
import { buildProgramsRouter, type ProgramRouteDeps } from "./routes/programs";
import { buildUsersRouter, type UserRouteDeps } from "./routes/users";

export interface AppDeps extends AuthRouteDeps {
  programDeps?: ProgramRouteDeps;
  userDeps?: UserRouteDeps;
  adminDeps?: AdminRouteDeps;
  externalDeps?: ExternalRouteDeps;
}

function buildRouter(authDeps: AppDeps): Router {
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

  // 내 계정 — 로그인 필수(라우터 내부에서 붙임)
  router.use("/users", buildUsersRouter(authDeps.userDeps));

  // 프로그램 — 조회는 비로그인 허용, 생성·심사요청은 로그인 필수(라우터 내부에서 분기)
  router.use("/programs", buildProgramsRouter(authDeps.programDeps));

  // 외부 연동 — 날씨는 비로그인도 호출합니다(홈·상세가 공개 화면).
  router.use("/external", buildExternalRouter(authDeps.externalDeps));

  // 관리자 — 차단선(authenticate + requireAdmin)은 라우터 안에 붙어 있습니다(6-2 ①).
  router.use("/admin", buildAdminRouter(authDeps.adminDeps));

  return router;
}

export function createApp(authDeps: AppDeps = {}): Express {
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
