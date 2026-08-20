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
  updateProgram,
} from "../../lib/programs";
import { AppError } from "../../lib/errors";
import { cancelPendingEdit } from "../../lib/programEdits";
import { addSchedules, deleteSchedule, parseScheduleInputs } from "../../lib/schedules";
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
      // 회차 검증은 프로그램 값(일정 유형·최대 인원)에 의존하므로 파싱 뒤에 합니다.
      const schedules = parseScheduleInputs(
        (req.body as Record<string, unknown> | undefined)?.schedules,
        { scheduleType: input.scheduleType, programCapacity: input.capacity }
      );
      const result = await createDraftProgram(db(), req.auth!.uid, input, schedules);
      res.status(201).json(result);
    })
  );

  // 내용 수정 — 소유자만. 심사 대상 필드가 바뀌면 서버가 재심사로 되돌립니다(5번 v22).
  router.patch(
    "/:id",
    authenticate,
    asyncHandler(async (req, res) => {
      const input = parseProgramInput(req.body);
      const result = await updateProgram(
        db(),
        String(req.params.id),
        req.auth!.uid,
        input
      );
      res.json(result);
    })
  );

  // 수정본 취소 — 소유자만. 승인 대기 중인 수정 내용을 스스로 버립니다(v23).
  router.delete(
    "/:id/pending-edit",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await cancelPendingEdit(db(), String(req.params.id), req.auth!.uid);
      res.json(result);
    })
  );

  // 회차 추가 — 소유자만. 등록 뒤에 날짜를 더 여는 경로입니다(2-4).
  router.post(
    "/:id/schedules",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await addSchedules(
        db(),
        String(req.params.id),
        req.auth!.uid,
        req.body
      );
      res.status(201).json(result);
    })
  );

  // 회차 삭제 — 소유자만. 예약이 있는 회차는 서버가 거부합니다.
  router.delete(
    "/:id/schedules/:scheduleId",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await deleteSchedule(
        db(),
        String(req.params.id),
        String(req.params.scheduleId),
        req.auth!.uid
      );
      res.json(result);
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
