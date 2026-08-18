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
} from "../../lib/adminReview";
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

  return router;
}
