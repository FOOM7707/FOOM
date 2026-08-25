/**
 * 예약 홀드 (스키마 2-5 「예약 선점(Hold) 플로우」).
 *
 * **오버부킹 방지가 이 파일의 존재 이유입니다.** 정원 확인과 차감을 한 트랜잭션에
 * 묶지 않으면, 마지막 한 자리를 두 사람이 동시에 예약할 때 둘 다 성공합니다.
 *
 * 흐름(2-5): ① `POST /bookings` → `pending_payment` + `expiresAt=+10분` +
 * `remainingSlots` 트랜잭션 차감 ② 10분 내 결제가 없으면 `releaseExpiredHolds`가
 * `expired` 처리 + 정원 복구 ③ PG 웹훅이 `confirmed`로 전환 — ③은 결제 벤더
 * 계약 후의 일이고, 이 파일은 ①·②까지입니다.
 *
 * **소비자 본인확인 대신 예약 폼이 아동 안전을 확보합니다**(15-6). 참가자 검증이
 * 여기 있는 이유이고, 하나라도 어긋나면 예약을 만들지 않습니다(2-5 ①).
 *
 * **상시모집(`open`)은 지금 받지 않습니다.** 협의(`PATCH /bookings/{id}/negotiate`)와
 * 1:1 문의가 없어서, 홀드를 만들어도 날짜를 정할 방법이 없는 예약이 됩니다 —
 * 그 API들과 함께 엽니다(2-5의 open 흐름).
 */

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { normalizePhone } from "./phone";
import { deriveRequiresChildInfo } from "./programDerived";
import { kstDateString } from "./schedules";

/** 홀드 유지 시간. 2-5가 10분으로 못박았습니다 — 바꾸려면 문서부터 바꿉니다. */
export const HOLD_MINUTES = 10;

/**
 * 보호자가 필수가 되는 나이(만). 15-6 v13 보완 — 연령 제한이 없는 프로그램이라도
 * 이 나이 미만이 참가하면 보호자·비상연락처를 그 자리에서 필수로 승격합니다.
 */
export const GUARDIAN_REQUIRED_UNDER_AGE = 14;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HEADCOUNT = 50;

export interface ParticipantInput {
  name: string;
  /** `YYYY-MM-DD`. 아동 대상 프로그램은 필수, 그 외에는 선택(15-6) */
  birthDate: string | null;
  /** 특이사항 — 알레르기·지병·복용약. 민감정보에 준해 취급합니다(15-6) */
  note: string | null;
}

export interface BookingInput {
  programId: string;
  scheduleId: string;
  headcount: number;
  participants: ParticipantInput[];
  guardian: { name: string; phone: string } | null;
  /** E.164로 정규화된 비상 연락처 — 항상 필수입니다(15-6) */
  emergencyPhone: string;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("invalid-argument", message);
  }
  return value.trim();
}

/** 달력에 실제로 있는 날짜인지 — `2020-02-30` 같은 값을 거릅니다. */
function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const built = new Date(Date.UTC(y, m - 1, d));
  return (
    built.getUTCFullYear() === y && built.getUTCMonth() === m - 1 && built.getUTCDate() === d
  );
}

/**
 * 기준일(`YYYY-MM-DD`)의 만 나이.
 *
 * 「연령 또는 생년」처럼 두 단위를 받으면 같은 아이가 예약자에 따라 통과하거나
 * 거부됩니다 — 그래서 입력은 생년월일 하나이고, 기준일은 **회차 진행일**입니다
 * (15-6 v13). 문자열 산수만 쓰므로 시간대 문제가 없습니다.
 */
