/**
 * 출입증(Custom Claims)의 전문가 표시 (2026-09-11).
 *
 * 확인하는 것: 회원 정보를 그대로 따라가는지 / **다른 표시(`admin`)를 지우지 않는지** /
 * 바뀐 게 없으면 쓰지 않는지 / 자격 부여·심사가 표시를 함께 바꾸는지.
 *
 * **`admin`을 지우지 않는지 테스트로 못박는 이유:** 출입증 쓰기는 전체를 덮어쓰는
 * 방식이라, 이전 값을 합치지 않으면 **관리자 권한이 조용히 사라집니다.** 에러가
 * 나지 않고 「어느 날 관리자 메뉴가 안 보인다」로만 나타납니다.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { reviewProvider } from "../src/lib/adminReview";
import {
  readProviderState,
  syncProviderClaims,
  syncProviderClaimsFromDb,
  type ProviderClaimsPort,
} from "../src/lib/providerClaims";
import { grantProvider } from "../src/lib/providerGrant";
import { testDb } from "./helpers";

let seq = 0;

/** 출입증을 기억만 하는 가짜 통로. 쓰기 횟수를 세어 「필요할 때만 쓰는지」를 봅니다. */
function fakePort(initial: Record<string, unknown> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  let writes = 0;
  const port: ProviderClaimsPort = {
    async getClaims(uid) {
      return store.get(uid) ?? { ...initial };
    },
    async setClaims(uid, claims) {
      writes += 1;
      store.set(uid, claims);
    },
  };
  return {
    port,
    get writes() {
      return writes;
    },
    claimsOf: (uid: string) => store.get(uid) ?? { ...initial },
  };
}

