/**
 * 예약 엔드포인트 (스키마 5번 「예약」).
 *
 * 지금은 홀드 생성(`POST /bookings`) 하나입니다. 취소·협의·체크인은 결제와
 * 1:1 문의가 붙을 때 함께 만듭니다(2-5).
 *
 * `bookings`는 돈이 걸린 컬렉션이라 보안규칙이 `allow write: if false`입니다 —
 * 쓰기는 이 라우터(Admin SDK)로만 들어옵니다.
 */

import express, { type Router } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { createBookingHold, parseBookingInput } from "../../lib/bookings";
import { db as defaultDb } from "../../lib/firebase";
import { asyncHandler, authenticate } from "../middleware";

export interface BookingRouteDeps {
  db?: Firestore;
}

export function buildBookingsRouter(overrides: BookingRouteDeps = {}): Router {
  const router = express.Router();
  const db = () => overrides.db ?? defaultDb();

  router.post(
    "/",
    authenticate,
    asyncHandler(async (req, res) => {
      const input = parseBookingInput(req.body);
      const booking = await createBookingHold(db(), req.auth!.uid, input);
      res.status(201).json({ booking });
    })
  );

  return router;
}
