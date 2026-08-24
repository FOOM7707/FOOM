/**
 * 예약 홀드 (스키마 2-5 · 15-6).
 *
 * 확인하는 것: **오버부킹 방지**(정원 확인과 차감이 한 트랜잭션 — 마지막 자리를
 * 동시에 잡으면 하나만 성공) / 가격 스냅샷(클라이언트가 보낸 금액 무시) /
 * 참가자 검증(인원 일치·아동 생년월일·보호자·연령 범위·14세 미만 승격) /
 * 만료 홀드 해제와 정원 복구(웹훅 경합 시 confirmed를 덮지 않음).
 *
 * **프로그램은 최대한 공유하고 회차만 테스트마다 만듭니다.** 테스트 전체가 한
 * 에뮬레이터 DB를 쓰는데, 게시 프로그램을 테스트마다 만들면 `listPrograms`처럼
 * 상한이 있는 목록 조회를 쓰는 다른 파일의 테스트가 밀려납니다(실제로 한 번
 * 그렇게 깨졌습니다). 정원 검증은 회차 단위라 공유해도 서로 간섭하지 않습니다.
 */

import { Timestamp } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import {
  HOLD_MINUTES,
  ageOn,
  createBookingHold,
  parseBookingInput,
  releaseExpiredHolds,
} from "../src/lib/bookings";
import { createDraftProgram, parseProgramInput } from "../src/lib/programs";
import { grantProvider } from "../src/lib/providerGrant";
import { createSignedUpUser, testDb } from "./helpers";

let providerUid: string;
let consumerUid: string;
/** 기본 구성(연령 제한 없음)의 게시 프로그램 — 회차만 만들어 공유합니다 */
let sharedProgramId: string;
/** 아동 대상(유아숲체험, 만 3~7세) 게시 프로그램 */
let childProgramId: string;

const DAY_MS = 86_400_000;

function programBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "숲 체험",
    description: "함께 걷습니다.",
    category: "숲해설",
    qualificationType: "forest_interpreter",
    location: { address: "강원도 홍천군 서면" },
    price: 30000,
    capacity: 12,
    minCapacity: 2,
    scheduleType: "single",
    barrierFree: false,
    rainAlternative: "none",
    walkingDistanceM: 1000,
    targetAgeMin: null,
    targetAgeMax: null,
    ...overrides,
  };
}

async function makeProgram(overrides: Record<string, unknown> = {}): Promise<string> {
  const { id } = await createDraftProgram(
    testDb,
    providerUid,
    parseProgramInput(programBody(overrides))
  );
  await testDb.doc(`programs/${id}`).update({
    status: "published",
    publishedAt: new Date(),
  });
  return id;
}

