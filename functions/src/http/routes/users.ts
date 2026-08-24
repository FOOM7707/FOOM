/**
 * 사용자 엔드포인트 (스키마 5번 「인증/사용자」).
 *
 * `GET /users/me`는 화면이 "공급자인가 / 심사 대기인가"를 판단하는 유일한
 * 경로이고, `PATCH /users/me`는 마이페이지의 이름·연락처 수정입니다.
 * 판단 근거는 lib/users.ts에 적어뒀습니다.
 */

import express, { type Router } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { db as defaultDb } from "../../lib/firebase";
import { getMe, parseUpdateMeInput, updateMe } from "../../lib/users";
import { asyncHandler, authenticate } from "../middleware";

export interface UserRouteDeps {
  db?: Firestore;
}

export function buildUsersRouter(overrides: UserRouteDeps = {}): Router {
  const router = express.Router();
  const db = () => overrides.db ?? defaultDb();

  router.get(
    "/me",
    authenticate,
    asyncHandler(async (req, res) => {
      const user = await getMe(db(), req.auth!.uid);
      // 관리자 여부는 Firestore가 아니라 토큰 클레임이 기준입니다 —
      // 보안규칙과 함수 진입부가 보는 값이 이쪽이기 때문입니다(12-3).
      res.json({ user, isAdmin: req.auth?.admin === true });
    })
  );

  router.patch(
    "/me",
    authenticate,
    asyncHandler(async (req, res) => {
      const input = parseUpdateMeInput(req.body);
      const user = await updateMe(db(), req.auth!.uid, input);
      res.json({ user, isAdmin: req.auth?.admin === true });
    })
  );

  return router;
}
