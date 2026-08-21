/**
 * 게시된 프로그램의 승인 대기 수정본 (스키마 v23).
 *
 * 확인하는 것: **게시본이 내려가지 않는지** / 손님에게 심사 전 내용이 새지 않는지 /
 * 즉시 반영 항목은 승인 없이 반영되는지 / 승인·반려·취소가 게시본을 어떻게 두는지 /
 * 수정본이 항상 한 개인지.
 *
 * **게시본이 내려가지 않는 것이 이 기능의 존재 이유입니다.** v22까지는 수정하면
 * 승인까지 검색에서 사라졌고, 그러면 전문가가 오타조차 고치지 않게 됩니다.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  approvePendingEdit,
  cancelPendingEdit,
  changedReviewFields,
  getPendingEdit,
  listPendingEdits,
  rejectPendingEdit,
} from "../src/lib/programEdits";
import { createDraftProgram, parseProgramInput, updateProgram } from "../src/lib/programs";
import { parseReviewInput, reviewProgram } from "../src/lib/adminReview";
import { grantProvider } from "../src/lib/providerGrant";
import { kstDateString, parseScheduleInputs } from "../src/lib/schedules";
import { testDb } from "./helpers";

const ADMIN_UID = "edits-admin";
let providerUid: string;
let otherUid: string;
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
  otherUid = await makeUser("provider");
});

describe("게시 중인 프로그램 수정 — 게시본은 내려가지 않는다", () => {
  it("제목을 고쳐도 상태는 게시 중이고 손님이 보는 제목은 그대로다", async () => {
    const id = await makePublished();
    const result = await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ title: "새 제목" })
    );

    expect(result.status).toBe("published");
    expect(result.sentToReview).toBe(false);
    expect(result.pendingEdit).toBe(true);
    expect(result.changedFields).toEqual(["title"]);

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("status")).toBe("published");
    expect(snap.get("title")).toBe("가을 숲길 걷기"); // 게시본 그대로
  });

  it("수정본에 새 내용이 들어 있다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목", price: 50000 }));

    const edit = await getPendingEdit(testDb, id);
    expect(edit).not.toBeNull();
    expect(edit!.title).toBe("새 제목");
    expect(edit!.price).toBe(50000);
    expect(edit!.changedFields.sort()).toEqual(["price", "title"]);
    expect(edit!.submittedBy).toBe(providerUid);
  });

  it("회차의 상태 사본이 published로 남는다 — 검색에서 빠지면 안 된다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));

    const snap = await testDb.collection(`programs/${id}/schedules`).get();
    expect(snap.docs.map((d) => d.get("programStatus"))).toEqual(["published"]);
  });

  it("즉시 반영 항목은 수정본을 거치지 않고 게시본에 바로 쓴다", async () => {
    const id = await makePublished();
    const result = await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ barrierFree: true, rainAlternative: "indoor" })
    );

    expect(result.pendingEdit).toBe(false);
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("barrierFree")).toBe(true);
    expect(snap.get("rainAlternative")).toBe("indoor");
    expect(await getPendingEdit(testDb, id)).toBeNull();
  });

  /**
   * 배치 양식은 **보기 방식이고 내용이 아닙니다.** 사진도 글도 그대로인데 좌우
   * 배치만 바뀌는 것을 재심사로 막으면 전문가는 배치를 손대지 않게 됩니다.
   */
  it("배치 양식만 다르면 재심사 대상이 아니다", () => {
    const changed = changedReviewFields(
      { ...(validInput() as unknown as Record<string, unknown>), introLayout: "다른양식" },
      validInput()
    );
    expect(changed).not.toContain("introLayout");
  });

  it("걷는 거리를 고치면 난이도가 즉시 따라 바뀐다 (승인 대기 없이)", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ walkingDistanceM: 5000 }));

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("difficulty")).toBe("hard");
  });

  it("주소는 승인 전까지 게시본과 지역 코드가 함께 유지된다", async () => {
    // 지역은 심사 대상 필드에서 나오는 파생값입니다. 승인 전에 바뀌면
    // 게시본과 파생값이 어긋나 "제목은 옛것인데 지역은 새것"이 됩니다.
    const id = await makePublished();
    await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ location: { address: "경기도 가평군 상면" } })
    );

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("sido")).toBe("gangwon");
    expect((snap.get("location") as { address: string }).address).toBe("강원도 홍천군 서면");
  });

  it("즉시 반영 항목과 심사 대상 항목을 함께 고치면 앞은 반영되고 뒤는 대기한다", async () => {
    const id = await makePublished();
    await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ barrierFree: true, title: "새 제목" })
    );

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("barrierFree")).toBe(true);
    expect(snap.get("title")).toBe("가을 숲길 걷기");
    expect((await getPendingEdit(testDb, id))!.title).toBe("새 제목");
  });
});