/** 미래 회차 하나. 정원 검증이 회차 단위라 테스트마다 새로 만듭니다. */
async function makeSchedule(
  programId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const ref = testDb.collection(`programs/${programId}/schedules`).doc();
  await ref.set({
    programId,
    programStatus: "published",
    type: "single",
    recurringTemplateId: null,
    startAt: Timestamp.fromDate(new Date(Date.now() + 30 * DAY_MS)),
    endAt: null,
    seriesIndex: null,
    seriesTotal: null,
    totalSlots: 12,
    remainingSlots: 12,
    forceOpen: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return ref.id;
}

function bookingBody(
  programId: string,
  scheduleId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    programId,
    scheduleId,
    headcount: 2,
    participants: [
      { name: "김참가", birthDate: null, note: null },
      { name: "이참가", birthDate: null, note: "견과류 알레르기" },
    ],
    guardian: null,
    emergencyPhone: "010-1234-5678",
    ...overrides,
  };
}

beforeAll(async () => {
  providerUid = await createSignedUpUser();
  await grantProvider({ uid: providerUid, displayName: "숲협동조합" }, { db: testDb });
  consumerUid = await createSignedUpUser();
  sharedProgramId = await makeProgram();
  childProgramId = await makeProgram({
    category: "유아숲체험",
    qualificationType: "infant_forest_instructor",
    targetAgeMin: 3,
    targetAgeMax: 7,
  });
});

describe("ageOn — 만 나이는 진행일 기준", () => {
  it("생일이 지나지 않았으면 한 살 적다", () => {
    expect(ageOn("2019-05-01", "2026-04-30")).toBe(6);
    expect(ageOn("2019-05-01", "2026-05-01")).toBe(7);
  });
});

describe("parseBookingInput", () => {
  it("인원수와 참가자 수가 다르면 거부한다", () => {
    expect(() => parseBookingInput(bookingBody("p", "s", { headcount: 3 }))).toThrow(
      /인원수만큼/
    );
  });

  it("비상 연락처는 항상 필수다 (15-6)", () => {
    expect(() =>
      parseBookingInput(bookingBody("p", "s", { emergencyPhone: "" }))
    ).toThrow(/비상 연락처/);
    expect(() =>
      parseBookingInput(bookingBody("p", "s", { emergencyPhone: "12" }))
    ).toThrow(/비상 연락처/);
  });

  it("전화번호는 E.164로 정규화된다 — 경로마다 다른 형식이 저장되면 대조가 무력해진다", () => {
    const input = parseBookingInput(
      bookingBody("p", "s", {
        emergencyPhone: "010-1234-5678",
        guardian: { name: "박보호", phone: "+82 10 9876 5432" },
      })
    );
    expect(input.emergencyPhone).toBe("+821012345678");
    expect(input.guardian?.phone).toBe("+821098765432");
  });

  it("달력에 없는 생년월일은 거부한다", () => {
    expect(() =>
      parseBookingInput(
        bookingBody("p", "s", {
          participants: [
            { name: "김참가", birthDate: "2020-02-30" },
            { name: "이참가" },
          ],
        })
      )
    ).toThrow(/생년월일/);
  });

  it("금액·상태는 본문에서 읽지 않는다 — 서버가 정한다 (2-6)", () => {
    const input = parseBookingInput(
      bookingBody("p", "s", { unitPrice: 100, totalAmount: 200, status: "confirmed" })
    ) as unknown as Record<string, unknown>;
    expect(input.unitPrice).toBeUndefined();
    expect(input.totalAmount).toBeUndefined();
    expect(input.status).toBeUndefined();
  });
});

describe("createBookingHold — 홀드 생성 (2-5 ①)", () => {
  it("pending_payment + expiresAt(+10분) + 정원 차감 + 가격 스냅샷", async () => {
    const scheduleId = await makeSchedule(sharedProgramId);
    const now = new Date();

    const result = await createBookingHold(
      testDb,
      consumerUid,
      parseBookingInput(bookingBody(sharedProgramId, scheduleId)),
      now
    );

    expect(result.status).toBe("pending_payment");
    expect(result.unitPrice).toBe(30000);
    expect(result.totalAmount).toBe(60000);
    expect(new Date(result.expiresAt).getTime()).toBe(
      now.getTime() + HOLD_MINUTES * 60_000
    );

    const booking = await testDb.doc(`bookings/${result.id}`).get();
    expect(booking.get("consumerId")).toBe(consumerUid);
    expect(booking.get("providerId")).toBe(providerUid);
    expect(booking.get("status")).toBe("pending_payment");
    expect(booking.get("unitPrice")).toBe(30000);
    expect(booking.get("totalAmount")).toBe(60000);

    const schedule = await testDb
      .doc(`programs/${sharedProgramId}/schedules/${scheduleId}`)
      .get();
    expect(schedule.get("remainingSlots")).toBe(10);
  });

  it("남은 자리보다 많은 인원은 거부하고 정원을 건드리지 않는다", async () => {
    const scheduleId = await makeSchedule(sharedProgramId, { remainingSlots: 1 });

    await expect(
      createBookingHold(
        testDb,
        consumerUid,
        parseBookingInput(bookingBody(sharedProgramId, scheduleId))
      )
    ).rejects.toThrow(/남은 자리/);

    const schedule = await testDb
      .doc(`programs/${sharedProgramId}/schedules/${scheduleId}`)
      .get();
    expect(schedule.get("remainingSlots")).toBe(1);
  });

  it("마지막 자리를 동시에 잡으면 하나만 성공한다 — 오버부킹 방지의 본체", async () => {
    const scheduleId = await makeSchedule(sharedProgramId, {
      totalSlots: 3,
      remainingSlots: 3,
    });
    const other = await createSignedUpUser();

    const input = parseBookingInput(bookingBody(sharedProgramId, scheduleId));
    const results = await Promise.allSettled([
      createBookingHold(testDb, consumerUid, input),
      createBookingHold(testDb, other, input),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);

    const schedule = await testDb
      .doc(`programs/${sharedProgramId}/schedules/${scheduleId}`)
      .get();
    expect(schedule.get("remainingSlots")).toBe(1);
  });

  it("지난 회차는 예약할 수 없다", async () => {
    const scheduleId = await makeSchedule(sharedProgramId, {
      startAt: Timestamp.fromDate(new Date(Date.now() - DAY_MS)),
    });
    await expect(
      createBookingHold(
        testDb,
        consumerUid,
        parseBookingInput(bookingBody(sharedProgramId, scheduleId))
      )
    ).rejects.toThrow(/지난 회차/);
  });

  it("미게시 프로그램은 not-found다 — 존재 여부를 알리지 않는다", async () => {
    const programId = await makeProgram();
    const scheduleId = await makeSchedule(programId);
    await testDb.doc(`programs/${programId}`).update({ status: "pending_review" });

    await expect(
      createBookingHold(
        testDb,
        consumerUid,
        parseBookingInput(bookingBody(programId, scheduleId))
      )
    ).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("자신의 프로그램은 예약할 수 없다", async () => {
    const scheduleId = await makeSchedule(sharedProgramId);
    await expect(
      createBookingHold(
        testDb,
        providerUid,
        parseBookingInput(bookingBody(sharedProgramId, scheduleId))
      )
    ).rejects.toThrow(/자신의 프로그램/);
  });

  it("상시모집(open)은 아직 받지 않는다 — 협의 API와 함께 연다", async () => {
    const programId = await makeProgram({
      scheduleType: "open",
      availableFrom: "2026-09-01",
      availableUntil: "2026-12-31",
    });

    await expect(
      createBookingHold(
        testDb,
        consumerUid,
        parseBookingInput(bookingBody(programId, "no-schedule"))
      )
    ).rejects.toThrow(/1:1 문의/);
  });
});

describe("createBookingHold — 참가자 검증 (15-6)", () => {
  it("아동 대상 프로그램은 생년월일·보호자가 없으면 거부한다", async () => {
    const scheduleId = await makeSchedule(childProgramId);

    // 생년월일 없음
    await expect(
      createBookingHold(
        testDb,
        consumerUid,
        parseBookingInput(bookingBody(childProgramId, scheduleId))
      )
    ).rejects.toThrow(/생년월일/);

    // 생년월일은 있는데 보호자 없음
    await expect(
      createBookingHold(
        testDb,
        consumerUid,
        parseBookingInput(
          bookingBody(childProgramId, scheduleId, {
            headcount: 1,
            participants: [{ name: "김아이", birthDate: "2021-03-01" }],
          })
        )
      )
    ).rejects.toThrow(/보호자/);
  });

  it("대상연령 범위 밖이면 거부한다 — 판정 기준일은 진행일", async () => {
    const scheduleId = await makeSchedule(childProgramId);

    await expect(
      createBookingHold(
        testDb,
        consumerUid,
        parseBookingInput(
          bookingBody(childProgramId, scheduleId, {
            headcount: 1,
            participants: [{ name: "김청소년", birthDate: "2010-01-01" }],
            guardian: { name: "박보호", phone: "010-9876-5432" },
          })
        )
      )
    ).rejects.toThrow(/참가 연령/);
  });

  it("조건이 갖춰지면 아동 예약이 성립하고, 판정한 만 나이가 기록된다", async () => {
    const scheduleId = await makeSchedule(childProgramId);

    const result = await createBookingHold(
      testDb,
      consumerUid,
      parseBookingInput(
        bookingBody(childProgramId, scheduleId, {
          headcount: 1,
          participants: [{ name: "김아이", birthDate: "2021-03-01" }],
          guardian: { name: "박보호", phone: "010-9876-5432" },
        })
      )
    );

    const booking = await testDb.doc(`bookings/${result.id}`).get();
    const participants = booking.get("participants") as Array<Record<string, unknown>>;
    expect(typeof participants[0].age).toBe("number");
    expect(booking.get("guardian")).toEqual({ name: "박보호", phone: "+821098765432" });
  });

  it("연령 제한이 없어도 14세 미만이 있으면 보호자가 필수다 (15-6 v13 보완)", async () => {
    const scheduleId = await makeSchedule(sharedProgramId); // 연령 제한 없음 → requiresChildInfo=false

    await expect(
      createBookingHold(
        testDb,
        consumerUid,
        parseBookingInput(
          bookingBody(sharedProgramId, scheduleId, {
            participants: [
              { name: "김어른", birthDate: null },
              { name: "김아이", birthDate: "2018-01-01" },
            ],
          })
        )
      )
    ).rejects.toThrow(/보호자/);
  });
});

describe("releaseExpiredHolds — 만료 해제 (2-5 ②)", () => {
  it("만료 홀드를 expired로 바꾸고 정원을 복구한다 — 안 지난 홀드는 그대로", async () => {
    const scheduleId = await makeSchedule(sharedProgramId);
    const now = new Date();

    const expired = await createBookingHold(
      testDb,
      consumerUid,
      parseBookingInput(bookingBody(sharedProgramId, scheduleId)),
      new Date(now.getTime() - 30 * 60_000) // 30분 전에 만든 홀드 → 이미 만료
    );
    const alive = await createBookingHold(
      testDb,
      consumerUid,
      parseBookingInput(bookingBody(sharedProgramId, scheduleId)),
      now
    );

    const before = await testDb
      .doc(`programs/${sharedProgramId}/schedules/${scheduleId}`)
      .get();
    expect(before.get("remainingSlots")).toBe(8); // 12 - 2 - 2

    await releaseExpiredHolds(testDb, now);

    const expiredDoc = await testDb.doc(`bookings/${expired.id}`).get();
    const aliveDoc = await testDb.doc(`bookings/${alive.id}`).get();
    expect(expiredDoc.get("status")).toBe("expired");
    expect(aliveDoc.get("status")).toBe("pending_payment");

    const after = await testDb
      .doc(`programs/${sharedProgramId}/schedules/${scheduleId}`)
      .get();
    expect(after.get("remainingSlots")).toBe(10); // 만료분 2자리만 복구
  });

  it("confirmed로 바뀐 예약은 덮지 않는다 — 웹훅과의 경합", async () => {
    const scheduleId = await makeSchedule(sharedProgramId);
    const past = new Date(Date.now() - 30 * 60_000);

    const hold = await createBookingHold(
      testDb,
      consumerUid,
      parseBookingInput(bookingBody(sharedProgramId, scheduleId)),
      past
    );
    // 웹훅이 만료 직전에 결제를 확정한 상황을 흉내냅니다.
    await testDb.doc(`bookings/${hold.id}`).update({ status: "confirmed" });

    await releaseExpiredHolds(testDb);

    const doc = await testDb.doc(`bookings/${hold.id}`).get();
    expect(doc.get("status")).toBe("confirmed");
    // 정원도 복구되지 않아야 합니다 — 확정 예약은 자리를 실제로 씁니다.
    const schedule = await testDb
      .doc(`programs/${sharedProgramId}/schedules/${scheduleId}`)
      .get();
    expect(schedule.get("remainingSlots")).toBe(10);
  });
});
