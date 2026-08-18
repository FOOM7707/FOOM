/**
 * 위경도 → 기상청 격자 변환 (스키마 16-3).
 *
 * **이 변환이 틀리면 에러가 아니라 "옆 동네 날씨"로 나타납니다.** 화면은 정상으로
 * 보이는데 값만 엉뚱하므로 눈으로는 잡을 수 없습니다. 그래서 널리 알려진
 * 기준점의 격자값과 대조합니다.
 */

import { describe, expect, it } from "vitest";
import { isInKorea, toKmaGrid } from "../src/lib/kmaGrid";

describe("toKmaGrid — 알려진 기준점", () => {
  it("서울시청 (37.5665, 126.9780) → nx 60, ny 127", () => {
    // 기상청 예제와 각종 공개 자료가 공통으로 쓰는 기준값입니다.
    expect(toKmaGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
  });

  it("제주시청 (33.4996, 126.5312) → nx 53, ny 38", () => {
    expect(toKmaGrid(33.4996, 126.5312)).toEqual({ nx: 53, ny: 38 });
  });

  it("부산시청 (35.1798, 129.0750) → nx 98, ny 76", () => {
    expect(toKmaGrid(35.1798, 129.075)).toEqual({ nx: 98, ny: 76 });
  });
});

describe("toKmaGrid — 격자가 캐시 단위로 동작하는가", () => {
  it("5km 안쪽으로 떨어진 두 좌표는 같은 격자에 들어간다", () => {
    // 캐시가 격자 단위라 이게 성립해야 호출 수가 방문자 수에 비례하지 않습니다(16-1).
    const a = toKmaGrid(37.5665, 126.978); // 서울시청
    const b = toKmaGrid(37.5701, 126.9822); // 약 500m 북동
    expect(b).toEqual(a);
  });

  it("멀리 떨어진 좌표는 다른 격자가 된다", () => {
    expect(toKmaGrid(37.5665, 126.978)).not.toEqual(toKmaGrid(35.1798, 129.075));
  });
});

describe("isInKorea", () => {
  it("국내 좌표는 통과", () => {
    expect(isInKorea(37.5665, 126.978)).toBe(true);
    expect(isInKorea(33.4996, 126.5312)).toBe(true); // 제주
  });

  it("국외 좌표는 거른다 — 격자로 바꿔도 의미가 없다", () => {
    expect(isInKorea(35.6812, 139.7671)).toBe(false); // 도쿄
    expect(isInKorea(0, 0)).toBe(false);
  });
});
