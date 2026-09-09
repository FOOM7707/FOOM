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

async function makeUser(overrides: Record<string, unknown> = {}): Promise<string> {
  seq += 1;
  const uid = `me-user-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "이용자1234",
    email: "someone@example.com",
    phone: "+821012345678",
    // 출처 없는 옛 문서(2026-09-09 이전) 모양이 기본입니다 — 직접 입력처럼 다뤄져야 합니다.
    profileImageUrl: null,
    status: "active",
    identityVerifiedAt: null,
    ...overrides,
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

  it("연락처 출처를 함께 내려준다 — 화면이 잠글지 말지를 이 값으로 가른다", async () => {
    const naver = await makeUser({ phoneSource: "naver" });
    expect((await getMe(testDb, naver)).phoneSource).toBe("naver");

    const manual = await makeUser({ phoneSource: "manual" });
    expect((await getMe(testDb, manual)).phoneSource).toBe("manual");

    // 출처가 없는 옛 문서와 목록 밖의 값은 null — 화면이 모르는 값을 만나지 않게
    const legacy = await makeUser();
    expect((await getMe(testDb, legacy)).phoneSource).toBeNull();
    const weird = await makeUser({ phoneSource: "carrier-pigeon" });
    expect((await getMe(testDb, weird)).phoneSource).toBeNull();
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

  it("직접 입력한 번호는 저장되지만 phoneIndex를 선점하지 않는다 (2-14, 2026-09-09)", async () => {
    const uid = await makeUser({ phone: null, phoneSource: null });
    const after = e164(PHONE.after);

    const me = await updateMe(testDb, uid, parseUpdateMeInput({ phone: PHONE.after }));
    expect(me.phone).toBe(after);
    expect(me.phoneSource).toBe("manual");

    // 인증 안 된 번호는 선점하지 않습니다 — 선점하면 남의 번호를 먼저 등록해
    // 실소유자를 막는 길(스쿼팅)이 열립니다.
    expect((await testDb.doc(`phoneIndex/${after}`).get()).exists).toBe(false);
  });

  it("예전 번호에 남아 있던 우리 선점은 풀어준다 (2026-09-09 이전에 여기서 선점한 것)", async () => {
    const uid = await makeUser();
    const before = e164(PHONE.before);
    await testDb.doc(`users/${uid}`).update({ phone: before });
    await testDb.doc(`phoneIndex/${before}`).set({ uid, createdAt: new Date() });

    await updateMe(testDb, uid, parseUpdateMeInput({ phone: PHONE.after }));

    // 안 풀면 그 번호를 실제로 쓰는 사람이 못 쓰고 본인도 되돌릴 수 없습니다.
    expect((await testDb.doc(`phoneIndex/${before}`).get()).exists).toBe(false);
  });

  it("남이 쓰는 번호를 넣어도 응답이 같다 — 거부하면 그 번호 주인이 회원인지 새어 나간다", async () => {
    const owner = await makeUser();
    const other = await makeUser({ phone: null });
    const taken = e164(PHONE.takenByOther);
    await testDb.doc(`phoneIndex/${taken}`).set({ uid: owner, createdAt: new Date() });

    // 8/28 보안검사 B-1: 예전에는 여기서 failed-precondition으로 갈라 열거가 됐습니다.
    const me = await updateMe(testDb, other, parseUpdateMeInput({ phone: PHONE.takenByOther }));
    expect(me.phone).toBe(taken);
    expect(me.phoneSource).toBe("manual");

    // 남의 선점은 건드리지 않습니다 — 중복 판별은 인증된 번호(선점)만 봅니다.
    expect((await testDb.doc(`phoneIndex/${taken}`).get()).get("uid")).toBe(owner);
  });

  it("소셜이 준 번호는 여기서 바꿀 수 없다 — 그 서비스에서 바꾸고 재로그인", async () => {
    const uid = await makeUser({ phone: e164(PHONE.claimedByMe), phoneSource: "naver" });

    await expect(
      updateMe(testDb, uid, parseUpdateMeInput({ phone: PHONE.after }))
    ).rejects.toMatchObject({ code: "failed-precondition", message: /네이버/ });

    // 이름만 고치는 것은 그대로 됩니다 — 잠긴 것은 번호뿐입니다.
    const me = await updateMe(testDb, uid, parseUpdateMeInput({ name: "김숲사랑" }));
    expect(me.name).toBe("김숲사랑");
    expect(me.phone).toBe(e164(PHONE.claimedByMe));
    expect(me.phoneSource).toBe("naver");
  });

  it("잠긴 번호를 같은 값으로 되보내는 것은 거부하지 않는다 — 화면이 값을 그대로 넘겨도 안전", async () => {
    const mine = e164(PHONE.claimedByMe);
    const uid = await makeUser({ phone: mine, phoneSource: "kakao" });

    const me = await updateMe(
      testDb,
      uid,
      parseUpdateMeInput({ name: "홍길동", phone: PHONE.claimedByMe })
    );
    expect(me.name).toBe("홍길동");
    expect(me.phoneSource).toBe("kakao");
  });

  it("출처가 없는 옛 문서의 번호는 직접 입력처럼 다뤄 고칠 수 있다", async () => {
    // 2026-09-09 이전 가입자. 소셜이 번호를 주는 다음 로그인 때 출처가 채워집니다.
    const uid = await makeUser({ phone: e164(PHONE.before) });

    const me = await updateMe(testDb, uid, parseUpdateMeInput({ phone: PHONE.after }));
    expect(me.phone).toBe(e164(PHONE.after));
    expect(me.phoneSource).toBe("manual");
  });

  it("가입 문서가 없으면 failed-precondition", async () => {
    await expect(
      updateMe(testDb, "가입안한계정2", parseUpdateMeInput({ name: "홍길동" }))
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
