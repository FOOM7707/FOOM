/**
 * 게시 중 수정과 변경 기록 (⑨, 2026-09-09).
 *
 * v23~v37에는 여기서 「수정본(pendingEdit) — 게시본은 유지, 승인 시 교체」를 확인했습니다.
 * ⑨에서 내용 심사를 없애면서 수정은 **바로 반영**되고, 대신 **무엇이 바뀌었는지가 기록으로
 * 남는지**가 확인할 것이 됐습니다 — 사후 검수는 기록이 있어야 성립하고, 표시·광고 기록
 * 6개월 보존(시행령 6조)의 근거이기도 합니다.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  NON_REVIEW_FIELDS,
  changedFieldsAll,
  changedReviewFields,
  latestProgramHistory,
} from "../src/lib/programEdits";
import { createDraftProgram, parseProgramInput, updateProgram } from "../src/lib/programs";
import { parseReviewInput, reviewProgram } from "../src/lib/adminReview";
import { grantProvider } from "../src/lib/providerGrant";
import { kstDateString, parseScheduleInputs } from "../src/lib/schedules";
import { testDb } from "./helpers";

const ADMIN_UID = "edits-admin";
let providerUid: string;
let seq = 0;

async function makeUser(role: "consumer" | "provider"): Promise<string> {
  seq += 1;
  const uid = `edit-${role}-${Date.now()}-${seq}`;
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

/** 게시(published)까지 올려둔 프로그램을 만듭니다. */
async function makePublished(): Promise<string> {
  const date = kstDateString(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
  const schedules = parseScheduleInputs(
    [{ date, startTime: "10:00", endTime: "12:00", capacity: 12 }],
    { scheduleType: "series", programCapacity: 12 }
  );
  const { id } = await createDraftProgram(testDb, providerUid, validInput(), schedules);
  await testDb.doc(`programs/${id}`).update({ status: "pending_review" });
  await reviewProgram(testDb, id, parseReviewInput({ decision: "approved" }, ADMIN_UID));
  return id;
}

beforeAll(async () => {
  providerUid = await makeUser("provider");
});

describe("게시 중인 프로그램 수정 — 바로 반영된다 (⑨)", () => {
  it("제목·가격을 고치면 손님이 보는 값이 그 자리에서 바뀌고 게시 상태는 유지된다", async () => {
    const id = await makePublished();
    const result = await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ title: "겨울 숲길 걷기", price: 35000 })
    );

    expect(result.status).toBe("published");
    expect(result.sentToReview).toBe(false);
    expect(result.changedFields).toEqual(expect.arrayContaining(["title", "price"]));

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("status")).toBe("published");
    expect(snap.get("title")).toBe("겨울 숲길 걷기");
    expect(snap.get("price")).toBe(35000);
    // v23의 수정본은 만들지 않습니다.
    expect((await testDb.doc(`programs/${id}/pendingEdit/current`).get()).exists).toBe(false);
  });

  it("회차의 상태 사본이 published로 남는다 — 검색에서 빠지면 안 된다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "바꾼 제목" }));
    const snap = await testDb.collection(`programs/${id}/schedules`).get();
    expect(snap.docs.map((d) => d.get("programStatus"))).toEqual(["published"]);
  });

  it("주소를 고치면 지역 코드가 즉시 따라 바뀐다 — 파생 필드는 서버가 함께 계산한다", async () => {
    const id = await makePublished();
    await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ location: { address: "경기도 수원시 팔달구 화서동 1" } })
    );
    expect((await testDb.doc(`programs/${id}`).get()).get("sido")).toBe("gyeonggi");
  });
});

describe("변경 기록 — 사후 검수의 데이터", () => {
  it("바뀐 항목만 전·후로 남는다 — 문서를 통째로 두 번 저장하지 않는다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ price: 45000 }));

    const history = await latestProgramHistory(testDb, id);
    expect(history).not.toBeNull();
    expect(history!.fields).toEqual(["price"]);
    expect(history!.before).toEqual({ price: 30000 });
    expect(history!.after).toEqual({ price: 45000 });
    expect(history!.changedBy).toBe(providerUid);
    expect(history!.status).toBe("published");
    // 바뀌지 않은 제목은 기록에 들어가지 않습니다.
    expect(history!.before).not.toHaveProperty("title");
  });

  it("같은 값으로 저장하면 기록을 남기지 않는다", async () => {
    const id = await makePublished();
    const result = await updateProgram(testDb, id, providerUid, validInput());
    expect(result.changedFields).toEqual([]);
    expect(await latestProgramHistory(testDb, id)).toBeNull();
  });

  it("여러 번 고치면 최근 것이 먼저 나온다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ price: 31000 }));
    await updateProgram(testDb, id, providerUid, validInput({ price: 32000 }));
    const latest = await latestProgramHistory(testDb, id);
    expect(latest!.after).toEqual({ price: 32000 });
    expect((await testDb.collection(`programs/${id}/history`).get()).size).toBe(2);
  });

  it("작성 중(draft) 수정은 기록하지 않는다 — 손님이 본 적 없는 값이다", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, validInput());
    await updateProgram(testDb, id, providerUid, validInput({ price: 50000 }));
    expect(await latestProgramHistory(testDb, id)).toBeNull();
  });
});

describe("항목 분류", () => {
  it("배치 양식·배리어프리·우천 대체·걷는 거리·문의 기간은 즉시 반영 항목이다", () => {
    for (const key of ["introLayout", "barrierFree", "rainAlternative", "walkingDistanceM", "availableFrom", "availableUntil"]) {
      expect(NON_REVIEW_FIELDS.has(key)).toBe(true);
    }
    expect(NON_REVIEW_FIELDS.has("price")).toBe(false);
  });

  it("changedFieldsAll은 전부, changedReviewFields는 즉시 반영 항목을 뺀다", () => {
    const before = { ...(validInput() as unknown as Record<string, unknown>) };
    const after = validInput({ price: 1, barrierFree: true });
    expect(changedFieldsAll(before, after).sort()).toEqual(["barrierFree", "price"]);
    expect(changedReviewFields(before, after)).toEqual(["price"]);
  });
});
