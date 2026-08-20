/**
 * 프로그램 내용 수정 (`PATCH /programs/{id}`, 스키마 5번 v22).
 *
 * 확인하는 것: 소유자만 고칠 수 있는지 / **게시된 프로그램의 심사 대상 필드를 고치면
 * 재심사로 돌아가는지** / 파생 필드가 다시 계산되는지 / 반려된 프로그램을 고치면
 * 재제출되는지 / 등록된 날짜가 있을 때 운영 방식을 함부로 못 바꾸는지.
 *
 * **재심사 되돌리기를 테스트로 못박는 이유:** 이게 빠지면 승인받은 뒤 제목과 가격을
 * 바꿔치기할 수 있어, "관리자가 확인하고 승인했다"는 전제가 무너집니다. 그런데 화면상
 * 으로는 아무 문제가 없어 보입니다.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  createDraftProgram,
  needsRereview,
  parseProgramInput,
  updateProgram,
} from "../src/lib/programs";
import { grantProvider } from "../src/lib/providerGrant";
import { kstDateString, listSchedules, parseScheduleInputs } from "../src/lib/schedules";
import { testDb } from "./helpers";

let providerUid: string;
let otherUid: string;
let seq = 0;

async function makeUser(role: "consumer" | "provider"): Promise<string> {
  seq += 1;
  const uid = `upd-${role}-${Date.now()}-${seq}`;
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
  return parseProgramInput({
    title: "가을 숲길 걷기",
    description: "국립자연휴양림 둘레길을 함께 걷습니다.",
    category: "숲길등산",
    qualificationType: "mountain_trail_guide",
    location: { address: "강원도 홍천군 서면" },
    price: 30000,
    capacity: 12,
    minCapacity: 4,
    scheduleType: "series",
    barrierFree: false,
    rainAlternative: "reschedule",
    walkingDistanceM: 2000,
    targetAgeMin: null,
    targetAgeMax: null,
    ...overrides,
  });
}

function daysFromNow(n: number): string {
  return kstDateString(new Date(Date.now() + n * 24 * 60 * 60 * 1000));
}

function scheduleRows(offsets: number[], capacity = 12) {
  return parseScheduleInputs(
    offsets.map((n) => ({
      date: daysFromNow(n),
      startTime: "10:00",
      endTime: "12:00",
      capacity,
    })),
    { scheduleType: "series", programCapacity: capacity }
  );
}

/** 지정한 상태의 프로그램을 만듭니다(심사 흐름을 거치지 않고 상태만 맞춥니다). */
async function makeProgram(
  status: string,
  overrides: Record<string, unknown> = {},
  scheduleOffsets: number[] = [14]
): Promise<string> {
  const { id } = await createDraftProgram(
    testDb,
    providerUid,
    validInput(overrides),
    scheduleOffsets.length > 0 ? scheduleRows(scheduleOffsets) : []
  );
  if (status !== "draft") {
    await testDb.doc(`programs/${id}`).update({ status });
    const schedules = await testDb.collection(`programs/${id}/schedules`).get();
    const batch = testDb.batch();
    schedules.docs.forEach((d) => batch.update(d.ref, { programStatus: status }));
    if (!schedules.empty) await batch.commit();
  }
  return id;
}

beforeAll(async () => {
  providerUid = await makeUser("provider");
  otherUid = await makeUser("provider");
});

describe("needsRereview — 무엇이 재심사를 유발하는가", () => {
  const before = validInput() as unknown as Record<string, unknown>;

  it("제목·가격·정원·장소·소개가 바뀌면 재심사", () => {
    expect(needsRereview(before, validInput({ title: "다른 제목" }))).toBe(true);
    expect(needsRereview(before, validInput({ price: 50000 }))).toBe(true);
    expect(needsRereview(before, validInput({ capacity: 20 }))).toBe(true);
    expect(needsRereview(before, validInput({ description: "내용이 완전히 바뀜" }))).toBe(true);
    expect(
      needsRereview(before, validInput({ location: { address: "경기도 가평군 상면" } }))
    ).toBe(true);
  });

  it("카테고리·자격 유형이 바뀌면 재심사 — 자격증 대조 기준이 달라진다", () => {
    expect(needsRereview(before, validInput({ category: "산림치유" }))).toBe(true);
    expect(
      needsRereview(before, validInput({ qualificationType: "forest_interpreter" }))
    ).toBe(true);
  });

  it("대상연령이 바뀌면 재심사 — 아동 정보 수집 여부가 여기서 갈린다(15-6)", () => {
    expect(needsRereview(before, validInput({ targetAgeMax: 6 }))).toBe(true);
  });

  it("배리어프리·우천대체·걷는거리는 재심사 없이 고칠 수 있다", () => {
    expect(needsRereview(before, validInput({ barrierFree: true }))).toBe(false);
    expect(needsRereview(before, validInput({ rainAlternative: "none" }))).toBe(false);
    expect(needsRereview(before, validInput({ walkingDistanceM: 4000 }))).toBe(false);
  });

  it("아무것도 안 바뀌면 재심사하지 않는다", () => {
    expect(needsRereview(before, validInput())).toBe(false);
  });
});