export function ageOn(birthDate: string, referenceDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = referenceDate.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/**
 * 요청 본문 → 검증된 예약 입력. **구조만 봅니다** — 프로그램과 대조하는 검증
 * (연령 범위·보호자 필수 여부)은 진행일을 알아야 해서 트랜잭션 안에서 합니다.
 *
 * `unitPrice`·`totalAmount`·`status` 같은 값은 아예 읽지 않습니다 — 금액은 서버가
 * `programs.price`에서 만들고, 클라이언트가 보낸 금액은 무시합니다(2-6).
 */
export function parseBookingInput(body: unknown): BookingInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const programId = requireString(b.programId, "프로그램을 지정해 주세요");
  const scheduleId = requireString(b.scheduleId, "날짜(회차)를 선택해 주세요");

  const headcountRaw = b.headcount;
  const headcount =
    typeof headcountRaw === "string" ? Number(headcountRaw) : (headcountRaw as number);
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > MAX_HEADCOUNT) {
    throw new AppError("invalid-argument", "인원은 1명 이상의 정수여야 합니다");
  }

  const rawParticipants = b.participants;
  if (!Array.isArray(rawParticipants) || rawParticipants.length !== headcount) {
    // 인원수와 참가자 수가 어긋난 채 저장되면 공급자가 당일 명단으로 인원을
    // 확인할 수 없습니다 — 길이 일치가 2-5 ①의 첫 번째 검증입니다.
    throw new AppError("invalid-argument", "참가자 정보를 인원수만큼 입력해 주세요");
  }

  const participants: ParticipantInput[] = rawParticipants.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const label = `${i + 1}번째 참가자`;
    const name = requireString(p.name, `${label}의 이름을 입력해 주세요`);
    if (name.length > 30) {
      throw new AppError("invalid-argument", `${label}의 이름이 너무 깁니다`);
    }

    let birthDate: string | null = null;
    if (p.birthDate != null && p.birthDate !== "") {
      const value = String(p.birthDate).trim();
      if (!isRealDate(value)) {
        throw new AppError(
          "invalid-argument",
          `${label}의 생년월일이 올바르지 않습니다 (예: 2019-05-01)`
        );
      }
      birthDate = value;
    }

    let note: string | null = null;
    if (p.note != null && p.note !== "") {
      note = String(p.note).trim().slice(0, 300);
      if (note === "") note = null;
    }

    return { name, birthDate, note };
  });

  let guardian: BookingInput["guardian"] = null;
  if (b.guardian != null) {
    const g = b.guardian as Record<string, unknown>;
    const name = requireString(g.name, "보호자 이름을 입력해 주세요");
    const phone = normalizePhone(typeof g.phone === "string" ? g.phone : null);
    if (!phone.ok) {
      throw new AppError("invalid-argument", "보호자 연락처가 올바르지 않습니다");
    }
    guardian = { name, phone: phone.e164! };
  }

  // 비상 연락처는 아동 여부와 무관하게 항상 필수입니다(15-6 표).
  const emergency = normalizePhone(
    typeof b.emergencyPhone === "string" ? b.emergencyPhone : null
  );
  if (!emergency.ok) {
    throw new AppError("invalid-argument", "비상 연락처를 올바르게 입력해 주세요");
  }

  return {
    programId,
    scheduleId,
    headcount,
    participants,
    guardian,
    emergencyPhone: emergency.e164!,
  };
}

interface ProgramForBooking {
  requiresChildInfo?: boolean;
  category?: string;
  targetAgeMin?: number | null;
  targetAgeMax?: number | null;
}

/**
 * 프로그램·진행일과 대조하는 참가자 검증 (15-6).
 *
 * 반환값은 **판정에 쓴 만 나이**입니다 — 저장해 두면 분쟁 시 "그때 몇 살로
 * 판정했는가"를 다시 계산하지 않고 답할 수 있습니다.
 */
