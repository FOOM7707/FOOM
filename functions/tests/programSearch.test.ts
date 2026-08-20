/**
 * 프로그램 검색 (`GET /programs/search`, 스키마 17번).
 *
 * 확인하는 것: **게시된 것만 나오는지**(이 경로는 로그인 없이 호출되고 Admin SDK라
 * 규칙을 우회합니다 — 17-6) / 필터 판정 / 「제한 없음」 연령이 사라지지 않는지 /
 * 가격 상한이 「이상」으로 동작하는지 / 인원 필터가 최소 인원까지 보는지 / 정렬.
 *
 * 판정 규칙은 프론트(`src/lib/programFilter.ts`)에서 옮겨온 것입니다. 옮긴 이유는
 * Firestore 논리합 30개 제한이고(17-1), **옮겼으므로 이제 이쪽이 기준입니다.**
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  PRICE_MAX,
  matchesFilters,
  parseSearchQuery,
  searchPrograms,
} from "../src/lib/programSearch";
import { createDraftProgram, parseProgramInput } from "../src/lib/programs";
import { grantProvider } from "../src/lib/providerGrant";
import { testDb } from "./helpers";

let providerUid: string;
let seq = 0;

async function makeUser(): Promise<string> {
  seq += 1;
  const uid = `search-provider-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "테스트",
    status: "active",
  });
  await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
  return uid;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    title: "가을 숲길 걷기",
    description: "국립자연휴양림 둘레길을 함께 걷습니다.",
    category: "숲길등산",
    qualificationType: "mountain_trail_guide",
    location: { address: "강원도 홍천군 서면" },
    price: 30000,
    capacity: 12,
    minCapacity: 4,
    scheduleType: "series",
    barrierFree: false,
    rainAlternative: "reschedule",
    walkingDistanceM: 2000,
    targetAgeMin: null,
    targetAgeMax: null,
    ...overrides,
  };
}

/** 검색 대상이 되도록 게시 상태로 만들어 둡니다. */
async function makePublished(
  overrides: Record<string, unknown> = {},
  patch: Record<string, unknown> = {}
): Promise<string> {
  const { id } = await createDraftProgram(testDb, providerUid, parseProgramInput(body(overrides)));
  await testDb.doc(`programs/${id}`).update({
    status: "published",
    publishedAt: new Date(),
    ...patch,
  });
  return id;
}

function defaults(overrides: Record<string, unknown> = {}) {
  return parseSearchQuery(overrides as Record<string, unknown>);
}

beforeAll(async () => {
  providerUid = await makeUser();
});

describe("parseSearchQuery", () => {
  it("아무것도 없으면 기본값", () => {
    const f = defaults();
    expect(f.categories).toEqual([]);
    expect(f.region).toBeNull();
    expect(f.priceMin).toBe(0);
    expect(f.priceMax).toBe(PRICE_MAX);
    expect(f.sort).toBe("popular");
  });

  it("카테고리는 공식명칭 5종만 통과한다", () => {
    const f = defaults({ categories: "숲해설,숲치유,산림치유" });
    // 「숲치유」는 옛 표기라 버려집니다.
    expect(f.categories).toEqual(["숲해설", "산림치유"]);
  });

  it("알 수 없는 지역은 거부한다", () => {
    expect(() => defaults({ region: "화성" })).toThrow();
  });

  it("알 수 없는 정렬은 인기순으로 떨어진다", () => {
    expect(defaults({ sort: "아무거나" }).sort).toBe("popular");
  });

  it("status는 받지 않는다 — 심사 중 프로그램을 조회할 수 없다", () => {
    const f = defaults({ status: "pending_review" }) as unknown as Record<string, unknown>;
    expect(f.status).toBeUndefined();
  });
});

describe("matchesFilters", () => {
  const program = {
    id: "p1",
    title: "가을 숲길 걷기",
    description: "둘레길",
    category: "숲길등산",
    location: { address: "강원도 홍천군 서면" },
    sido: "gangwon",
    price: 30000,
    capacity: 12,
    minCapacity: 4,
    difficulty: "normal",
    barrierFree: false,
    rainAlternative: "reschedule",
    targetAgeTags: ["adult", "senior"],
  };

  it("카테고리가 다르면 걸러진다", () => {
    expect(matchesFilters(program, defaults({ categories: "산림치유" }))).toBe(false);
    expect(matchesFilters(program, defaults({ categories: "숲길등산" }))).toBe(true);
  });

  it("지역은 주소 문자열이 아니라 시도 코드로 판정한다", () => {
    expect(matchesFilters(program, defaults({ region: "강원" }))).toBe(true);
    expect(matchesFilters(program, defaults({ region: "제주" }))).toBe(false);
  });

  it("가격 상한이 최대치면 「이상」이라 위를 막지 않는다", () => {
    const pricey = { ...program, price: 500_000 };
    expect(matchesFilters(pricey, defaults({ priceMax: String(PRICE_MAX) }))).toBe(true);
    expect(matchesFilters(pricey, defaults({ priceMax: "50000" }))).toBe(false);
  });

  it("인원 필터는 최소 인원까지 본다 — 혼자 가면 폐강되는 프로그램을 「1인 가능」에 넣지 않는다", () => {
    // 최소 4명이라 혼자 신청하면 D-1에 자동 취소됩니다(2-4).
    expect(matchesFilters(program, defaults({ headcount: "1" }))).toBe(false);
    expect(matchesFilters(program, defaults({ headcount: "4" }))).toBe(true);
    // 정원 12명이라 20명은 안 됩니다.
    expect(matchesFilters(program, defaults({ headcount: "20" }))).toBe(false);
  });

  it("「제한 없음」 프로그램은 어떤 연령을 골라도 나온다", () => {
    // 빼면 전연령 프로그램이 사라져 결과가 부자연스럽게 비어 보입니다(17-3).
    const all = { ...program, targetAgeTags: ["all"] };
    expect(matchesFilters(all, defaults({ ageTags: "infant" }))).toBe(true);
    expect(matchesFilters(program, defaults({ ageTags: "infant" }))).toBe(false);
  });

  it("난이도·배리어프리·우천대체", () => {
    expect(matchesFilters(program, defaults({ difficulty: "hard" }))).toBe(false);
    expect(matchesFilters(program, defaults({ barrierFree: "1" }))).toBe(false);
    expect(matchesFilters(program, defaults({ rainAlternative: "1" }))).toBe(true);
    const noRain = { ...program, rainAlternative: "none" };
    expect(matchesFilters(noRain, defaults({ rainAlternative: "1" }))).toBe(false);
  });

  it("검색어는 제목·소개·주소를 본다", () => {
    expect(matchesFilters(program, defaults({ keyword: "숲길" }))).toBe(true);
    expect(matchesFilters(program, defaults({ keyword: "홍천" }))).toBe(true);
    expect(matchesFilters(program, defaults({ keyword: "제주도" }))).toBe(false);
  });
});

