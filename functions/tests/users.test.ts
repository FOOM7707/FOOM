/**
 * GET·PATCH /users/me (스키마 5번 · 2-1 · 2-14).
 *
 * 확인하는 것: 공급자 심사 상태가 본인에게 내려가는가 / 소비자에게는
 * provider 블록이 아예 없는가 / 민감값(계좌·본인확인 원본)이 새지 않는가 /
 * 마이페이지 수정이 권한·상태를 건드리지 못하는가 / 연락처가 E.164로만
 * 저장되고 번호 선점(`phoneIndex`)이 함께 움직이는가.
 */

import { describe, expect, it } from "vitest";
import { grantProvider } from "../src/lib/providerGrant";
import { reviewProvider } from "../src/lib/adminReview";
import { getMe, parseUpdateMeInput, updateMe } from "../src/lib/users";
import { testDb } from "./helpers";

let seq = 0;

async function makeUser(): Promise<string> {
  seq += 1;
  const uid = `me-user-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "이용자1234",
    email: "someone@example.com",
    phone: "+821012345678",
    profileImageUrl: null,
    status: "active",
    identityVerifiedAt: null,
  });
  return uid;
}

describe("getMe", () => {
  it("소비자는 provider 블록이 null이다", async () => {
    const uid = await makeUser();
    const me = await getMe(testDb, uid);

    expect(me.role).toBe("consumer");
    expect(me.provider).toBeNull();
    expect(me.name).toBe("이용자1234");
  });

  it("공급자는 심사 상태를 함께 받는다", async () => {
    const uid = await makeUser();
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });

    const me = await getMe(testDb, uid);
    expect(me.role).toBe("provider");
    expect(me.provider).toMatchObject({
      displayName: "숲협동조합",
      verified: false,
      approvalStatus: "pending",
    });
  });

  it("반려 사유는 본인에게 보인다 — 안 보이면 재신청할 수 없다", async () => {
    const uid = await makeUser();
    await grantProvider({ uid }, { db: testDb });
    await reviewProvider(testDb, uid, {
      decision: "rejected",
      note: "자격증을 다시 올려주세요",
      adminUid: "admin-1",
    });

    const me = await getMe(testDb, uid);
    expect(me.provider?.approvalStatus).toBe("rejected");
    expect(me.provider?.approvalNote).toBe("자격증을 다시 올려주세요");
  });

  it("정산 계좌는 응답에 넣지 않는다", async () => {
    const uid = await makeUser();
    await grantProvider({ uid }, { db: testDb });
    await testDb.doc(`providerProfiles/${uid}/private/profile`).update({
      bankAccount: { bankName: "농협", accountNumber: "3521234567890", holderName: "홍길동" },
    });

    const me = await getMe(testDb, uid);
    expect(JSON.stringify(me)).not.toContain("3521234567890");
  });

  it("가입 문서가 없으면 failed-precondition", async () => {
    await expect(getMe(testDb, "가입안한계정")).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });
});

describe("parseUpdateMeInput", () => {
  it("보내지 않은 항목은 건드리지 않는다 — null과 「안 보냄」은 다르다", () => {
    const input = parseUpdateMeInput({ name: "홍길동" });
    expect(input.name).toBe("홍길동");
    expect(input.phone).toBeUndefined();
  });

  it("빈 이름은 거부한다 — 남에게 보이는 값이라 비면 빈칸이 남는다", () => {
    expect(() => parseUpdateMeInput({ name: "   " })).toThrow(/이름/);
  });

  it("너무 긴 이름은 거부한다", () => {
    expect(() => parseUpdateMeInput({ name: "가".repeat(31) })).toThrow(/30자/);
  });

  it("연락처는 E.164로 정규화된다 — 형식이 섞이면 중복 감지가 무력해진다", () => {
    expect(parseUpdateMeInput({ phone: "010-1234-5678" }).phone).toBe("+821012345678");
    expect(parseUpdateMeInput({ phone: "+82 10 1234 5678" }).phone).toBe("+821012345678");
  });

  it("말이 안 되는 연락처는 거부한다", () => {
    expect(() => parseUpdateMeInput({ phone: "123" })).toThrow(/연락처/);
  });

  it("바꿀 내용이 없으면 거부한다", () => {
    expect(() => parseUpdateMeInput({})).toThrow(/바꿀 내용/);
  });

  it("role·status는 아예 읽지 않는다 — 이 경로로도 권한이 바뀌지 않는다", () => {
    const input = parseUpdateMeInput({
      name: "홍길동",
      role: "admin",
      status: "suspended",
    }) as unknown as Record<string, unknown>;
    expect(input.role).toBeUndefined();
    expect(input.status).toBeUndefined();
  });
});

/**
 * ⚠️ **이 파일 전용 번호 대역입니다(`010-8101-xxxx`).**
 *
 * `phoneIndex`는 문서 ID가 번호 그 자체인 **전역 공간**이고(2-14), vitest는 테스트
 * 파일을 **병렬로** 돌립니다. 다른 파일과 같은 번호를 쓰면 한쪽이 선점을 지우는
 * 사이 다른 쪽이 조회해 **양쪽이 번갈아 실패합니다** — 실제로 `socialAuth.test.ts`와
 * `010-7777-8888`·`010-3333-4444`가 겹쳐 그렇게 깨졌습니다. 번호를 새로 쓸 때는
 * 이 대역 안에서 고르세요.
 */
const PHONE = {
  before: "010-8101-0001",
  after: "010-8101-0002",
  takenByOther: "010-8101-0003",
  claimedByMe: "010-8101-0004",
} as const;

/** `010-8101-0001` → `+821081010001` */
function e164(display: string): string {
  return `+82${display.replace(/-/g, "").replace(/^0/, "")}`;
}

describe("updateMe", () => {
  it("이름을 바꾸고 바뀐 값을 돌려준다", async () => {
    const uid = await makeUser();
    const me = await updateMe(testDb, uid, parseUpdateMeInput({ name: "김숲사랑" }));

    expect(me.name).toBe("김숲사랑");
    expect((await testDb.doc(`users/${uid}`).get()).get("name")).toBe("김숲사랑");
  });

  it("권한·상태는 그대로 남는다", async () => {
    const uid = await makeUser();
    await updateMe(testDb, uid, parseUpdateMeInput({ name: "김숲사랑" }));

    const doc = await testDb.doc(`users/${uid}`).get();
    expect(doc.get("role")).toBe("consumer");
    expect(doc.get("status")).toBe("active");
  });

  it("연락처를 바꾸면 번호 선점이 새 번호로 옮겨간다 (2-14)", async () => {
    const uid = await makeUser();
    const before = e164(PHONE.before);
    const after = e164(PHONE.after);
    await testDb.doc(`users/${uid}`).update({ phone: before });
    await testDb.doc(`phoneIndex/${before}`).set({ uid, createdAt: new Date() });

    const me = await updateMe(testDb, uid, parseUpdateMeInput({ phone: PHONE.after }));
    expect(me.phone).toBe(after);

    // 새 번호는 선점되고, 예전 번호는 풀립니다 — 안 풀면 그 번호를 실제로
    // 쓰는 사람이 못 쓰고 본인도 되돌릴 수 없습니다.
    expect((await testDb.doc(`phoneIndex/${after}`).get()).get("uid")).toBe(uid);
    expect((await testDb.doc(`phoneIndex/${before}`).get()).exists).toBe(false);
  });

  it("남이 쓰는 번호는 거부한다 — 조용히 안 바꾸면 고장으로 읽힌다", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const taken = e164(PHONE.takenByOther);
    await testDb.doc(`phoneIndex/${taken}`).set({ uid: owner, createdAt: new Date() });

    await expect(
      updateMe(testDb, other, parseUpdateMeInput({ phone: PHONE.takenByOther }))
    ).rejects.toMatchObject({ code: "failed-precondition" });

    // 거부됐으므로 남의 선점도 그대로여야 합니다.
    expect((await testDb.doc(`phoneIndex/${taken}`).get()).get("uid")).toBe(owner);
  });

  it("내가 선점해 둔 번호로는 바꿀 수 있다 — 내 것에 내가 막히면 안 된다", async () => {
    const uid = await makeUser();
    const mine = e164(PHONE.claimedByMe);
    // 저장된 번호와 선점해 둔 번호가 어긋난 상태(가입 중간에 끊긴 계정 등).
    await testDb.doc(`users/${uid}`).update({ phone: null });
    await testDb.doc(`phoneIndex/${mine}`).set({ uid, createdAt: new Date() });

    const me = await updateMe(testDb, uid, parseUpdateMeInput({ phone: PHONE.claimedByMe }));
    expect(me.phone).toBe(mine);
  });

  it("가입 문서가 없으면 failed-precondition", async () => {
    await expect(
      updateMe(testDb, "가입안한계정2", parseUpdateMeInput({ name: "홍길동" }))
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
