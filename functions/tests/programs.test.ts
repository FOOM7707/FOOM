/**
 * 프로그램 등록·조회 (스키마 5번 · 2-3 · 6-1).
 *
 * 확인하는 것: 공급자만 등록 가능 / 서버가 status와 파생 필드를 정함 /
 * 클라이언트가 보낸 파생 필드는 무시 / draft는 남에게 안 보임 /
 * 심사 요청은 draft에서만.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  createDraftProgram,
  getProgram,
  listPrograms,
  parseProgramInput,
  submitProgramForReview,
} from "../src/lib/programs";
import { parseScheduleInputs } from "../src/lib/schedules";
import { grantProvider } from "../src/lib/providerGrant";
import { testDb } from "./helpers";

let providerUid: string;
let consumerUid: string;
let seq = 0;

async function makeUser(role: "consumer" | "provider"): Promise<string> {
  seq += 1;
  const uid = `prog-${role}-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "테스트",
    status: "active",
  });
  if (role === "provider") {
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
  }
  return uid;
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "주말 산림치유 명상",
    description: "국립자연휴양림에서 진행하는 반나절 프로그램입니다.",
    category: "산림치유",
    qualificationType: "forest_healing_instructor_1",
    location: { address: "강원도 홍천군 서면" },
    price: 35000,
    capacity: 12,
    minCapacity: 4,
    scheduleType: "weekly",
    barrierFree: true,
    rainAlternative: "indoor",
    walkingDistanceM: 1500,
    targetAgeMin: 19,
    targetAgeMax: null,
    ...overrides,
  };
}

/**
 * 심사 요청이 가능한 프로그램 — 회차가 1건 이상 있어야 합니다(2-4).
 * 날짜가 없으면 게시돼도 예약할 수 없어 서버가 심사 요청을 거부합니다.
 */
async function makeSubmittableProgram(): Promise<string> {
  const date = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const input = parseProgramInput(validInput({ scheduleType: "series" }));
  const schedules = parseScheduleInputs(
    [{ date, startTime: "10:00", endTime: "12:00", capacity: 12 }],
    { scheduleType: "series", programCapacity: input.capacity }
  );
  const { id } = await createDraftProgram(testDb, providerUid, input, schedules);
  return id;
}

beforeAll(async () => {
  providerUid = await makeUser("provider");
  consumerUid = await makeUser("consumer");
});

describe("parseProgramInput — 허용목록 밖의 값은 버린다", () => {
  it("클라이언트가 보낸 파생 필드·status는 통과하지 못한다", () => {
    const parsed = parseProgramInput(
      validInput({
        status: "published",
        ratingAvg: 5,
        bookingCount30d: 999999,
        sido: "seoul",
        publishedAt: "2020-01-01",
      }) as unknown
    ) as Record<string, unknown>;

    expect(parsed.status).toBeUndefined();
    expect(parsed.ratingAvg).toBeUndefined();
    expect(parsed.bookingCount30d).toBeUndefined();
    expect(parsed.sido).toBeUndefined();
    expect(parsed.publishedAt).toBeUndefined();
  });

  it("최소 인원이 최대 정원보다 크면 거부", () => {
    expect(() => parseProgramInput(validInput({ capacity: 3, minCapacity: 10 }))).toThrow();
  });

  it("대상연령 최소 > 최대면 거부 (6-3 케이스 18과 같은 조건)", () => {
    expect(() =>
      parseProgramInput(validInput({ targetAgeMin: 20, targetAgeMax: 10 }))
    ).toThrow();
  });

  it("카테고리는 공식명칭 5종만", () => {
    expect(() => parseProgramInput(validInput({ category: "숲치유" }))).toThrow();
    expect(() => parseProgramInput(validInput({ category: "등산·트레킹" }))).toThrow();
  });

  it("rainAlternative는 3값만", () => {
    expect(() => parseProgramInput(validInput({ rainAlternative: "yes" }))).toThrow();
  });

  it("open이 아닌 타입의 availableFrom/Until은 null로 못박는다", () => {
    const parsed = parseProgramInput(
      validInput({ scheduleType: "single", availableFrom: "2026-09-01" })
    );
    expect(parsed.availableFrom).toBeNull();
    expect(parsed.availableUntil).toBeNull();
  });
});

