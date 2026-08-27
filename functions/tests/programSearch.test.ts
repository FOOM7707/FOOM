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
  PERIOD_MAX_DAYS,
  PRICE_MAX,
  extractDistrictNames,
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

// 시각을 고정합니다 — 실제 시각을 쓰면 달이 바뀔 때마다 테스트가 흔들립니다.
// UTC 03:00 = KST 정오라 날짜 경계 문제가 없습니다.
const PERIOD_NOW = new Date("2026-08-24T03:00:00Z");

function periodDefaults(overrides: Record<string, unknown> = {}) {
  return parseSearchQuery(overrides, PERIOD_NOW);
}

describe("parseSearchQuery — 기간 (서버에서도 잘라낸다, 17-6)", () => {
  it("기간을 안 주면 null — 기간 필터 없음", () => {
    const f = periodDefaults();
    expect(f.from).toBeNull();
    expect(f.to).toBeNull();
  });

  it("정상 범위는 그대로 통과한다", () => {
    const f = periodDefaults({ from: "2026-09-01", to: "2026-09-05" });
    expect(f.from).toBe("2026-09-01");
    expect(f.to).toBe("2026-09-05");
  });

  it("형식이 틀리면 거부한다", () => {
    expect(() => periodDefaults({ from: "9월1일", to: "2026-09-05" })).toThrow();
  });

  it("지난 날짜는 오늘로 당긴다 — UI 제한만으로는 직접 호출을 못 막는다", () => {
    const f = periodDefaults({ from: "2026-08-01", to: "2026-08-26" });
    expect(f.from).toBe("2026-08-24");
    expect(f.to).toBe("2026-08-26");
  });

  it("전부 지난 기간이면 오늘 하루로 접힌다", () => {
    const f = periodDefaults({ from: "2026-08-01", to: "2026-08-10" });
    expect(f.from).toBe("2026-08-24");
    expect(f.to).toBe("2026-08-24");
  });

  it("+90일을 넘는 끝은 잘라낸다 — 회차 요약이 담는 범위와 같은 값", () => {
    const f = periodDefaults({ from: "2026-11-10", to: "2027-03-01" });
    expect(f.from).toBe("2026-11-10");
    expect(f.to).toBe("2026-11-22"); // 2026-08-24 + 90일
  });

  it(`${PERIOD_MAX_DAYS}일을 넘으면 종료일을 당긴다`, () => {
    const f = periodDefaults({ from: "2026-08-25", to: "2026-10-20" });
    expect(f.from).toBe("2026-08-25");
    expect(f.to).toBe("2026-09-24"); // 8/25부터 31일째 되는 날
  });

  it("순서가 뒤집혀 있으면 바로잡는다", () => {
    const f = periodDefaults({ from: "2026-09-10", to: "2026-09-01" });
    expect(f.from).toBe("2026-09-01");
    expect(f.to).toBe("2026-09-10");
  });

  it("시작만 주면 그 하루로 본다", () => {
    const f = periodDefaults({ from: "2026-09-03" });
    expect(f.from).toBe("2026-09-03");
    expect(f.to).toBe("2026-09-03");
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

describe("matchesFilters — 기간 (scheduleDates 교집합, 17-2)", () => {
  const program = {
    id: "p-period",
    title: "기간시험",
    category: "숲길등산",
    scheduleType: "series",
    scheduleDates: ["2026-09-05", "2026-09-19"],
  };

  it("기간 안에 회차가 하루라도 있으면 통과한다", () => {
    expect(
      matchesFilters(program, periodDefaults({ from: "2026-09-01", to: "2026-09-06" }))
    ).toBe(true);
  });

  it("겹침이 아니라 교집합이다 — 회차 사이의 빈 기간은 걸러진다", () => {
    // nextScheduleAt~lastScheduleAt 겹침으로 판정하면 9/5와 9/19 사이(9/7~9/10)도
    // 통과해버립니다 — 그래서 방법 B를 버렸습니다(17-2).
    expect(
      matchesFilters(program, periodDefaults({ from: "2026-09-07", to: "2026-09-10" }))
    ).toBe(false);
  });

  it("회차 요약이 아예 없으면 걸러진다", () => {
    const noDates = { ...program, scheduleDates: [] };
    expect(
      matchesFilters(noDates, periodDefaults({ from: "2026-09-01", to: "2026-09-06" }))
    ).toBe(false);
  });

  it("상시모집은 문의 가능 기간이 겹치면 포함한다 — 기간 필터의 예외(17-2)", () => {
    const open = {
      ...program,
      scheduleType: "open",
      scheduleDates: [],
      availableFrom: "2026-09-01",
      availableUntil: "2026-09-30",
    };
    expect(matchesFilters(open, periodDefaults({ from: "2026-09-10", to: "2026-09-12" }))).toBe(
      true
    );
    // 문의 가능 기간이 시작되기 전의 검색에는 안 나옵니다.
    expect(matchesFilters(open, periodDefaults({ from: "2026-08-25", to: "2026-08-28" }))).toBe(
      false
    );
  });

  it("상시모집의 기간이 비어 있으면 제한 없음으로 본다", () => {
    const open = {
      ...program,
      scheduleType: "open",
      scheduleDates: [],
      availableFrom: null,
      availableUntil: null,
    };
    expect(matchesFilters(open, periodDefaults({ from: "2026-09-10", to: "2026-09-12" }))).toBe(
      true
    );
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

  it("달력 점의 재료(calendarDates)를 함께 내려준다 — 지난 날짜는 뺀다", async () => {
    // 미래 날짜는 테스트가 언제 돌아도 미래이도록 만들어 씁니다.
    const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    await makePublished(
      { title: "달력점 확인" },
      { scheduleDates: [future, "2000-01-01"] }
    );

    const result = await searchPrograms(testDb, defaults());
    expect(result.calendarDates).toContain(future);
    // 요약 정리 배치가 아직 없어 과거 날짜가 남아 있을 수 있습니다 — 점에서는 뺍니다.
    expect(result.calendarDates).not.toContain("2000-01-01");
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

/**
 * 지역 이름 필터 (2026-08-27 신규).
 *
 * 확인하는 것: **주소에서 지역 이름만 뽑는지**(시도 이름·번지·도로명이 섞이면 자동완성
 * 후보가 오염됩니다) / 시도 코드로 먼저 좁히는지(「중구」는 다섯 시도에 있습니다) /
 * 응답의 지역 목록이 개수와 함께 오는지.
 */
describe("extractDistrictNames — 주소에서 지역 이름만", () => {
  it("시·군·구·읍·면·동만 뽑고 시도 이름은 뺀다", () => {
    expect(extractDistrictNames("부산광역시 사상구 학장동 123-4")).toEqual([
      "사상구",
      "학장동",
    ]);
    expect(extractDistrictNames("경기 수원시 팔달구 화서동 12")).toEqual([
      "수원시",
      "팔달구",
      "화서동",
    ]);
  });

  it("세종특별자치시·제주특별자치도처럼 시도로 끝나는 이름을 뽑지 않는다", () => {
    // 「특별자치시」가 시로 끝나서 접미사 규칙만으로는 걸리므로 따로 막습니다.
    expect(extractDistrictNames("세종특별자치시 조치원읍")).toEqual(["조치원읍"]);
    expect(extractDistrictNames("제주특별자치도 제주시 애월읍")).toEqual([
      "제주시",
      "애월읍",
    ]);
  });

  it("도로명·번지는 지역 이름이 아니다", () => {
    expect(extractDistrictNames("서울특별시 중구 세종대로 110")).toEqual(["중구"]);
    expect(extractDistrictNames("")).toEqual([]);
    expect(extractDistrictNames(null)).toEqual([]);
  });
});

describe("parseSearchQuery — 시도·지역 이름", () => {
  it("알 수 없는 시도 코드는 거부한다", () => {
    expect(() => defaults({ sido: "hwaseong" })).toThrow();
  });

  it("시도 코드 17종은 통과한다", () => {
    expect(defaults({ sido: "busan" }).sido).toBe("busan");
    expect(defaults({ sido: "sejong" }).sido).toBe("sejong");
  });

  it("지역 이름은 목록으로 검증하지 않고 길이만 자른다", () => {
    expect(defaults({ locality: "사상구" }).locality).toBe("사상구");
    expect(defaults({ locality: "  " }).locality).toBeNull();
    expect(defaults({ locality: "가".repeat(50) }).locality).toHaveLength(20);
  });
});

describe("matchesFilters — 시도·지역 이름", () => {
  const busanJunggu = {
    id: "a",
    sido: "busan",
    location: { address: "부산광역시 중구 대청동1가 1" },
  };
  const seoulJunggu = {
    id: "b",
    sido: "seoul",
    location: { address: "서울특별시 중구 세종대로 110" },
  };

  it("시도가 다르면 걸러진다", () => {
    expect(matchesFilters(busanJunggu, defaults({ sido: "busan" }))).toBe(true);
    expect(matchesFilters(seoulJunggu, defaults({ sido: "busan" }))).toBe(false);
  });

  it("같은 이름이 여러 시도에 있어도 시도로 갈린다 — 「중구」", () => {
    const f = defaults({ sido: "busan", locality: "중구" });
    expect(matchesFilters(busanJunggu, f)).toBe(true);
    expect(matchesFilters(seoulJunggu, f)).toBe(false);
  });

  it("주소에 없는 지역 이름은 걸러진다", () => {
    expect(matchesFilters(busanJunggu, defaults({ locality: "사상구" }))).toBe(false);
    expect(matchesFilters(busanJunggu, defaults({ locality: "대청동" }))).toBe(true);
  });

  it("주소가 없는 프로그램은 지역 이름으로 찾을 수 없다", () => {
    expect(matchesFilters({ id: "c", sido: "busan" }, defaults({ locality: "중구" }))).toBe(
      false
    );
  });
});

describe("searchPrograms — 지역 이름으로 좁히기", () => {
  it("주소의 시·군·구로 좁혀진다", async () => {
    await makePublished({ title: "홍천 둘레길", location: { address: "강원도 홍천군 서면" } });
    await makePublished({ title: "평창 숲길", location: { address: "강원도 평창군 대관령면" } });

    const all = await searchPrograms(testDb, defaults({ sido: "gangwon" }));
    const titles = all.programs.map((p) => p.title);
    expect(titles).toContain("홍천 둘레길");
    expect(titles).toContain("평창 숲길");

    const narrowed = await searchPrograms(testDb, defaults({ sido: "gangwon", locality: "홍천군" }));
    const narrowedTitles = narrowed.programs.map((p) => p.title);
    expect(narrowedTitles).toContain("홍천 둘레길");
    expect(narrowedTitles).not.toContain("평창 숲길");
  });

  it("응답이 「프로그램이 있는 지역」을 개수와 함께 알려준다", async () => {
    await makePublished({ location: { address: "강원도 홍천군 서면" } });

    const res = await searchPrograms(testDb, defaults());
    const hongcheon = res.districts.find((d) => d.name === "홍천군");
    expect(hongcheon).toBeDefined();
    expect(hongcheon?.sido).toBe("gangwon");
    expect(hongcheon?.count).toBeGreaterThan(0);
    // 시도 이름은 지역 목록에 들어가지 않습니다.
    expect(res.districts.some((d) => d.name.endsWith("특별시"))).toBe(false);
  });
});
