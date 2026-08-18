/**
 * 관리자 심사 (스키마 12-2 · 5번 「관리자/정산」).
 *
 * 확인하는 것: 승인이 문서 두 개를 함께 바꾸는가 / 감사로그가 남는가 /
 * 반려 사유 없이는 반려되지 않는가 / 게시 시 파생 필드와 `publishedAt`이
 * 채워지는가 / 하위 회차의 `programStatus`가 따라가는가.
 *
 * 마지막 두 개가 특히 중요합니다 — 빠뜨려도 화면에는 "게시됨"으로 보이는데
 * 검색·정렬에서만 조용히 빠집니다(5번 v13 추가, 6-1).
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  listProgramsForReview,
  listProvidersForReview,
  parseReviewInput,
  reviewProgram,
  reviewProvider,
} from "../src/lib/adminReview";
import { createDraftProgram, parseProgramInput, submitProgramForReview } from "../src/lib/programs";
import { grantProvider } from "../src/lib/providerGrant";
import { testDb } from "./helpers";

const ADMIN_UID = "admin-reviewer-1";

let seq = 0;

async function makeProvider(): Promise<string> {
  seq += 1;
  const uid = `rev-provider-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "심사대상",
    status: "active",
    identityVerifiedAt: null,
  });
  await grantProvider({ uid, displayName: "체질숲협동조합" }, { db: testDb });
  return uid;
}

function validInput(overrides: Record<string, unknown> = {}) {
  return parseProgramInput({
    title: "숲길 걷기 프로그램",
    description: "국립자연휴양림 코스를 함께 걷습니다.",
    category: "숲길등산",
    qualificationType: "mountain_trail_guide",
    location: { address: "강원도 홍천군 서면" },
    price: 30000,
    capacity: 10,
    minCapacity: 3,
    scheduleType: "single",
    barrierFree: false,
    rainAlternative: "reschedule",
    walkingDistanceM: 2000,
    targetAgeMin: 19,
    targetAgeMax: null,
    ...overrides,
  });
}

/** draft를 만들어 심사 요청까지 올려둡니다 */
async function makePendingProgram(
  providerUid: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { id } = await createDraftProgram(testDb, providerUid, validInput(overrides));
  await submitProgramForReview(testDb, id, providerUid);
  return id;
}

describe("parseReviewInput", () => {
  it("승인/반려 외의 값은 거부", () => {
    expect(() => parseReviewInput({ decision: "published" }, ADMIN_UID)).toThrow();
    expect(() => parseReviewInput({}, ADMIN_UID)).toThrow();
  });

  it("반려는 사유가 필수 — 없으면 공급자가 무엇을 고칠지 알 수 없다", () => {
    expect(() => parseReviewInput({ decision: "rejected" }, ADMIN_UID)).toThrow();
    expect(() => parseReviewInput({ decision: "rejected", note: "   " }, ADMIN_UID)).toThrow();
  });

  it("승인은 사유가 없어도 된다", () => {
    expect(parseReviewInput({ decision: "approved" }, ADMIN_UID)).toEqual({
      decision: "approved",
      note: null,
      adminUid: ADMIN_UID,
    });
  });
});