describe("createDraftProgram", () => {
  it("공급자가 아니면 거부", async () => {
    await expect(
      createDraftProgram(testDb, consumerUid, parseProgramInput(validInput()))
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("status는 항상 draft — 클라이언트가 published를 보내도", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ status: "published" }))
    );
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("status")).toBe("draft");
  });

  it("파생 필드를 서버가 계산해 넣는다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ walkingDistanceM: 4000, category: "유아숲체험" }))
    );
    const snap = await testDb.doc(`programs/${id}`).get();

    expect(snap.get("sido")).toBe("gangwon");
    expect(snap.get("difficulty")).toBe("hard");
    expect(snap.get("requiresChildInfo")).toBe(true); // 유아숲체험
    expect(snap.get("targetAgeTags")).toEqual(["adult", "senior"]);
  });

  it("조작된 파생 필드 값이 저장되지 않는다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ ratingAvg: 5, bookingCount30d: 999999 }))
    );
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("ratingAvg")).toBe(0);
    expect(snap.get("bookingCount30d")).toBe(0);
  });

  it("회차 관련 필드를 명시적 null/빈 배열로 만든다", async () => {
    // 필드를 아예 만들지 않으면 인덱스에서 문서가 빠져 검색에서 사라집니다(2-3).
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ scheduleType: "open" }))
    );
    const snap = await testDb.doc(`programs/${id}`).get();
    const data = snap.data()!;

    expect("nextScheduleAt" in data).toBe(true);
    expect(data.nextScheduleAt).toBeNull();
    expect("lastScheduleAt" in data).toBe(true);
    expect(data.lastScheduleAt).toBeNull();
    expect(data.scheduleDates).toEqual([]);
    expect(data.publishedAt).toBeNull();
  });

  it("주소에서 시도를 못 뽑으면 저장하지 않는다", async () => {
    await expect(
      createDraftProgram(
        testDb,
        providerUid,
        parseProgramInput(validInput({ location: { address: "산 속 어딘가" } }))
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("getProgram — 열람 권한", () => {
  let draftId: string;

  beforeAll(async () => {
    const created = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput())
    );
    draftId = created.id;
    await testDb.doc(`programs/${draftId}`).update({ reviewNote: "사진을 보완해 주세요" });
  });

  it("소유자는 자기 draft를 본다", async () => {
    const program = await getProgram(testDb, draftId, { uid: providerUid });
    expect(program.id).toBe(draftId);
    expect(program.reviewNote).toBe("사진을 보완해 주세요");
  });

  it("남의 draft는 not-found로 감춘다 (존재 여부도 알리지 않음)", async () => {
    await expect(
      getProgram(testDb, draftId, { uid: consumerUid })
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("비로그인도 published는 본다", async () => {
    await testDb.doc(`programs/${draftId}`).update({ status: "published" });
    const program = await getProgram(testDb, draftId, {});
    expect(program.status).toBe("published");
  });

  it("published여도 반려 사유는 남에게 내려보내지 않는다", async () => {
    const program = await getProgram(testDb, draftId, { uid: consumerUid });
    expect(program.reviewNote).toBeUndefined();
    expect(program.reviewedBy).toBeUndefined();
  });

  it("관리자는 전부 본다", async () => {
    await testDb.doc(`programs/${draftId}`).update({ status: "hidden" });
    const program = await getProgram(testDb, draftId, { uid: consumerUid, isAdmin: true });
    expect(program.reviewNote).toBe("사진을 보완해 주세요");
  });
});

describe("listPrograms", () => {
  it("mine이 아니면 게시된 것만 나온다", async () => {
    const programs = await listPrograms(testDb, {});
    expect(programs.every((p) => p.status === "published")).toBe(true);
  });

  it("mine은 로그인 필수", async () => {
    await expect(listPrograms(testDb, { mine: true })).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("mine이면 자기 draft도 나온다", async () => {
    const programs = await listPrograms(testDb, { mine: true, uid: providerUid });
    expect(programs.length).toBeGreaterThan(0);
    expect(programs.every((p) => p.providerId === providerUid)).toBe(true);
  });
});

describe("submitProgramForReview", () => {
  it("draft를 pending_review로 바꾼다", async () => {
    const id = await makeSubmittableProgram();
    await submitProgramForReview(testDb, id, providerUid);
    expect((await testDb.doc(`programs/${id}`).get()).get("status")).toBe("pending_review");
  });

  it("남의 프로그램은 심사 요청할 수 없다", async () => {
    const id = await makeSubmittableProgram();
    await expect(submitProgramForReview(testDb, id, consumerUid)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("이미 심사 중이면 다시 요청할 수 없다", async () => {
    const id = await makeSubmittableProgram();
    await submitProgramForReview(testDb, id, providerUid);
    await expect(submitProgramForReview(testDb, id, providerUid)).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("회차가 없으면 심사를 요청할 수 없다 — 게시돼도 예약할 날짜가 없다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ scheduleType: "series" }))
    );
    await expect(submitProgramForReview(testDb, id, providerUid)).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("상시모집은 회차가 없어도 심사를 요청할 수 있다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ scheduleType: "open" }))
    );
    await submitProgramForReview(testDb, id, providerUid);
    expect((await testDb.doc(`programs/${id}`).get()).get("status")).toBe("pending_review");
  });

  it("매주 반복은 회차를 만들 경로가 없어 심사 요청이 막힌다 (준비 중)", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ scheduleType: "weekly" }))
    );
    await expect(submitProgramForReview(testDb, id, providerUid)).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });
});

describe("grantProvider (임시 경로)", () => {
  it("심사를 거치지 않았으므로 verified=false, approvalStatus=pending", async () => {
    const uid = await makeUser("provider");
    const pub = await testDb.doc(`providerProfiles/${uid}`).get();
    const priv = await testDb.doc(`providerProfiles/${uid}/private/profile`).get();

    expect(pub.get("verified")).toBe(false);
    expect(priv.get("approvalStatus")).toBe("pending");
  });

  it("가입하지 않은 계정에는 부여하지 않는다", async () => {
    await expect(
      grantProvider({ uid: "없는계정" }, { db: testDb })
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("관리자 계정은 공급자로 바꾸지 않는다", async () => {
    const uid = await makeUser("consumer");
    await testDb.doc(`users/${uid}`).update({ role: "admin" });
    await expect(grantProvider({ uid }, { db: testDb })).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });
});
