/**
 * GET /users/me (스키마 5번 · 2-1).
 *
 * 확인하는 것: 공급자 심사 상태가 본인에게 내려가는가 / 소비자에게는
 * provider 블록이 아예 없는가 / 민감값(계좌·본인확인 원본)이 새지 않는가.
 */

import { describe, expect, it } from "vitest";
import { grantProvider } from "../src/lib/providerGrant";
import { reviewProvider } from "../src/lib/adminReview";
import { getMe } from "../src/lib/users";
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