export function validateParticipants(
  program: ProgramForBooking,
  scheduleStartAt: Date,
  input: BookingInput
): Array<number | null> {
  // 파생 필드가 비어 있는 옛 문서 대비 — 산출식은 15-6과 같은 한 곳(programDerived)만 씁니다.
  const requiresChildInfo =
    program.requiresChildInfo ??
    deriveRequiresChildInfo(program.targetAgeMax ?? null, program.category ?? "");

  // 만 나이 판정 기준일은 회차 진행일입니다(15-6 v13) — 예약일 기준으로 하면
  // 예약 시점에 따라 같은 아이가 통과하거나 거부됩니다.
  const referenceDate = kstDateString(scheduleStartAt);

  const ages = input.participants.map((p) => {
    if (p.birthDate == null) {
      if (requiresChildInfo) {
        throw new AppError(
          "invalid-argument",
          "아동 대상 프로그램은 모든 참가자의 생년월일이 필요합니다"
        );
      }
      return null;
    }

    const age = ageOn(p.birthDate, referenceDate);
    if (age < 0 || age > 120) {
      throw new AppError("invalid-argument", `${p.name}님의 생년월일을 확인해 주세요`);
    }

    // 대상연령 범위 대조(2-5 ①). 생년월일이 있을 때만 — 없는 경우는 위에서
    // 아동 대상 프로그램에 한해 이미 거부됐습니다.
    const min = program.targetAgeMin;
    const max = program.targetAgeMax;
    if (min != null && age < min) {
      throw new AppError(
        "invalid-argument",
        `${p.name}님(만 ${age}세)은 참가 연령(만 ${min}세 이상)에 맞지 않습니다`
      );
    }
    if (max != null && age > max) {
      throw new AppError(
        "invalid-argument",
        `${p.name}님(만 ${age}세)은 참가 연령(만 ${max}세 이하)에 맞지 않습니다`
      );
    }
    return age;
  });

  const hasYoungChild = ages.some(
    (age) => age != null && age < GUARDIAN_REQUIRED_UNDER_AGE
  );
  if ((requiresChildInfo || hasYoungChild) && input.guardian == null) {
    // 연령 제한이 없는 프로그램의 구멍(15-6 v13 보완) — requiresChildInfo가
    // false여도 14세 미만이 있으면 보호자를 필수로 승격합니다.
    throw new AppError(
      "invalid-argument",
      "아동이 참가하는 예약은 보호자 이름과 연락처가 필요합니다"
    );
  }

  return ages;
}

export interface BookingHoldResult {
  id: string;
  status: "pending_payment";
  /** ISO 문자열 — 화면이 남은 시간을 계산해 보여줍니다 */
  expiresAt: string;
  unitPrice: number;
  totalAmount: number;
  headcount: number;
}

/**
 * 예약 홀드 생성 (2-5 ①).
 *
 * **읽기(프로그램·회차)와 정원 차감·예약 생성이 한 트랜잭션입니다.** 밖에서 확인하고
 * 안에서 차감하면 확인과 차감 사이에 다른 예약이 끼어들어 오버부킹이 됩니다.
 */