async function makeUser(): Promise<string> {
  seq += 1;
  const uid = `claims-user-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "테스트",
    status: "active",
  });
  return uid;
}

describe("출입증 맞추기", () => {
  let port: ReturnType<typeof fakePort>;

  beforeEach(() => {
    port = fakePort();
  });

  it("전문가가 되면 표시를 답니다", async () => {
    const changed = await syncProviderClaims(port.port, "u1", {
      provider: true,
      providerApproved: false,
    });
    expect(changed).toBe(true);
    expect(port.claimsOf("u1")).toEqual({ provider: true });
  });

  it("승인되면 승인 표시가 함께 붙습니다", async () => {
    await syncProviderClaims(port.port, "u1", { provider: true, providerApproved: true });
    expect(port.claimsOf("u1")).toEqual({ provider: true, providerApproved: true });
  });

  it("값이 false면 키를 지웁니다 — 출입증에 쓸데없는 값을 남기지 않습니다", async () => {
    await syncProviderClaims(port.port, "u1", { provider: true, providerApproved: true });
    await syncProviderClaims(port.port, "u1", { provider: false, providerApproved: false });
    expect(port.claimsOf("u1")).toEqual({});
  });

  it("바뀐 게 없으면 쓰지 않습니다", async () => {
    await syncProviderClaims(port.port, "u1", { provider: true, providerApproved: false });
    expect(port.writes).toBe(1);

    const again = await syncProviderClaims(port.port, "u1", {
      provider: true,
      providerApproved: false,
    });
    expect(again).toBe(false);
    expect(port.writes).toBe(1);
  });

  it("⚠️ 관리자 표시를 지우지 않습니다", async () => {
    // 합치지 않으면 관리자 권한이 조용히 사라집니다 — 보안규칙과 함수 진입부가
    // 보는 값이라 「어느 날 관리자 메뉴가 안 보인다」로만 드러납니다.
    const admin = fakePort({ admin: true });
    await syncProviderClaims(admin.port, "u1", { provider: true, providerApproved: true });
    expect(admin.claimsOf("u1")).toEqual({
      admin: true,
      provider: true,
      providerApproved: true,
    });
  });
});

describe("회원 정보 읽기", () => {
  it("일반 회원은 둘 다 아닙니다", async () => {
    const uid = await makeUser();
    expect(await readProviderState(testDb, uid)).toEqual({
      provider: false,
      providerApproved: false,
    });
  });

  it("자격을 받으면 전문가이고, 승인 전이라 승인 표시는 없습니다", async () => {
    const uid = await makeUser();
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
    expect(await readProviderState(testDb, uid)).toEqual({
      provider: true,
      providerApproved: false,
    });
  });

  it("승인되면 승인 표시가 켜집니다", async () => {
    const uid = await makeUser();
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
    await testDb
      .doc(`providerProfiles/${uid}/private/profile`)
      .update({ approvalStatus: "approved" });
    expect(await readProviderState(testDb, uid)).toEqual({
      provider: true,
      providerApproved: true,
    });
  });

  it("자격이 없으면 승인 표시도 켜지지 않습니다", async () => {
    // 자격을 회수했는데 승인 표시만 남으면 헤더가 「프로그램 등록」을 계속 보여줍니다.
    const uid = await makeUser();
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
    await testDb
      .doc(`providerProfiles/${uid}/private/profile`)
      .update({ approvalStatus: "approved" });
    await testDb.doc(`users/${uid}`).update({ role: "consumer" });

    expect(await readProviderState(testDb, uid)).toEqual({
      provider: false,
      providerApproved: false,
    });
  });
});

describe("자격 부여·심사가 출입증을 함께 바꿉니다", () => {
  it("자격을 주면 전문가 표시가 붙습니다", async () => {
    const uid = await makeUser();
    const port = fakePort();
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb, claimsPort: port.port });
    expect(port.claimsOf(uid)).toEqual({ provider: true });
  });

  it("출입증 통로가 없어도 자격 부여는 성공합니다", async () => {
    // 이 표시는 버튼 모양만 정합니다 — 없다고 자격 부여가 실패하면 안 됩니다.
    const uid = await makeUser();
    await expect(
      grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb })
    ).resolves.toMatchObject({ uid });
  });

  it("승인하면 승인 표시가 붙습니다", async () => {
    const uid = await makeUser();
    const port = fakePort();
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
    await reviewProvider(
      testDb,
      uid,
      { decision: "approved", note: "확인함", adminUid: "admin-1" },
      port.port
    );
    expect(port.claimsOf(uid)).toEqual({ provider: true, providerApproved: true });
  });

  it("반려하면 전문가 표시는 남고 승인 표시만 빠집니다", async () => {
    // 반려돼도 자격 자체는 남으므로(`users.role`은 그대로), 헤더가 「심사 상태 보기」를
    // 보여줘야 합니다. 전문가 표시까지 떼면 「전문가로 활동하기」로 되돌아갑니다.
    const uid = await makeUser();
    const port = fakePort();
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
    await reviewProvider(
      testDb,
      uid,
      { decision: "rejected", note: "자격증 확인 불가", adminUid: "admin-1" },
      port.port
    );
    expect(port.claimsOf(uid)).toEqual({ provider: true });
  });
});

describe("로그인할 때 맞추기", () => {
  it("어긋난 출입증을 회원 정보에 맞춥니다", async () => {
    // 「로그아웃 후 다시 로그인」이 언제나 즉시 고치는 방법이 되어야 합니다.
    const uid = await makeUser();
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
    await testDb
      .doc(`providerProfiles/${uid}/private/profile`)
      .update({ approvalStatus: "approved" });

    const port = fakePort();
    expect(await syncProviderClaimsFromDb(testDb, port.port, uid)).toBe(true);
    expect(port.claimsOf(uid)).toEqual({ provider: true, providerApproved: true });
  });

  it("출입증 쪽이 실패해도 로그인을 막지 않습니다", async () => {
    const broken: ProviderClaimsPort = {
      getClaims: async () => {
        throw new Error("출입증을 읽지 못했습니다");
      },
      setClaims: async () => {},
    };
    const uid = await makeUser();
    await expect(syncProviderClaimsFromDb(testDb, broken, uid)).resolves.toBe(false);
  });
});
