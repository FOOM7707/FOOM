/**
 * 관리자 엔드포인트 (스키마 12-2, 5번 「관리자/정산」).
 *
 * **이 라우터의 첫 두 줄이 관리자 API 전체의 차단선입니다(6-2 ①).**
 * 보안규칙은 Admin SDK에 적용되지 않으므로, 여기를 통과하면 Firestore의 어떤
 * 문서든 읽고 쓸 수 있습니다. 경로마다 각자 검사하게 두면 새 엔드포인트를
 * 추가할 때 빠뜨리고, 빠뜨린 사실이 화면에 드러나지 않습니다.
 *
 * 정산 탭(`GET /admin/settlements`)은 아직 없습니다 — 예약·결제가 없어 정산할
 * 거래 자체가 생기지 않습니다(12-2의 탭 3 중 2개만 구현).
 */

import express, { type Router } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { configStatus } from "../../config/secrets";
import {
  listProgramsForReview,
  listProvidersForReview,
  parseReviewInput,
  reviewProgram,
  reviewProvider,
  startProviderReview,
} from "../../lib/adminReview";
import {
  approvePendingEdit,
  listPendingEdits,
  rejectPendingEdit,
} from "../../lib/programEdits";
import { db as defaultDb } from "../../lib/firebase";
import { asyncHandler, authenticate, requireAdmin } from "../middleware";

export interface AdminRouteDeps {
  db?: Firestore;
}

export function buildAdminRouter(overrides: AdminRouteDeps = {}): Router {
  const router = express.Router();
  const db = () => overrides.db ?? defaultDb();

  // ── 차단선 ───────────────────────────────────────────────────────────────
  router.use(authenticate, requireAdmin);

  // 진입부가 실제로 동작하는지 확인하는 용도입니다. 업무 기능이 아닙니다.
  router.get("/health", (req, res) => {
    res.json({ status: "ok", uid: req.auth?.uid, admin: true });
  });

  // 키가 설정됐는지만 확인합니다. **값은 절대 내보내지 않습니다.**
  router.get("/config/status", (_req, res) => {
    res.json({ config: configStatus() });
  });

  // ── 전문가 심사 (12-2 탭 1) ──────────────────────────────────────────────
  router.get(
    "/providers",
    asyncHandler(async (req, res) => {
      const result = await listProvidersForReview(db(), {
        status: req.query.status ? String(req.query.status) : undefined,
        limit: Number(req.query.limit) || undefined,
      });
      res.json(result);
    })
  );

  router.post(
    "/providers/:id/approve",
    asyncHandler(async (req, res) => {
      const input = parseReviewInput(req.body, req.auth!.uid);
      const result = await reviewProvider(db(), String(req.params.id), input);
      res.json(result);
    })
  );

  // 심사 착수 — 진행 표시용입니다(v23). 결과가 아니라 "보기 시작했다"는 신호이고,
  // 전문가 화면의 진행 단계가 이 값으로 움직입니다.
  router.post(
    "/providers/:id/start-review",
    asyncHandler(async (req, res) => {
      const result = await startProviderReview(db(), String(req.params.id), req.auth!.uid);
      res.json(result);
    })
  );

  // ── 프로그램 심사 (12-2 탭 2) ────────────────────────────────────────────
  router.get(
    "/programs",
    asyncHandler(async (req, res) => {
      const result = await listProgramsForReview(db(), {
        status: req.query.status ? String(req.query.status) : undefined,
        limit: Number(req.query.limit) || undefined,
      });
      res.json(result);
    })
  );

  router.post(
    "/programs/:id/review",
    asyncHandler(async (req, res) => {
      const input = parseReviewInput(req.body, req.auth!.uid);
      const result = await reviewProgram(db(), String(req.params.id), input);
      res.json(result);
    })
  );

  // ── 프로그램 수정 승인 (v23) ─────────────────────────────────────────────
  // 게시 중인 프로그램의 수정본은 게시본을 내리지 않고 여기서 처리합니다.
  // 「전 → 후」 비교를 서버가 만들어 내려보냅니다 — 화면에서 게시본과 수정본을
  // 각각 불러 맞춰보게 하면 두 요청 사이에 값이 바뀌었을 때 잘못 보여줍니다.
  router.get(
    "/program-edits",
    asyncHandler(async (req, res) => {
      const result = await listPendingEdits(db(), {
        limit: Number(req.query.limit) || undefined,
      });
      res.json(result);
    })
  );

  router.post(
    "/programs/:id/review-edit",
    asyncHandler(async (req, res) => {
      const input = parseReviewInput(req.body, req.auth!.uid);
      const id = String(req.params.id);
      const result =
        input.decision === "approved"
          ? await approvePendingEdit(db(), id, input.adminUid)
          : await rejectPendingEdit(db(), id, input.adminUid, input.note!);
      res.json(result);
    })
  );

  return router;
}
