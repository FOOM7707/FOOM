/**
 * 소셜 가입·재로그인 규칙 (스키마 v14).
 *
 * v14에서 결정한 규칙이 실제로 지켜지는지를 고정합니다. 특히 role 덮어쓰기는
 * "관리자가 로그인만 해도 권한 상태가 깨지는" 사고라 반드시 테스트로 막습니다.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  resolveDisplayName,
  socialUid,
  upsertSocialUser,
  type SocialUpsertDeps,
} from "../src/lib/socialAuth";
import type { SocialProfile } from "../src/lib/naver";
import { testAuth, testDb } from "./helpers";

function deps(): SocialUpsertDeps {
  return {
    db: testDb,
    authUser: {
      async getUser(uid) {
        try {
          const u = await testAuth.getUser(uid);
          return { uid: u.uid };
        } catch {
          return null;
        }
      },
      async createUser(uid) {
        await testAuth.createUser({ uid });
      },
    },
  };
}

let seq = 0;
function profile(overrides: Partial<SocialProfile> = {}): SocialProfile {
  seq += 1;
  return {
    providerUserId: `nv-${Date.now()}-${seq}`,
    nickname: "숲사랑",
    email: "user@example.com",
    phone: "010-1234-5678",
    profileImageUrl: null,
    ...overrides,
  };
}

async function userDoc(uid: string) {
  return testDb.doc(`users/${uid}`).get();
}

describe("resolveDisplayName", () => {
  it("별명이 있으면 그대로 쓴다", () => {
    expect(resolveDisplayName("숲사랑", "naver_123456")).toBe("숲사랑");
  });

  it("별명이 없으면 이용자+uid 뒤 4자리", () => {
    expect(resolveDisplayName(null, "naver_123456")).toBe("이용자3456");
    expect(resolveDisplayName("   ", "naver_987654")).toBe("이용자7654");
  });

  // 앞 4자리를 쓰면 uid가 naver_ 로 시작해 모두가 "이용자nave"가 됩니다.
  it("서로 다른 사용자는 서로 다른 폴백 이름을 갖는다", () => {
    const a = resolveDisplayName(null, socialUid("naver", "111111"));
    const b = resolveDisplayName(null, socialUid("naver", "222222"));
    expect(a).not.toBe(b);
  });

  it("이메일 앞부분은 어떤 경우에도 이름에 들어가지 않는다", () => {
    expect(resolveDisplayName(null, "naver_1")).not.toContain("@");
    expect(resolveDisplayName(null, "naver_1")).toMatch(/^이용자/);
  });
});

describe("신규 가입", () => {
  it("users 문서를 스키마 2-1대로 만든다", async () => {
    const p = profile();
    const { uid, isNew } = await upsertSocialUser({ provider: "naver", profile: p }, deps());

    expect(isNew).toBe(true);
    const snap = await userDoc(uid);
    expect(snap.get("role")).toBe("consumer");
    expect(snap.get("authProvider")).toBe("naver");
    expect(snap.get("status")).toBe("active");
    expect(snap.get("identityVerifiedAt")).toBeNull();
    expect(snap.get("name")).toBe("숲사랑");
    expect(snap.get("email")).toBe("user@example.com");
    expect(snap.get("createdAt")).toBeTruthy();
  });

  it("전화번호를 E.164로 정규화해 저장한다", async () => {
    const { uid } = await upsertSocialUser(
      { provider: "naver", profile: profile({ phone: "010-9876-5432" }) },
      deps()
    );
    expect((await userDoc(uid)).get("phone")).toBe("+821098765432");
  });

  it("phoneIndex를 선점한다", async () => {
    const { uid } = await upsertSocialUser(
      { provider: "naver", profile: profile({ phone: "010-1111-2222" }) },
      deps()
    );
    const idx = await testDb.doc("phoneIndex/+821011112222").get();
    expect(idx.exists).toBe(true);
    expect(idx.get("uid")).toBe(uid);
  });

  it("약관 동의 이력을 같은 트랜잭션에 남긴다 (2-12)", async () => {
    const { uid } = await upsertSocialUser(
      { provider: "naver", profile: profile(), marketingAgreed: true },
      deps()
    );
    const rows = await testDb.collection("termsAgreements").where("uid", "==", uid).get();
    expect(rows.size).toBe(1);
    expect(rows.docs[0].get("service")).toBe(true);
    expect(rows.docs[0].get("privacy")).toBe(true);
    expect(rows.docs[0].get("marketing")).toBe(true);
    expect(rows.docs[0].get("version")).toBeTruthy();
  });

  it("별명·이메일·전화번호가 전부 없어도 가입이 된다", async () => {
    // 필수 동의 항목이어도 계정에 값이 없으면 빈 값이 옵니다(15-4).
    const { uid } = await upsertSocialUser(
      {
        provider: "naver",
        profile: profile({ nickname: null, email: null, phone: null }),
      },
      deps()
    );
    const snap = await userDoc(uid);
    expect(snap.get("name")).toMatch(/^이용자/);
    expect(snap.get("email")).toBeNull();
    expect(snap.get("phone")).toBeNull();
  });

  it("정규화되지 않는 번호는 가입을 막지 않고 그냥 비워둔다", async () => {
    const { uid } = await upsertSocialUser(
      { provider: "naver", profile: profile({ phone: "1234" }) },
      deps()
    );
    expect((await userDoc(uid)).get("phone")).toBeNull();
  });
});

describe("재로그인", () => {
  it("role을 덮어쓰지 않는다 — 관리자가 로그인해도 admin 유지", async () => {
    const p = profile();
    const { uid } = await upsertSocialUser({ provider: "naver", profile: p }, deps());

    // 이 계정을 관리자로 승격시킨 뒤 다시 로그인시킵니다.
    await testDb.doc(`users/${uid}`).update({ role: "admin" });
    await upsertSocialUser({ provider: "naver", profile: p }, deps());

    expect((await userDoc(uid)).get("role")).toBe("admin");
  });

  it("사용자가 바꾼 이름을 소셜 별명으로 덮어쓰지 않는다", async () => {
    const p = profile();
    const { uid } = await upsertSocialUser({ provider: "naver", profile: p }, deps());
    await testDb.doc(`users/${uid}`).update({ name: "내가바꾼이름" });

    await upsertSocialUser(
      { provider: "naver", profile: { ...p, nickname: "네이버별명" } },
      deps()
    );

    expect((await userDoc(uid)).get("name")).toBe("내가바꾼이름");
  });

  it("사용자가 직접 입력한 전화번호를 덮어쓰지 않는다", async () => {
    const p = profile({ phone: null });
    const { uid } = await upsertSocialUser({ provider: "naver", profile: p }, deps());
    // 첫 예약 화면에서 직접 입력한 상황
    await testDb.doc(`users/${uid}`).update({ phone: "+821055556666" });

    await upsertSocialUser(
      { provider: "naver", profile: { ...p, phone: "010-1234-5678" } },
      deps()
    );

    expect((await userDoc(uid)).get("phone")).toBe("+821055556666");
  });

  it("비어 있던 항목은 나중에 채워진다 (fill-if-empty)", async () => {
    // 프로필 사진 제공을 나중에 켜는 시나리오 — 기존 사용자도 채워져야 합니다.
    const p = profile({ profileImageUrl: null, email: null });
    const { uid } = await upsertSocialUser({ provider: "naver", profile: p }, deps());
    expect((await userDoc(uid)).get("profileImageUrl")).toBeNull();

    await upsertSocialUser(
      {
        provider: "naver",
        profile: { ...p, profileImageUrl: "https://example.com/a.jpg", email: "a@b.kr" },
      },
      deps()
    );

    const snap = await userDoc(uid);
    expect(snap.get("profileImageUrl")).toBe("https://example.com/a.jpg");
    expect(snap.get("email")).toBe("a@b.kr");
  });

  it("탈퇴 계정은 자동으로 되살리지 않는다", async () => {
    const p = profile();
    const { uid } = await upsertSocialUser({ provider: "naver", profile: p }, deps());
    await testDb.doc(`users/${uid}`).update({ status: "withdrawn" });

    await expect(
      upsertSocialUser({ provider: "naver", profile: p }, deps())
    ).rejects.toMatchObject({ code: "failed-precondition" });

    expect((await userDoc(uid)).get("status")).toBe("withdrawn");
  });

  it("약관 동의 이력을 로그인할 때마다 새로 만들지 않는다", async () => {
    const p = profile();
    const { uid } = await upsertSocialUser({ provider: "naver", profile: p }, deps());
    await upsertSocialUser({ provider: "naver", profile: p }, deps());
    await upsertSocialUser({ provider: "naver", profile: p }, deps());

    const rows = await testDb.collection("termsAgreements").where("uid", "==", uid).get();
    expect(rows.size).toBe(1);
  });
});

describe("전화번호 중복", () => {
  it("차단하지 않되 두 번째 계정에는 번호를 저장하지 않는다", async () => {
    const shared = "010-7777-8888";
    const first = await upsertSocialUser(
      { provider: "naver", profile: profile({ phone: shared }) },
      deps()
    );
    const second = await upsertSocialUser(
      { provider: "naver", profile: profile({ phone: shared }) },
      deps()
    );

    // v14 — 가입 자체는 성공합니다.
    expect(second.isNew).toBe(true);
    expect(second.phoneDuplicated).toBe(true);

    // 인덱스 주인은 처음 선점한 계정 그대로입니다.
    const idx = await testDb.doc("phoneIndex/+821077778888").get();
    expect(idx.get("uid")).toBe(first.uid);
    expect((await userDoc(second.uid)).get("phone")).toBeNull();
  });

  it("같은 사람이 다시 로그인하는 것은 중복이 아니다", async () => {
    const p = profile({ phone: "010-3333-4444" });
    await upsertSocialUser({ provider: "naver", profile: p }, deps());
    const again = await upsertSocialUser({ provider: "naver", profile: p }, deps());
    expect(again.phoneDuplicated).toBe(false);
  });
});

describe("uid 생성", () => {
  beforeEach(() => {
    seq += 1;
  });

  it("공급자를 접두사로 붙여 식별자 충돌을 막는다", () => {
    expect(socialUid("naver", "123")).toBe("naver_123");
    expect(socialUid("kakao", "123")).toBe("kakao_123");
    expect(socialUid("naver", "123")).not.toBe(socialUid("kakao", "123"));
  });
});
