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
  removeProgram,
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

/**
 * 소개 배치 양식 (v29).
 *
 * 양식이 하나뿐인 지금도 필드로 두는 이유는 나중에 양식 2를 더할 때
 * **이미 등록된 프로그램의 값이 비어 있지 않게** 하려는 것입니다(2-3 ③).
 */
describe("parseProgramInput — 소개 배치 양식", () => {
  it("보내지 않으면 양식 1(zigzag)이 들어간다", () => {
    const parsed = parseProgramInput(validInput() as unknown) as Record<string, unknown>;
    expect(parsed.introLayout).toBe("zigzag");
  });

  it("목록에 없는 양식은 거부한다", () => {
    expect(() =>
      parseProgramInput(validInput({ introLayout: "무지개형" }) as unknown)
    ).toThrow(/소개 배치 양식/);
  });
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

  it("범위 밖 좌표는 거부한다 — 틀린 좌표는 에러 없이 「엉뚱한 지도」로만 드러난다", () => {
    expect(() =>
      parseProgramInput(
        validInput({ location: { address: "강원도 홍천군 서면", lat: 95, lng: 127 } })
      )
    ).toThrow();
    expect(() =>
      parseProgramInput(
        validInput({ location: { address: "강원도 홍천군 서면", lat: 37, lng: 190 } })
      )
    ).toThrow();
  });

  it("좌표가 null이면 null 그대로 저장한다 — 0으로 채우지 않는다(v18 이전 등록분)", () => {
    const parsed = parseProgramInput(
      validInput({ location: { address: "강원도 홍천군 서면", lat: null, lng: null } })
    );
    expect(parsed.location.lat).toBeNull();
    expect(parsed.location.lng).toBeNull();
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

  it("mine이 아니면 심사·수정 승인 사유가 응답에서 빠진다", async () => {
    // 수정본이 반려되면 editReviewNote가 게시 중인 문서에 남습니다 —
    // 이 경로는 로그인 없이 호출되므로 상세(getProgram)와 같은 기준으로 걸러야 합니다.
    const { id } = await createDraftProgram(testDb, providerUid, parseProgramInput(validInput()));
    await testDb.doc(`programs/${id}`).update({
      status: "published",
      reviewNote: "심사 메모",
      reviewedBy: "admin-1",
      editReviewNote: "수정본 반려 사유",
      editReviewedBy: "admin-1",
    });

    // 상한(50건)까지 조회합니다 — 테스트 전체가 한 DB를 쓰므로 다른 파일이 만든
    // 게시 프로그램이 많아지면 기본 20건 창에서 이 문서가 밀려납니다.
    const programs = await listPrograms(testDb, { limit: 50 });
    const row = programs.find((p) => p.id === id)!;
    expect(row).toBeDefined();
    expect("reviewNote" in row).toBe(false);
    expect("reviewedBy" in row).toBe(false);
    expect("editReviewNote" in row).toBe(false);
    expect("editReviewedBy" in row).toBe(false);
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

/* ────────────────────────────────────────────────────────────────────────────
 * 프로그램 정리 — 지우기 / 내리기 (2026-09-08 신규)
 *
 * **가르는 기준은 상태가 아니라 `publishedAt`입니다.** `hidden`은 「반려된 것」과
 * 「내려간 것」 두 가지를 함께 뜻해서 상태만으로는 지워도 되는지 알 수 없습니다.
 * ──────────────────────────────────────────────────────────────────────── */

describe("removeProgram — 지우기 / 내리기", () => {
  /** 지난 시각은 회차 등록이 거부하므로 앞으로의 날짜를 씁니다. */
  function futureDate(): string {
    return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  /** 파일이 실제로 지워지는지 보려고 버킷을 흉내냅니다. */
  function fakeBucket(existing: Set<string>) {
    const deleted: string[] = [];
    return {
      deleted,
      bucket: {
        file(path: string) {
          return {
            delete: async () => {
              if (!existing.has(path)) throw new Error("없는 파일");
              existing.delete(path);
              deleted.push(path);
            },
          };
        },
      } as never,
    };
  }

  it("게시된 적 없으면 문서까지 지운다 — 하위 회차와 사진 파일도 함께", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ scheduleType: "single" })),
      parseScheduleInputs(
        [{ date: futureDate(), startTime: "10:00", endTime: "12:00", capacity: 12 }],
        { scheduleType: "single", programCapacity: 12 }
      )
    );
    const big = `programs/${id}/a.jpg`;
    const small = `programs/${id}/t_a.jpg`;
    await testDb.doc(`programs/${id}`).update({
      imagePaths: [big],
      thumbPaths: [small],
    });
    const fake = fakeBucket(new Set([big, small]));

    const result = await removeProgram(testDb, id, providerUid, { bucket: fake.bucket });

    expect(result.action).toBe("deleted");
    expect(result.deletedFiles).toBe(2);
    expect(fake.deleted).toEqual(expect.arrayContaining([big, small]));
    expect((await testDb.doc(`programs/${id}`).get()).exists).toBe(false);
    // 부모를 지워도 하위 문서는 남습니다 — 남으면 주인 없는 회차가 됩니다.
    expect((await testDb.collection(`programs/${id}/schedules`).get()).empty).toBe(true);
  });

  it("게시됐던 프로그램은 지우지 않고 내린다 — 예약·후기가 가리킬 근거를 남긴다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ scheduleType: "single" })),
      parseScheduleInputs(
        [{ date: futureDate(), startTime: "10:00", endTime: "12:00", capacity: 12 }],
        { scheduleType: "single", programCapacity: 12 }
      )
    );
    await testDb.doc(`programs/${id}`).update({
      status: "published",
      publishedAt: new Date(),
    });
    const fake = fakeBucket(new Set());

    const result = await removeProgram(testDb, id, providerUid, { bucket: fake.bucket });

    expect(result.action).toBe("hidden");
    expect(result.deletedFiles).toBe(0);
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.exists).toBe(true);
    expect(snap.get("status")).toBe("hidden");
    // 사진 파일은 그대로 둡니다 — 되돌릴 수 있어야 합니다.
    expect(fake.deleted).toEqual([]);
  });

  it("내릴 때 회차의 상태 사본도 함께 바꾼다 — 안 바꾸면 검색에 계속 잡힌다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput({ scheduleType: "single" })),
      parseScheduleInputs(
        [{ date: futureDate(), startTime: "10:00", endTime: "12:00", capacity: 12 }],
        { scheduleType: "single", programCapacity: 12 }
      )
    );
    await testDb.doc(`programs/${id}`).update({
      status: "published",
      publishedAt: new Date(),
    });
    const schedules = await testDb.collection(`programs/${id}/schedules`).get();
    await Promise.all(
      schedules.docs.map((d) => d.ref.update({ programStatus: "published" }))
    );

    await removeProgram(testDb, id, providerUid);

    const after = await testDb.collection(`programs/${id}/schedules`).get();
    expect(after.docs.map((d) => d.get("programStatus"))).toEqual(["hidden"]);
  });

  it("이미 내려간 프로그램은 거부한다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput())
    );
    await testDb.doc(`programs/${id}`).update({
      status: "hidden",
      publishedAt: new Date(),
    });

    await expect(removeProgram(testDb, id, providerUid)).rejects.toThrow(
      "이미 내려간 프로그램입니다"
    );
  });

  it("반려된 프로그램(hidden이지만 게시된 적 없음)은 완전히 지운다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput())
    );
    // 반려는 hidden으로 남지만 publishedAt이 없습니다 — 손님이 본 적 없습니다.
    await testDb.doc(`programs/${id}`).update({ status: "hidden" });

    const result = await removeProgram(testDb, id, providerUid);

    expect(result.action).toBe("deleted");
    expect((await testDb.doc(`programs/${id}`).get()).exists).toBe(false);
  });

  it("남의 프로그램은 존재 여부도 알리지 않는다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput())
    );
    const other = await makeUser("provider");

    await expect(removeProgram(testDb, id, other)).rejects.toThrow(
      "프로그램을 찾을 수 없습니다"
    );
    expect((await testDb.doc(`programs/${id}`).get()).exists).toBe(true);
  });

  it("예약이 있으면 지우지 않는다 — 지금은 생길 수 없지만 조용히 사라지는 것이 최악이다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(validInput())
    );
    await testDb.collection("bookings").add({
      programId: id,
      consumerId: "someone",
      status: "confirmed",
    });

    await expect(removeProgram(testDb, id, providerUid)).rejects.toThrow(
      "예약이 있는 프로그램은 삭제할 수 없습니다"
    );
  });
});