describe("수정본은 프로그램당 한 개", () => {
  it("다시 고치면 최신 것으로 덮어쓴다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "1차 수정" }));
    await updateProgram(testDb, id, providerUid, validInput({ title: "2차 수정" }));

    const edit = await getPendingEdit(testDb, id);
    expect(edit!.title).toBe("2차 수정");
    const col = await testDb.collection(`programs/${id}/pendingEdit`).get();
    expect(col.size).toBe(1);
  });

  it("게시본과 같은 값으로 되돌리면 수정본이 사라진다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));
    expect(await getPendingEdit(testDb, id)).not.toBeNull();

    // 원래 값으로 되돌립니다 — 게시본과 차이가 없으므로 승인할 것이 없습니다.
    await updateProgram(testDb, id, providerUid, validInput());
    expect(await getPendingEdit(testDb, id)).toBeNull();
  });
});

describe("수정본 승인", () => {
  it("승인하면 게시본에 반영되고 게시 상태가 유지된다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목", price: 45000 }));

    const result = await approvePendingEdit(testDb, id, ADMIN_UID);
    expect(result.applied.sort()).toEqual(["price", "title"]);

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("title")).toBe("새 제목");
    expect(snap.get("price")).toBe(45000);
    expect(snap.get("status")).toBe("published");
    expect(await getPendingEdit(testDb, id)).toBeNull();
  });

  it("승인 시 파생 필드를 다시 계산한다", async () => {
    const id = await makePublished();
    await updateProgram(
      testDb,
      id,
      providerUid,
      validInput({ location: { address: "경기도 가평군 상면" }, targetAgeMax: 6 })
    );
    await approvePendingEdit(testDb, id, ADMIN_UID);

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("sido")).toBe("gyeonggi");
    expect(snap.get("requiresChildInfo")).toBe(true);
  });

  it("최초 게시 시각은 승인으로 바뀌지 않는다 — 신규순 정렬 기준이다", async () => {
    const id = await makePublished();
    const first = (await testDb.doc(`programs/${id}`).get()).get("publishedAt");

    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));
    await approvePendingEdit(testDb, id, ADMIN_UID);

    const after = (await testDb.doc(`programs/${id}`).get()).get("publishedAt");
    expect(after.toMillis()).toBe(first.toMillis());
  });

  it("관리용 필드가 프로그램 문서로 새어 들어가지 않는다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));
    await approvePendingEdit(testDb, id, ADMIN_UID);

    const data = (await testDb.doc(`programs/${id}`).get()).data()!;
    expect("changedFields" in data).toBe(false);
    expect("submittedBy" in data).toBe(false);
    expect("submittedAt" in data).toBe(false);
  });

  it("수정본이 없으면 승인할 수 없다", async () => {
    const id = await makePublished();
    await expect(approvePendingEdit(testDb, id, ADMIN_UID)).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("사진 목록에 없는 사진을 가리키는 수정본을 승인하면 그 사진만 빠진다", async () => {
    const id = await makePublished();
    // 프로그램 사진 목록에는 b만 있는데 수정본이 a·b를 가리키는 상태 —
    // 수정본 제출 뒤 a가 지워졌는데 연쇄 정리가 닿지 못한 경우와 같습니다.
    const a = `programs/${id}/a.jpg`;
    const b = `programs/${id}/b.jpg`;
    const url = (p: string) =>
      `https://firebasestorage.googleapis.com/v0/b/demo-foom.appspot.com/o/${encodeURIComponent(p)}?alt=media&token=abc`;
    await testDb.doc(`programs/${id}`).update({ imagePaths: [b], imageUrls: [url(b)] });
    await testDb.doc(`programs/${id}/pendingEdit/current`).set({
      ...(validInput({ title: "새 제목" }) as unknown as Record<string, unknown>),
      introBlocks: [
        { heading: "첫째", body: "설명", images: [{ path: a, url: url(a) }] },
        { heading: "둘째", body: "설명", images: [{ path: b, url: url(b) }] },
      ],
      changedFields: ["title", "introBlocks"],
      submittedBy: providerUid,
    });

    await approvePendingEdit(testDb, id, ADMIN_UID);

    const blocks = (await testDb.doc(`programs/${id}`).get()).get("introBlocks");
    // 없는 사진(a)은 빠지고 글은 남습니다. 있는 사진(b)은 그대로입니다.
    expect(blocks[0].images).toEqual([]);
    expect(blocks[0].heading).toBe("첫째");
    expect(blocks[1].images).toEqual([{ path: b, url: url(b) }]);
  });
});