export async function createBookingHold(
  db: Firestore,
  consumerId: string,
  input: BookingInput,
  now: Date = new Date()
): Promise<BookingHoldResult> {
  return db.runTransaction(async (tx) => {
    const programRef = db.doc(`programs/${input.programId}`);
    const programSnap = await tx.get(programRef);

    // 미게시 프로그램은 존재 여부 자체를 알리지 않습니다 — GET /programs/{id}와
    // 같은 정책입니다(남에게는 not-found).
    if (!programSnap.exists || programSnap.get("status") !== "published") {
      throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
    }
    const providerId = programSnap.get("providerId") as string;
    if (providerId === consumerId) {
      throw new AppError("failed-precondition", "자신의 프로그램은 예약할 수 없습니다");
    }
    if (programSnap.get("scheduleType") === "open") {
      throw new AppError(
        "failed-precondition",
        "날짜를 협의하는 프로그램의 신청은 1:1 문의 기능과 함께 열립니다"
      );
    }

    const scheduleRef = db.doc(
      `programs/${input.programId}/schedules/${input.scheduleId}`
    );
    const scheduleSnap = await tx.get(scheduleRef);
    if (!scheduleSnap.exists) {
      throw new AppError("not-found", "회차를 찾을 수 없습니다");
    }

    const startAt = (scheduleSnap.get("startAt") as Timestamp).toDate();
    if (startAt.getTime() <= now.getTime()) {
      throw new AppError("failed-precondition", "이미 지난 회차는 예약할 수 없습니다");
    }

    const remaining = (scheduleSnap.get("remainingSlots") as number) ?? 0;
    if (remaining < input.headcount) {
      throw new AppError(
        "failed-precondition",
        remaining <= 0
          ? "이 회차는 마감되었습니다"
          : `남은 자리가 부족합니다 (남은 자리 ${remaining}명)`
      );
    }

    const ages = validateParticipants(
      programSnap.data() as ProgramForBooking,
      startAt,
      input
    );

    // 가격은 서버가 읽은 현재가를 스냅샷으로 고정합니다. 이후 가격이 바뀌어도
    // 이 예약의 결제·환불 기준은 이 값입니다(2-6 — 웹훅 대조 기준).
    const unitPrice = (programSnap.get("price") as number) ?? 0;
    const totalAmount = unitPrice * input.headcount;
    const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

    tx.update(scheduleRef, {
      remainingSlots: remaining - input.headcount,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const bookingRef = db.collection("bookings").doc();
    tx.set(bookingRef, {
      consumerId,
      providerId,
      programId: input.programId,
      scheduleId: input.scheduleId,
      headcount: input.headcount,
      // 판정에 쓴 만 나이를 함께 기록합니다 — 분쟁 시 재계산 없이 답하기 위함입니다.
      participants: input.participants.map((p, i) => ({ ...p, age: ages[i] })),
      guardian: input.guardian,
      emergencyPhone: input.emergencyPhone,
      unitPrice,
      totalAmount,
      status: "pending_payment",
      expiresAt: Timestamp.fromDate(expiresAt),
      negotiatedDate: null,
      checkInAt: null,
      paymentId: null,
      cancelType: null,
      exemptReason: null,
      penaltyRate: null,
      cancelReason: null,
      cancelledAt: null,
      refundAmount: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      id: bookingRef.id,
      status: "pending_payment" as const,
      expiresAt: expiresAt.toISOString(),
      unitPrice,
      totalAmount,
      headcount: input.headcount,
    };
  });
}

/**
 * 만료된 홀드 정리 (2-5 ②) — 스케줄 함수가 주기적으로 부릅니다.
 *
 * 건별 트랜잭션으로 처리합니다. 한 배치 트랜잭션에 몰면 하나가 경합할 때 전부
 * 재시도되고, **웹훅과의 경합**(만료 직전 결제 완료)에서 confirmed로 바뀐 예약을
 * 다시 expired로 덮는 사고가 납니다 — 그래서 트랜잭션 안에서 상태를 다시 확인합니다.
 */
export async function releaseExpiredHolds(
  db: Firestore,
  now: Date = new Date()
): Promise<number> {
  // status + expiresAt 복합 인덱스가 필요합니다(7번) — firestore.indexes.json에 있습니다.
  const snap = await db
    .collection("bookings")
    .where("status", "==", "pending_payment")
    .where("expiresAt", "<=", Timestamp.fromDate(now))
    .limit(300)
    .get();

  let released = 0;
  for (const doc of snap.docs) {
    await db.runTransaction(async (tx) => {
      const booking = await tx.get(doc.ref);
      // 조회와 처리 사이에 웹훅이 confirmed로 바꿨을 수 있습니다 — 그 예약은 손대지 않습니다.
      if (booking.get("status") !== "pending_payment") return;

      const programId = booking.get("programId") as string;
      const scheduleId = booking.get("scheduleId") as string | null;
      const headcount = (booking.get("headcount") as number) ?? 0;

      if (scheduleId != null) {
        const scheduleRef = db.doc(`programs/${programId}/schedules/${scheduleId}`);
        const scheduleSnap = await tx.get(scheduleRef);
        if (scheduleSnap.exists) {
          const total = (scheduleSnap.get("totalSlots") as number) ?? 0;
          const remaining = (scheduleSnap.get("remainingSlots") as number) ?? 0;
          tx.update(scheduleRef, {
            // 복구가 정원을 넘지 않게 막습니다 — 두 번 복구되는 버그가 생겨도
            // 팔 수 있는 자리가 정원을 넘는 사고로 번지지 않게 하는 안전선입니다.
            remainingSlots: Math.min(total, remaining + headcount),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      tx.update(doc.ref, {
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
      });
      released += 1;
    });
  }

  return released;
}