describe("searchPrograms — 게시된 것만", () => {
  it("게시되지 않은 프로그램은 결과에 없다", async () => {
    // 이 경로는 로그인 없이 호출되고 Admin SDK라 규칙을 우회합니다 —
    // 함수 안에서 막지 않으면 심사 중 프로그램이 그대로 노출됩니다(17-6).
    const { id: draftId } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(body({ title: "작성 중인 프로그램" }))
    );
    const publishedId = await makePublished({ title: "게시된 프로그램" });

    const result = await searchPrograms(testDb, defaults({ keyword: "프로그램" }));
    const ids = result.programs.map((p) => p.id);

    expect(ids).toContain(publishedId);
    expect(ids).not.toContain(draftId);
  });

  it("반려·심사 중도 결과에 없다", async () => {
    const hidden = await makePublished({ title: "반려된 것" }, { status: "hidden" });
    const pending = await makePublished({ title: "심사 중인 것" }, { status: "pending_review" });

    const result = await searchPrograms(testDb, defaults({ limit: "100" }));
    const ids = result.programs.map((p) => p.id);
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(pending);
  });

  it("목록에 필요한 값만 내려보낸다 — 소개 블록·회차는 넣지 않는다", async () => {
    const id = await makePublished({ title: "응답 모양 확인" });
    const result = await searchPrograms(testDb, defaults({ keyword: "응답 모양" }));
    const row = result.programs.find((p) => p.id === id)!;

    expect(row.title).toBe("응답 모양 확인");
    expect(row.location).toBeDefined();
    expect(row.introBlocks).toBeUndefined();
    expect(row.schedules).toBeUndefined();
    expect(row.reviewNote).toBeUndefined();
  });

  it("대표 사진 한 장만 내려보낸다", async () => {
    const id = await makePublished(
      { title: "사진 여러 장" },
      { imageUrls: ["https://x/a", "https://x/b", "https://x/c"] }
    );
    const result = await searchPrograms(testDb, defaults({ keyword: "사진 여러 장" }));
    const row = result.programs.find((p) => p.id === id)!;
    expect(row.imageUrls).toEqual(["https://x/a"]);
  });

  it("잘렸으면 알려준다 — 조용히 자르면 「이게 전부」로 읽힌다", async () => {
    await makePublished({ title: "잘림 확인 하나" });
    await makePublished({ title: "잘림 확인 둘" });

    const result = await searchPrograms(testDb, defaults({ keyword: "잘림 확인", limit: "1" }));
    expect(result.programs).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(true);
  });
});

describe("searchPrograms — 정렬", () => {
  it("낮은가격순", async () => {
    const cheap = await makePublished({ title: "정렬시험 저가", price: 10000 });
    const pricey = await makePublished({ title: "정렬시험 고가", price: 90000 });

    const result = await searchPrograms(
      testDb,
      defaults({ keyword: "정렬시험", sort: "price_asc" })
    );
    const ids = result.programs.map((p) => p.id);
    expect(ids.indexOf(cheap)).toBeLessThan(ids.indexOf(pricey));
  });

  it("인기순은 기준 필드가 비어 있는 동안 최근 게시 순으로 떨어진다", async () => {
    // bookingCount30d를 채우는 배치가 아직 없어 전부 0입니다. 그대로 두면 순서가
    // 매번 바뀌므로 게시 시각으로 갈라줍니다.
    const older = await makePublished(
      { title: "인기시험 예전" },
      { publishedAt: new Date("2026-01-01") }
    );
    const newer = await makePublished(
      { title: "인기시험 최근" },
      { publishedAt: new Date("2026-08-01") }
    );

    const result = await searchPrograms(testDb, defaults({ keyword: "인기시험" }));
    const ids = result.programs.map((p) => p.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
  });

  it("평점순 — 평점이 같으면 최근 게시가 위", async () => {
    const low = await makePublished({ title: "평점시험 낮음" }, { ratingAvg: 3.0 });
    const high = await makePublished({ title: "평점시험 높음" }, { ratingAvg: 4.8 });

    const result = await searchPrograms(
      testDb,
      defaults({ keyword: "평점시험", sort: "rating" })
    );
    const ids = result.programs.map((p) => p.id);
    expect(ids.indexOf(high)).toBeLessThan(ids.indexOf(low));
  });
});
