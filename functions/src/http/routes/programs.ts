/**
 * 프로그램 엔드포인트 (스키마 5번).
 *
 * 조회는 비로그인도 가능해야 하므로 `optionalAuthenticate`를 씁니다 —
 * 게시된 프로그램은 누구나, 자기 draft는 소유자만 보입니다.
 * 생성·심사요청은 로그인 필수입니다.
 */

import express, { type Router } from "express";
import { db as defaultDb } from "../../lib/firebase";
import {
  createDraftProgram,
  getProgram,
  listPrograms,
  parseProgramInput,
  submitProgramForReview,
} from "../../lib/programs";
import { AppError } from "../../lib/errors";
import { asyncHandler, authenticate, optionalAuthenticate } from "../middleware";
import type { Firestore } from "firebase-admin/firestore";

export interface ProgramRouteDeps {
  db?: Firestore;
}

export function buildProgramsRouter(overrides: ProgramRouteDeps = {}): Router {
  const router = express.Router();
  const db = () => overrides.db ?? defaultDb();

  // 목록 — 게시된 것만. ?mine=1 이면 본인 소유 전부(공급자 대시보드)
  router.get(
    "/",
    optionalAuthenticate,
    asyncHandler(async (req, res) => {
      const mine = req.query.mine === "1" || req.query.mine === "true";
      if (mine && !req.auth) {
        throw new AppError("unauthenticated", "로그인이 필요합니다");
      }
      const programs = await listPrograms(db(), {
        mine,
        uid: req.auth?.uid,
        limit: Number(req.query.limit) || undefined,
      });
      res.json({ programs });
    })
  );

  // 생성 — draft만 만듭니다. 게시는 심사를 거쳐야 합니다.
  router.post(
    "/",
    authenticate,
    asyncHandler(async (req, res) => {
      const input = parseProgramInput(req.body);
      const result = await createDraftProgram(db(), req.auth!.uid, input);
      res.status(201).json(result);
    })
  );

  // 심사 요청 — 소유자만. 이 경로가 draft→pending_review의 유일한 통로입니다.
  router.post(
    "/:id/submit-for-review",
    authenticate,
    asyncHandler(async (req, res) => {
      await submitProgramForReview(db(), String(req.params.id), req.auth!.uid);
      res.json({ status: "pending_review" });
    })
  );

  // 상세
  router.get(
    "/:id",
    optionalAuthenticate,
    asyncHandler(async (req, res) => {
      const program = await getProgram(db(), String(req.params.id), {
        uid: req.auth?.uid,
        isAdmin: req.auth?.admin === true,
      });
      res.json({ program });
    })
  );

  return router;
}