describe("수정본 반려", () => {
  it("반려하면 수정본만 사라지고 게시본은 그대로 살아 있다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "과장된 제목" }));

    await rejectPendingEdit(testDb, id, ADMIN_UID, "제목이 사실과 다릅니다");

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("status")).toBe("published");
    expect(snap.get("title")).toBe("가을 숲길 걷기");
    expect(snap.get("editReviewNote")).toBe("제목이 사실과 다릅니다");
    expect(await getPendingEdit(testDb, id)).toBeNull();
  });

  it("새 수정본을 내면 지난 반려 사유가 지워진다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "과장된 제목" }));
    await rejectPendingEdit(testDb, id, ADMIN_UID, "제목이 사실과 다릅니다");

    await updateProgram(testDb, id, providerUid, validInput({ title: "차분한 제목" }));

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("editReviewNote")).toBeNull();
  });
});

describe("수정본 취소·폐기", () => {
  it("전문가가 스스로 취소할 수 있다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));

    await cancelPendingEdit(testDb, id, providerUid);
    expect(await getPendingEdit(testDb, id)).toBeNull();
  });

  it("남의 프로그램 수정본은 취소할 수 없다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));

    await expect(cancelPendingEdit(testDb, id, otherUid)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("관리자가 프로그램을 숨기면 수정본도 함께 버려진다", async () => {
    // 남겨두면 되살릴 때 게시본과 수정본 중 어느 쪽이 기준인지 알 수 없어집니다.
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));

    await testDb.doc(`programs/${id}`).update({ status: "pending_review" });
    await reviewProgram(
      testDb,
      id,
      parseReviewInput({ decision: "rejected", note: "보완이 필요합니다" }, ADMIN_UID)
    );

    expect(await getPendingEdit(testDb, id)).toBeNull();
  });
});

describe("게시 중이 아닌 프로그램은 수정본을 쓰지 않는다", () => {
  it("작성 중은 바로 반영된다", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, validInput());
    const result = await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));

    expect(result.pendingEdit).toBe(false);
    expect((await testDb.doc(`programs/${id}`).get()).get("title")).toBe("새 제목");
    expect(await getPendingEdit(testDb, id)).toBeNull();
  });

  it("반려된 프로그램은 고치면 바로 재심사로 올라간다", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, validInput());
    await testDb.doc(`programs/${id}`).update({ status: "hidden" });

    const result = await updateProgram(testDb, id, providerUid, validInput({ title: "고친 제목" }));
    expect(result.status).toBe("pending_review");
    expect(result.pendingEdit).toBe(false);
    expect((await testDb.doc(`programs/${id}`).get()).get("title")).toBe("고친 제목");
  });
});

describe("listPendingEdits — 관리자 목록", () => {
  it("바뀐 항목을 「전 → 후」로 함께 내려보낸다", async () => {
    const id = await makePublished();
    await updateProgram(testDb, id, providerUid, validInput({ title: "새 제목" }));

    const { edits } = await listPendingEdits(testDb);
    const row = edits.find((e) => e.id === id);
    expect(row).toBeDefined();
    expect(row!.changedFields).toEqual(["title"]);
    expect(row!.diff).toEqual([
      { field: "title", before: "가을 숲길 걷기", after: "새 제목" },
    ]);
  });

  it("수정본이 없는 프로그램은 목록에 없다", async () => {
    const id = await makePublished();
    const { edits } = await listPendingEdits(testDb);
    expect(edits.find((e) => e.id === id)).toBeUndefined();
  });
});
