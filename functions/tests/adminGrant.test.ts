/**
 * 관리자 지정 스크립트 (13번 P0 / 12-3).
 *
 * 확인하는 것:
 *  1. users.role 과 Custom Claims 를 **둘 다** 갱신하는가
 *  2. 한쪽만 갱신된 상태를 감지하는가 (양방향)
 *  3. 클레임 설정이 실패하면 users.role 을 되돌리는가
 *  4. 가입하지 않은 계정에는 권한을 주지 않는가 (12-3 공용 계정 금지)
 *  5. 회수 시 클레임 제거 + 리프레시 토큰 무효화 (6-2 ②)
 */

import { describe, expect, it } from "vitest";
import {
  grantAdmin,
  revokeAdmin,
  verifyAdminConsistency,
} from "../src/lib/adminGrant";
import { AppError } from "../src/lib/errors";
import {
  createSignedUpUser,
  realAuthPort,
  testAuth,
  testDb,
  testDeps,
} from "./helpers";

describe("grantAdmin", () => {
  it("users.role 과 Custom Claims 를 둘 다 갱신한다", async () => {
    const uid = await createSignedUpUser();

    const result = await grantAdmin(uid, testDeps());

    expect(result.previousRole).toBe("consumer");

    // 두 값을 각각 원본에서 다시 읽어 확인합니다.
    const user = await testAuth.getUser(uid);
    const snap = await testDb.doc(`users/${uid}`).get();
    expect(user.customClaims?.admin).toBe(true);
    expect(snap.get("role")).toBe("admin");
    expect(result.report.consistent).toBe(true);
  });

  it("기존 Custom Claims 를 지우지 않고 admin 만 얹는다", async () => {
    const uid = await createSignedUpUser();
    await testAuth.setCustomUserClaims(uid, { someOtherClaim: "keep-me" });

    await grantAdmin(uid, testDeps());

    const user = await testAuth.getUser(uid);
    expect(user.customClaims?.admin).toBe(true);
    expect(user.customClaims?.someOtherClaim).toBe("keep-me");
  });

  it("users/{uid} 문서가 없으면 거부한다 (가입 먼저 — 12-3 공용 계정 금지)", async () => {
    const uid = `no-doc-${Date.now()}`;
    await testAuth.createUser({ uid });

    await expect(grantAdmin(uid, testDeps())).rejects.toMatchObject({
      code: "failed-precondition",
    });

    // 아무것도 남기지 않아야 합니다.
    const user = await testAuth.getUser(uid);
    expect(user.customClaims?.admin).toBeUndefined();
  });

  it("Auth 계정 자체가 없으면 not-found", async () => {
    await expect(grantAdmin("존재하지-않는-uid", testDeps())).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("Custom Claims 설정이 실패하면 users.role 을 되돌린다", async () => {
    const uid = await createSignedUpUser("provider");

    // 클레임 설정만 실패하도록 갈아끼웁니다.
    const failingDeps = {
      db: testDb,
      authPort: {
        ...realAuthPort(),
        setCustomUserClaims: () => Promise.reject(new Error("의도된 실패")),
      },
    };

    await expect(grantAdmin(uid, failingDeps)).rejects.toBeInstanceOf(AppError);

    // role 이 admin 으로 남으면 "관리자 메뉴는 뜨는데 아무것도 안 되는" 계정이 됩니다.
    const snap = await testDb.doc(`users/${uid}`).get();
    expect(snap.get("role")).toBe("provider");

    const user = await testAuth.getUser(uid);
    expect(user.customClaims?.admin).toBeUndefined();

    // 롤백까지 끝났으므로 상태는 일관됩니다(둘 다 관리자 아님).
    const report = await verifyAdminConsistency(uid, testDeps());
    expect(report.consistent).toBe(true);
  });
});

describe("verifyAdminConsistency — 한쪽만 갱신된 상태 감지", () => {
  it("클레임만 있고 role 이 없으면 불일치로 잡는다 (위험한 쪽)", async () => {
    const uid = await createSignedUpUser();
    await testAuth.setCustomUserClaims(uid, { admin: true });

    const report = await verifyAdminConsistency(uid, testDeps());

    expect(report.claimAdmin).toBe(true);
    expect(report.role).toBe("consumer");
    expect(report.consistent).toBe(false);
    expect(report.problem).toContain("추적 불가");
  });

  it("role 만 admin 이고 클레임이 없으면 불일치로 잡는다 (안전한 쪽)", async () => {
    const uid = await createSignedUpUser();
    await testDb.doc(`users/${uid}`).update({ role: "admin" });

    const report = await verifyAdminConsistency(uid, testDeps());

    expect(report.claimAdmin).toBe(false);
    expect(report.role).toBe("admin");
    expect(report.consistent).toBe(false);
    expect(report.problem).toContain("동작하지 않습니다");
  });

  it("둘 다 관리자가 아니면 일치로 본다", async () => {
    const uid = await createSignedUpUser();
    const report = await verifyAdminConsistency(uid, testDeps());
    expect(report.consistent).toBe(true);
    expect(report.problem).toBeNull();
  });
});

describe("revokeAdmin", () => {
  it("클레임을 제거하고 role 을 되돌리며 세션을 무효화한다", async () => {
    const uid = await createSignedUpUser();
    await grantAdmin(uid, testDeps());

    const before = await testAuth.getUser(uid);
    const result = await revokeAdmin(uid, "consumer", testDeps());

    const after = await testAuth.getUser(uid);
    const snap = await testDb.doc(`users/${uid}`).get();

    expect(after.customClaims?.admin).toBeUndefined();
    expect(snap.get("role")).toBe("consumer");
    expect(result.report.consistent).toBe(true);

    // 6-2 ② — 이미 발급된 ID 토큰은 최대 1시간 유효하므로 함께 끊습니다.
    expect(after.tokensValidAfterTime).not.toBe(before.tokensValidAfterTime);
  });

  it("공급자였던 계정은 --role provider 로 되돌릴 수 있다", async () => {
    const uid = await createSignedUpUser("provider");
    await grantAdmin(uid, testDeps());

    await revokeAdmin(uid, "provider", testDeps());

    const snap = await testDb.doc(`users/${uid}`).get();
    expect(snap.get("role")).toBe("provider");
  });
});