describe("updateProgram — 권한", () => {
  it("남의 프로그램은 고칠 수 없다 — 존재 여부도 알리지 않는다", async () => {
    const id = await makeProgram("draft");
    await expect(
      updateProgram(testDb, id, otherUid, validInput({ title: "가로채기" }))
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("없는 프로그램은 not-found", async () => {
    await expect(
      updateProgram(testDb, "없는프로그램", providerUid, validInput())
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("updateProgram — 상태 전환", () => {
  it("작성 중은 무엇을 고쳐도 작성 중으로 남는다 (아직 심사 전)", async () => {
    const id = await makeProgram("draft");
    const result = await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ title: "제목 변경", price: 99000 })
    );
    expect(result.status).toBe("draft");
    expect(result.sentToReview).toBe(false);
  });

  it("게시 중인 프로그램의 제목을 고치면 게시본은 그대로 두고 수정본이 대기한다", async () => {
    // v23에서 바뀐 동작입니다. v22까지는 게시가 내려가 승인까지 검색에서
    // 사라졌는데, 그러면 전문가가 오타조차 고치지 않게 됩니다.
    // 수정본 흐름 자체는 programEdits.test.ts가 자세히 덮습니다.
    const id = await makeProgram("published");
    const result = await updateProgram(testDb, id, providerUid, validInput({ title: "바꿔치기" }));

    expect(result.status).toBe("published");
    expect(result.sentToReview).toBe(false);
    expect(result.pendingEdit).toBe(true);

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("status")).toBe("published");
    expect(snap.get("title")).toBe("가을 숲길 걷기"); // 게시본 그대로
  });

  it("게시 중이어도 배리어프리만 고치면 게시 상태를 유지한다", async () => {
    const id = await makeProgram("published");
    const result = await updateProgram(testDb, id, providerUid, validInput({ barrierFree: true }));

    expect(result.status).toBe("published");
    expect(result.sentToReview).toBe(false);
    expect((await testDb.doc(`programs/${id}`).get()).get("barrierFree")).toBe(true);
  });

  it("반려된 프로그램을 고치면 재제출된다 — 이 경로가 유일한 재제출 통로다", async () => {
    const id = await makeProgram("hidden");
    await testDb.doc(`programs/${id}`).update({ reviewNote: "사진을 보완해 주세요" });

    const result = await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ description: "설명을 보완했습니다." })
    );
    expect(result.status).toBe("pending_review");

    // 반려 사유는 지우지 않습니다 — 감사 기록이고, 화면은 hidden일 때만 보여줍니다.
    expect((await testDb.doc(`programs/${id}`).get()).get("reviewNote")).toBe(
      "사진을 보완해 주세요"
    );
  });

  it("심사 중인 프로그램은 고쳐도 심사 중으로 남는다", async () => {
    const id = await makeProgram("pending_review");
    const result = await updateProgram(testDb, id, providerUid, validInput({ price: 40000 }));
    expect(result.status).toBe("pending_review");
    expect(result.sentToReview).toBe(false);
  });

  it("상태가 바뀌면 회차의 상태 사본도 함께 바뀐다", async () => {
    // collectionGroup 규칙이 이 사본만 보므로, 어긋나면 상태와 검색 노출이
    // 따로 움직입니다(2-4). 반려 → 수정 → 재심사 경로로 확인합니다.
    const id = await makeProgram("hidden");
    await updateProgram(testDb, id, providerUid, validInput({ title: "고친 제목" }));

    const snap = await testDb.collection(`programs/${id}/schedules`).get();
    expect(snap.docs.map((d) => d.get("programStatus"))).toEqual(["pending_review"]);
  });

  it("게시 중인 프로그램을 고쳐도 회차 사본은 published로 남는다", async () => {
    // 게시본이 내려가지 않으므로 사본도 바뀌면 안 됩니다 — 바뀌면 게시 중인
    // 프로그램이 검색에서 사라집니다.
    const id = await makeProgram("published");
    await updateProgram(testDb, id, providerUid, validInput({ title: "바꿔치기" }));

    const snap = await testDb.collection(`programs/${id}/schedules`).get();
    expect(snap.docs.map((d) => d.get("programStatus"))).toEqual(["published"]);
  });
});

describe("updateProgram — 파생 필드 재계산", () => {
  it("주소를 바꾸면 지역이 따라 바뀐다", async () => {
    const id = await makeProgram("draft");
    expect((await testDb.doc(`programs/${id}`).get()).get("sido")).toBe("gangwon");

    await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ location: { address: "경기도 가평군 상면" } })
    );
    expect((await testDb.doc(`programs/${id}`).get()).get("sido")).toBe("gyeonggi");
  });

  it("걷는 거리를 바꾸면 난이도가 따라 바뀐다", async () => {
    const id = await makeProgram("draft");
    expect((await testDb.doc(`programs/${id}`).get()).get("difficulty")).toBe("normal");

    await updateProgram(testDb, id, providerUid, validInput({ walkingDistanceM: 5000 }));
    expect((await testDb.doc(`programs/${id}`).get()).get("difficulty")).toBe("hard");
  });

  it("대상연령을 아동으로 바꾸면 아동 정보 필수 여부가 켜진다", async () => {
    const id = await makeProgram("draft");
    await updateProgram(testDb, id, providerUid, validInput({ targetAgeMax: 6 }));
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("requiresChildInfo")).toBe(true);
    expect(snap.get("targetAgeTags")).toEqual(["infant"]);
  });

  it("클라이언트가 보낸 파생 필드·상태는 무시된다", async () => {
    const id = await makeProgram("draft");
    await updateProgram(
      testDb,
      id,
      providerUid,
      parseProgramInput({
        ...(validInput() as unknown as Record<string, unknown>),
        status: "published",
        ratingAvg: 5,
        sido: "seoul",
      })
    );
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("status")).toBe("draft");
    expect(snap.get("ratingAvg")).toBe(0);
    expect(snap.get("sido")).toBe("gangwon");
  });

  it("주소에서 시도를 못 뽑으면 수정을 거부한다", async () => {
    const id = await makeProgram("draft");
    await expect(
      updateProgram(testDb, id, providerUid, validInput({ location: { address: "산속 어딘가" } }))
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("updateProgram — 운영 방식 변경", () => {
  it("등록된 날짜가 있으면 상시모집으로 바꿀 수 없다", async () => {
    const id = await makeProgram("draft", {}, [14]);
    await expect(
      updateProgram(testDb, id, providerUid, validInput({ scheduleType: "open" }))
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("날짜가 없으면 상시모집으로 바꿀 수 있다", async () => {
    const id = await makeProgram("draft", {}, []);
    const result = await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ scheduleType: "open" })
    );
    expect(result.status).toBe("draft");
    expect((await testDb.doc(`programs/${id}`).get()).get("scheduleType")).toBe("open");
  });

  it("회차제 → 1회성은 날짜가 하나일 때만 된다", async () => {
    const many = await makeProgram("draft", {}, [14, 21]);
    await expect(
      updateProgram(testDb, many, providerUid, validInput({ scheduleType: "single" }))
    ).rejects.toMatchObject({ code: "failed-precondition" });

    const one = await makeProgram("draft", {}, [14]);
    await updateProgram(testDb, one, providerUid, validInput({ scheduleType: "single" }));
    const schedules = await listSchedules(testDb, one);
    // 1회성은 회차 번호가 없습니다.
    expect(schedules[0].seriesIndex).toBeNull();
    expect(schedules[0].seriesTotal).toBeNull();
  });

  it("1회성 → 회차제로 바꾸면 회차 번호가 붙는다", async () => {
    const id = await makeProgram("draft", { scheduleType: "single" }, [14]);
    await updateProgram(testDb, id, providerUid, validInput({ scheduleType: "series" }));
    const schedules = await listSchedules(testDb, id);
    expect(schedules[0].seriesIndex).toBe(1);
    expect(schedules[0].seriesTotal).toBe(1);
  });
});