describe("전문가 심사", () => {
  let providerUid: string;

  beforeAll(async () => {
    providerUid = await makeProvider();
  });

  it("임시 경로로 만든 계정이 pending 목록에 잡힌다 (15-8 재심사 대상)", async () => {
    const { providers } = await listProvidersForReview(testDb, { status: "pending" });
    const row = providers.find((p) => p.uid === providerUid);

    expect(row).toBeDefined();
    expect(row!.verified).toBe(false);
    expect(row!.displayName).toBe("체질숲협동조합");
    // 본인확인 벤더 계약 전이라 null입니다. 관리자가 보고 판단하도록 내려보냅니다.
    expect(row!.identityVerifiedAt).toBeNull();
    expect(row!.certificateImageUrls).toEqual([]);
  });

  it("승인하면 approvalStatus와 verified가 함께 바뀌고 감사로그가 남는다", async () => {
    const uid = await makeProvider();
    const result = await reviewProvider(testDb, uid, {
      decision: "approved",
      note: null,
      adminUid: ADMIN_UID,
    });

    expect(result).toMatchObject({ approvalStatus: "approved", verified: true });

    const pub = await testDb.doc(`providerProfiles/${uid}`).get();
    const priv = await testDb.doc(`providerProfiles/${uid}/private/profile`).get();

    // 한쪽만 바뀌면 "심사는 통과했는데 인증 배지가 안 붙는" 반쪽 상태가 됩니다(2-2).
    expect(pub.get("verified")).toBe(true);
    expect(priv.get("approvalStatus")).toBe("approved");
    expect(priv.get("approvedBy")).toBe(ADMIN_UID);
    expect(priv.get("approvedAt")).not.toBeNull();
  });

  it("반려하면 사유가 남고 verified는 false로 유지된다", async () => {
    const uid = await makeProvider();
    await reviewProvider(testDb, uid, {
      decision: "rejected",
      note: "자격증 사본이 흐릿합니다",
      adminUid: ADMIN_UID,
    });

    const pub = await testDb.doc(`providerProfiles/${uid}`).get();
    const priv = await testDb.doc(`providerProfiles/${uid}/private/profile`).get();

    expect(pub.get("verified")).toBe(false);
    expect(priv.get("approvalStatus")).toBe("rejected");
    expect(priv.get("approvalNote")).toBe("자격증 사본이 흐릿합니다");
  });

  it("승인된 계정은 pending 목록에서 빠진다", async () => {
    const uid = await makeProvider();
    await reviewProvider(testDb, uid, {
      decision: "approved",
      note: null,
      adminUid: ADMIN_UID,
    });

    const { providers } = await listProvidersForReview(testDb, { status: "pending" });
    expect(providers.some((p) => p.uid === uid)).toBe(false);

    const approved = await listProvidersForReview(testDb, { status: "approved" });
    expect(approved.providers.some((p) => p.uid === uid)).toBe(true);
  });

  it("공급자 프로필이 없는 uid는 not-found", async () => {
    await expect(
      reviewProvider(testDb, "없는공급자", {
        decision: "approved",
        note: null,
        adminUid: ADMIN_UID,
      })
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("프로그램 심사", () => {
  let providerUid: string;

  beforeAll(async () => {
    providerUid = await makeProvider();
  });

  it("pending_review 목록에 공급자 활동명이 함께 나온다", async () => {
    const id = await makePendingProgram(providerUid);
    const { programs } = await listProgramsForReview(testDb, { status: "pending_review" });
    const row = programs.find((p) => p.id === id);

    expect(row).toBeDefined();
    expect(row!.providerDisplayName).toBe("체질숲협동조합");
  });

  it("draft는 심사 처리할 수 없다", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, validInput());
    await expect(
      reviewProgram(testDb, id, { decision: "approved", note: null, adminUid: ADMIN_UID })
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("승인하면 published + publishedAt + 감사로그가 함께 채워진다", async () => {
    const id = await makePendingProgram(providerUid);
    await reviewProgram(testDb, id, {
      decision: "approved",
      note: null,
      adminUid: ADMIN_UID,
    });

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("status")).toBe("published");
    // 신규순 정렬의 기준 필드. 승인 말고는 채우는 곳이 없습니다(5번 v13).
    expect(snap.get("publishedAt")).not.toBeNull();
    expect(snap.get("reviewedBy")).toBe(ADMIN_UID);
    expect(snap.get("reviewedAt")).not.toBeNull();
  });

  it("승인 시 파생 필드를 다시 계산한다", async () => {
    const id = await makePendingProgram(providerUid);
    // 심사 대기 중에 파생 필드가 오염된 상황을 흉내 냅니다.
    await testDb.doc(`programs/${id}`).update({ difficulty: "easy", sido: "seoul" });

    await reviewProgram(testDb, id, {
      decision: "approved",
      note: null,
      adminUid: ADMIN_UID,
    });

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("difficulty")).toBe("normal"); // walkingDistanceM=2000
    expect(snap.get("sido")).toBe("gangwon"); // 강원도 홍천군
  });

  it("재심사해도 publishedAt은 최초 게시 시각을 유지한다", async () => {
    const id = await makePendingProgram(providerUid);
    await reviewProgram(testDb, id, {
      decision: "approved",
      note: null,
      adminUid: ADMIN_UID,
    });
    const first = (await testDb.doc(`programs/${id}`).get()).get("publishedAt");

    // 내용 수정으로 재심사에 넘어간 상태를 흉내 냅니다(2-3 v10).
    await testDb.doc(`programs/${id}`).update({ status: "pending_review" });
    await reviewProgram(testDb, id, {
      decision: "approved",
      note: null,
      adminUid: ADMIN_UID,
    });

    const second = (await testDb.doc(`programs/${id}`).get()).get("publishedAt");
    // 갱신해버리면 오래된 프로그램이 재심사 때마다 신규순 맨 앞으로 올라옵니다.
    expect(second.toMillis()).toBe(first.toMillis());
  });

  it("하위 회차의 programStatus가 따라 바뀐다", async () => {
    // 이 값을 빠뜨리면 게시해도 collectionGroup 규칙에 막혀 검색에 안 잡힙니다(6-1).
    const id = await makePendingProgram(providerUid);
    await testDb.doc(`programs/${id}/schedules/s1`).set({
      programId: id,
      programStatus: "pending_review",
      startAt: new Date(),
    });

    await reviewProgram(testDb, id, {
      decision: "approved",
      note: null,
      adminUid: ADMIN_UID,
    });

    const s = await testDb.doc(`programs/${id}/schedules/s1`).get();
    expect(s.get("programStatus")).toBe("published");
  });

  it("반려하면 hidden + 반려 사유가 공급자에게 남는다", async () => {
    const id = await makePendingProgram(providerUid);
    await reviewProgram(testDb, id, {
      decision: "rejected",
      note: "가격 근거를 설명에 추가해 주세요",
      adminUid: ADMIN_UID,
    });

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("status")).toBe("hidden");
    expect(snap.get("reviewNote")).toBe("가격 근거를 설명에 추가해 주세요");
    expect(snap.get("publishedAt")).toBeNull();
  });

  it("주소에서 시도를 못 뽑으면 게시하지 않는다", async () => {
    const id = await makePendingProgram(providerUid);
    // 등록 시에는 통과했지만 이후 주소가 바뀐 상황(파생 필드 재계산이 막아냅니다).
    await testDb.doc(`programs/${id}`).update({ location: { address: "산 속 어딘가" } });

    await expect(
      reviewProgram(testDb, id, { decision: "approved", note: null, adminUid: ADMIN_UID })
    ).rejects.toMatchObject({ code: "invalid-argument" });

    // 지역 필터에서 영구히 누락되는 문서를 만들지 않고 심사 대기로 남깁니다(4번).
    expect((await testDb.doc(`programs/${id}`).get()).get("status")).toBe("pending_review");
  });
});
