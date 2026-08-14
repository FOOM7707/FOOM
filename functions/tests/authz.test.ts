/**
 * 권한 판단 순수 함수 (6-2 ①).
 * 이 검사가 뚫리면 정산 지급 API가 그대로 열리므로 에뮬레이터와 무관하게 고정합니다.
 */

import { describe, expect, it } from "vitest";
import { assertAdmin, assertSignedIn, isAdmin } from "../src/lib/authz";
import { AppError } from "../src/lib/errors";

describe("assertSignedIn", () => {
  it("uid가 있으면 통과한다", () => {
    expect(assertSignedIn({ uid: "u1" }).uid).toBe("u1");
  });

  it("토큰이 없으면 unauthenticated", () => {
    expect(() => assertSignedIn(undefined)).toThrowError(AppError);
    try {
      assertSignedIn(null);
    } catch (err) {
      expect((err as AppError).code).toBe("unauthenticated");
      expect((err as AppError).status).toBe(401);
    }
  });
});

describe("assertAdmin", () => {
  it("admin:true 클레임이 있으면 통과한다", () => {
    expect(assertAdmin({ uid: "u1", admin: true }).uid).toBe("u1");
  });

  it("클레임이 없으면 permission-denied(403)", () => {
    try {
      assertAdmin({ uid: "u1" });
      throw new Error("통과하면 안 됩니다");
    } catch (err) {
      expect((err as AppError).code).toBe("permission-denied");
      expect((err as AppError).status).toBe(403);
    }
  });

  it("비로그인은 permission-denied가 아니라 unauthenticated로 구분된다", () => {
    try {
      assertAdmin(undefined);
      throw new Error("통과하면 안 됩니다");
    } catch (err) {
      expect((err as AppError).code).toBe("unauthenticated");
    }
  });

  // Custom Claims는 임의 JSON이라 값의 타입을 우리가 보장할 수 없습니다.
  // truthy 비교(admin ? ...)로 쓰면 아래 값들이 전부 관리자로 통과합니다.
  it.each([["true"], [1], [{}], [["admin"]], ["yes"]])(
    "admin 클레임이 %o 면 거부한다",
    (value) => {
      expect(isAdmin({ uid: "u1", admin: value })).toBe(false);
      expect(() => assertAdmin({ uid: "u1", admin: value })).toThrowError(AppError);
    }
  );
});
