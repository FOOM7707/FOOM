/**
 * 전화번호 정규화 (15-4).
 * 이 함수가 흔들리면 중복 검사가 통째로 무력해지므로 입력 형태를 넓게 고정합니다.
 */

import { describe, expect, it } from "vitest";
import { isMobile, maskPhone, normalizePhone } from "../src/lib/phone";

describe("normalizePhone", () => {
  it.each([
    ["010-1234-5678", "+821012345678"],
    ["01012345678", "+821012345678"],
    ["010 1234 5678", "+821012345678"],
    ["+82 10 1234 5678", "+821012345678"],
    ["+821012345678", "+821012345678"],
    ["821012345678", "+821012345678"],
    ["+82 010 1234 5678", "+821012345678"], // +82 뒤에 0이 남은 표기
    ["02-123-4567", "+8221234567"], // 유선 서울 — 앞자리 0 제거
  ])("%s → %s", (input, expected) => {
    const result = normalizePhone(input);
    expect(result.ok).toBe(true);
    expect(result.e164).toBe(expected);
  });

  it("표기가 달라도 같은 번호는 같은 문자열이 된다 (중복 검사의 전제)", () => {
    const a = normalizePhone("010-1234-5678").e164;
    const b = normalizePhone("+82 10 1234 5678").e164;
    const c = normalizePhone("01012345678").e164;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it.each([
    [null, "empty"],
    [undefined, "empty"],
    ["", "empty"],
    ["   ", "empty"],
    ["010-abcd-5678", "not_numeric"],
    ["010-1234", "bad_length"],
    ["+1 415 555 0100", "not_kr"],
  ])("%s 는 거부한다 (%s)", (input, error) => {
    const result = normalizePhone(input as string | null | undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(error);
    expect(result.e164).toBeUndefined();
  });
});

describe("isMobile", () => {
  it("휴대전화와 유선을 구분한다", () => {
    expect(isMobile("+821012345678")).toBe(true);
    expect(isMobile("+8221234567")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("로그에 남겨도 되는 형태로 가린다", () => {
    const masked = maskPhone("+821012345678");
    expect(masked).not.toContain("12345");
    expect(masked).toContain("****");
  });
});
