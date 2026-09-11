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
  relistProgram,
  removeProgram,
  publishProgram,
  updateProgram,
} from "../../lib/programs";
import { AppError } from "../../lib/errors";
import { parseSearchQuery, searchPrograms } from "../../lib/programSearch";
import {
  addProgramImages,
  deleteProgramImage,
  reorderProgramImages,
} from "../../lib/programImages";
import { addSchedules, deleteSchedule, parseScheduleInputs } from "../../lib/schedules";
import {
  createScheduleTemplate,
  deleteScheduleTemplate,
  listScheduleTemplates,
  updateScheduleTemplate,
} from "../../lib/scheduleTemplates";
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

  // 검색 — **로그인 불필요.** `/:id` 보다 먼저 등록해야 합니다.
  // 뒤에 두면 "search"가 프로그램 id로 잡혀 상세 조회로 넘어갑니다.
  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      const filters = parseSearchQuery(req.query as Record<string, unknown>);
      const result = await searchPrograms(db(), filters);
      res.json(result);
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

  // 정리 — 소유자만. **한 경로가 두 가지 일을 합니다**(2026-09-08).
  // 게시된 적 없으면 완전 삭제, 한 번이라도 게시됐으면 내리기(hidden)입니다.
  // 어느 쪽인지는 서버가 정하고 응답의 `action`으로 알려줍니다 — 화면이 판단하면
  // 「지운다고 눌렀는데 안 지워지는」 상태를 화면이 설명하지 못합니다.
  router.delete(
    "/:id",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await removeProgram(db(), String(req.params.id), req.auth!.uid);
      res.json(result);
    })
  );

  // 다시 올리기 — 소유자만. 공급자가 스스로 내린 프로그램을 **심사 없이** 되살립니다
  // (2026-09-09). 반려·관리자 숨김은 거부하고 「고쳐서 심사 요청」으로 안내합니다.
  router.post(
    "/:id/relist",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await relistProgram(db(), String(req.params.id), req.auth!.uid);
      res.json(result);
    })
  );

  // ── 사진 (18-4) ──────────────────────────────────────────────────────────
  // 업로드는 클라이언트가 Storage로 직접 하고, **기록만 서버가 합니다.**
  // 클라이언트가 imageUrls를 직접 쓰면 남의 파일이나 외부 URL을 심을 수 있습니다.
  router.post(
    "/:id/images",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await addProgramImages(
        db(),
        String(req.params.id),
        req.auth!.uid,
        req.body
      );
      res.status(201).json(result);
    })
  );

  // 순서 바꾸기 — 첫 장이 대표 사진이라 순서가 의미를 갖습니다(2-3).
  router.patch(
    "/:id/images",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await reorderProgramImages(
        db(),
        String(req.params.id),
        req.auth!.uid,
        req.body
      );
      res.json(result);
    })
  );

  // 삭제 — 문서에서 빼고 파일도 지웁니다. 문서에서만 빼면 파일이 계속 쌓입니다(18-7).
  router.delete(
    "/:id/images",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await deleteProgramImage(
        db(),
        String(req.params.id),
        req.auth!.uid,
        req.body
      );
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

  // 매주 반복 규칙 — 소유자만 (2-4). 규칙을 저장하면 그 자리에서 90일치 회차가
  // 채워집니다. 채우지 않고 배치만 기다리면 등록한 사람이 다음 날까지 게시를
  // 못 합니다(회차 0건은 게시가 막힘).
  router.get(
    "/:id/schedule-templates",
    authenticate,
    asyncHandler(async (req, res) => {
      const templates = await listScheduleTemplates(db(), String(req.params.id), req.auth!.uid);
      res.json({ templates });
    })
  );

  router.post(
    "/:id/schedule-templates",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await createScheduleTemplate(
        db(),
        String(req.params.id),
        req.auth!.uid,
        req.body
      );
      res.status(201).json(result);
    })
  );

  // 수정 — 예약이 있는 회차는 건드리지 않고 결과에 몇 건을 건너뛰었는지 돌려줍니다.
  router.patch(
    "/:id/schedule-templates/:templateId",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await updateScheduleTemplate(
        db(),
        String(req.params.id),
        String(req.params.templateId),
        req.auth!.uid,
        req.body
      );
      res.json(result);
    })
  );

  router.delete(
    "/:id/schedule-templates/:templateId",
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await deleteScheduleTemplate(
        db(),
        String(req.params.id),
        String(req.params.templateId),
        req.auth!.uid
      );
      res.json(result);
    })
  );

  // 게시하기 — 소유자만. 내용 심사 없이 바로 게시합니다(⑨, 2026-09-09). 자격 승인 전이면
  // 「자격 승인 대기」로 두고 승인 순간 자동 게시. 보안규칙상 소유자는 status를 직접 못
  // 쓰므로 이 경로가 유일한 전환 통로입니다.
  const publish = asyncHandler(async (req, res) => {
    const result = await publishProgram(db(), String(req.params.id), req.auth!.uid);
    res.json(result);
  });
  router.post("/:id/publish", authenticate, publish);
  // 옛 이름 — 배포 직후 옛 화면을 캐시하고 있는 브라우저가 부릅니다. 같은 일을 합니다.
  router.post("/:id/submit-for-review", authenticate, publish);

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
