/**
 * 파생 필드 산출 (스키마 2-3).
 * 경계를 잘못 잡으면 검색 결과가 조용히 어긋나므로 표 그대로 고정합니다.
 */

import { describe, expect, it } from "vitest";
import {
  deriveDifficulty,
  deriveProgramFields,
  deriveRequiresChildInfo,
  deriveTargetAgeTags,
} from "../src/lib/programDerived";
import { extractSido, REGION_TO_SIDO } from "../src/lib/sido";

describe("deriveDifficulty — 거리 하나에서만 나온다", () => {
  it.each([
    [null, "easy"],
    [0, "easy"],
    [1000, "easy"],
    [1001, "normal"],
    [3000, "normal"],
    [3001, "hard"],
    [12000, "hard"],
  ])("%s m → %s", (distance, expected) => {
    expect(deriveDifficulty(distance)).toBe(expected);
  });

  it("거리가 없으면 easy — 실내 명상·유아 놀이 등 '거의 걷지 않는' 프로그램", () => {
    expect(deriveDifficulty(null)).toBe("easy");
    expect(deriveDifficulty(undefined)).toBe("easy");
  });
});

describe("deriveTargetAgeTags", () => {
  it("2-3 예시 그대로", () => {
    expect(deriveTargetAgeTags(3, 6)).toEqual(["infant"]);
    expect(deriveTargetAgeTags(5, 10)).toEqual(["infant", "child"]);
  });

  it("한 살이라도 겹치면 붙인다 (양끝 포함)", () => {
    expect(deriveTargetAgeTags(6, 7)).toEqual(["infant", "child"]);
    expect(deriveTargetAgeTags(12, 13)).toEqual(["child", "teen"]);
    expect(deriveTargetAgeTags(64, 65)).toEqual(["adult", "senior"]);
  });

  it("한쪽만 null이면 0 또는 120으로 치환", () => {
    expect(deriveTargetAgeTags(null, 6)).toEqual(["infant"]);
    expect(deriveTargetAgeTags(65, null)).toEqual(["senior"]);
  });

  // all을 다른 태그와 함께 붙이면 연령 필터가 아무것도 걸러내지 못합니다.
  it("둘 다 null일 때만 ['all']이고, 다른 태그는 붙지 않는다", () => {
    expect(deriveTargetAgeTags(null, null)).toEqual(["all"]);
    expect(deriveTargetAgeTags(0, 120)).not.toContain("all");
  });

  it("전 연령 범위는 all이 아니라 태그 5종을 모두 갖는다", () => {
    expect(deriveTargetAgeTags(0, 120)).toEqual([
      "infant",
      "child",
      "teen",
      "adult",
      "senior",
    ]);
  });

  it("태그가 하나도 안 붙는 입력이 와도 빈 배열을 내지 않는다", () => {
    // 빈 배열이면 그 프로그램은 어떤 연령 필터에도 안 걸려 검색에서 사라집니다.
    expect(deriveTargetAgeTags(200, 300)).toEqual(["all"]);
  });
});

describe("deriveRequiresChildInfo (15-6 판별 근거)", () => {
  it("유아숲체험은 연령과 무관하게 true", () => {
    expect(deriveRequiresChildInfo(null, "유아숲체험")).toBe(true);
    expect(deriveRequiresChildInfo(70, "유아숲체험")).toBe(true);
  });

  it("targetAgeMax <= 13 이면 true", () => {
    expect(deriveRequiresChildInfo(13, "산림치유")).toBe(true);
    expect(deriveRequiresChildInfo(14, "산림치유")).toBe(false);
  });

  it("연령 제한이 없으면 false — 15-6이 지적한 구멍은 예약 폼에서 보완", () => {
    expect(deriveRequiresChildInfo(null, "산림치유")).toBe(false);
  });
});

describe("extractSido", () => {
  it.each([
    ["강원도 홍천군 서면", "gangwon"],
    ["강원특별자치도 홍천군", "gangwon"],
    ["강원 홍천군", "gangwon"],
    ["경기도 양평군 양평읍", "gyeonggi"],
    ["서울특별시 강남구", "seoul"],
    ["제주특별자치도 서귀포시", "jeju"],
    ["전북특별자치도 전주시", "jeonbuk"],
    ["충청남도 공주시", "chungnam"],
  ])("%s → %s", (address, expected) => {
    expect(extractSido(address)).toBe(expected);
  });

  // 문자열 어디서나 찾으면 "경기도 광주시"가 광주광역시로 잡힙니다.
  it("경기도 광주시는 gwangju가 아니라 gyeonggi", () => {
    expect(extractSido("경기도 광주시 오포읍")).toBe("gyeonggi");
  });

  it("인식 못 하면 null — 호출부가 저장을 거부해야 한다", () => {
    expect(extractSido("어딘가 산속")).toBeNull();
    expect(extractSido("")).toBeNull();
    expect(extractSido(null)).toBeNull();
  });
});

describe("REGION_TO_SIDO", () => {
  it("17개 시도를 빠짐없이 덮는다", () => {
    const covered = new Set(Object.values(REGION_TO_SIDO).flat());
    expect(covered.size).toBe(17);
  });

  it("한 시도가 두 권역에 중복으로 들어가지 않는다", () => {
    const all = Object.values(REGION_TO_SIDO).flat();
    expect(all.length).toBe(new Set(all).size);
  });
});

describe("deriveProgramFields", () => {
  it("주소에서 시도를 못 뽑으면 던진다 (빈 값 저장 금지 — 4번)", () => {
    expect(() =>
      deriveProgramFields({
        category: "산림치유",
        address: "산 속 어딘가",
        targetAgeMin: null,
        targetAgeMax: null,
        walkingDistanceM: null,
      })
    ).toThrow();
  });

  it("네 값을 한 번에 산출한다", () => {
    expect(
      deriveProgramFields({
        category: "유아숲체험",
        address: "경기도 양평군 양평읍",
        targetAgeMin: 3,
        targetAgeMax: 6,
        walkingDistanceM: 800,
      })
    ).toEqual({
      targetAgeTags: ["infant"],
      difficulty: "easy",
      sido: "gyeonggi",
      requiresChildInfo: true,
    });
  });
});
