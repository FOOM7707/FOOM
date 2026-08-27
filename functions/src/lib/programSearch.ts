/**
 * 프로그램 검색 (`GET /programs/search`, 스키마 17번).
 *
 * **필터 판정이 서버에 있는 이유**(17-1) — Firestore는 쿼리 하나를 논리합 30개로
 * 제한하는데 카테고리 다중선택(5) × 대상연령 다중선택(6)만으로 상한에 닿고, 기간까지
 * 얹으면 불가능합니다. 필터 조합마다 복합 인덱스가 필요해지는 문제도 있습니다.
 * → **단일 필드 쿼리(`status == 'published'`)로 후보를 가져와 메모리에서 판정합니다.**
 * 이 쿼리는 자동 색인으로 충분해 인덱스를 만들 필요가 없습니다.
 *
 * **집계 문서 캐시는 아직 쓰지 않습니다(v28).** 17-1의 설계는 `aggregates/searchIndex`
 * 1건만 읽는 것인데, 그것은 프로그램이 수백 건일 때의 최적화입니다. **지금은 게시
 * 프로그램이 한 자리 수라 캐시를 먼저 만들면 맞게 도는지 확인할 방법이 없습니다** —
 * 붙이는 자리는 같으므로 수십 건을 넘을 때 얹습니다. 그때까지 이 함수가 매 요청마다
 * 게시 프로그램을 읽습니다(건수가 적어 읽기 비용이 무의미한 수준).
 *
 * **`status == 'published'`를 함수 안에서 못박습니다(17-6).** 이 경로는 로그인 없이
 * 호출되고 Admin SDK라 보안규칙을 우회하므로, 여기서 막지 않으면 심사 중·반려된
 * 프로그램이 그대로 검색에 노출됩니다.
 */

import type { Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { PROGRAM_CATEGORIES } from "./programs";
import { REGION_TO_SIDO, type Sido } from "./sido";
import { CALENDAR_WINDOW_DAYS, kstDateString, kstToInstant } from "./schedules";

/** 가격 상한. 이 값이면 「이상」이라 위쪽을 막지 않습니다(17-3). */
export const PRICE_MAX = 300_000;

/** 한 번에 돌려주는 최대 건수 */
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

/** 기간 필터에서 한 번에 고를 수 있는 연속 일수(17-2) */
export const PERIOD_MAX_DAYS = 31;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export type SortKey = "popular" | "price_asc" | "recent" | "rating";

export interface SearchFilters {
  keyword: string | null;
  /** 빈 배열 = 전체 */
  categories: string[];
  /** null = 전국 */
  region: string | null;
  /**
   * 시도 코드 하나. 홈의 지역 칸이 「부산」·「부산 사상구」를 고르면 들어옵니다.
   * `region`(권역)보다 좁고, 둘이 함께 오면 둘 다 통과해야 합니다.
   */
  sido: string | null;
  /**
   * 시·군·구·읍·면·동 이름 하나(「사상구」·「화서동」). **주소에 이 이름이 들어
   * 있는지**로 봅니다 — 저장된 값이 시도 코드뿐이라 그보다 좁은 판정은 주소
   * 문자열밖에 근거가 없습니다. 같은 이름이 여러 시도에 있으므로(중구·남구)
   * **`sido`와 함께 와야 뜻이 정해집니다.**
   */
  locality: string | null;
  priceMin: number;
  priceMax: number;
  /** 함께 가는 인원. null = 상관없음 */
  headcount: number | null;
  /** 빈 배열 = 전체 */
  ageTags: string[];
  difficulty: string | null;
  barrierFree: boolean;
  /** 우천 시 대체 방식이 있는 프로그램만 */
  rainAlternative: boolean;
  /** 기간 시작(KST `YYYY-MM-DD`). null = 기간 필터 없음 */
  from: string | null;
  /** 기간 끝. `from`이 있으면 항상 함께 있고, `from <= to`가 보장됩니다 */
  to: string | null;
  sort: SortKey;
  limit: number;
}

/**
 * 유효한 시도 코드 — 권역 매핑표에서 뽑습니다. 17개를 따로 적으면 표와 어긋날 수
 * 있고, 어긋나면 「그 지역만 검색에서 빠지는」 형태로 나타납니다.
 */
const ALL_SIDO = new Set<string>(Object.values(REGION_TO_SIDO).flat());

/**
 * 주소에서 시·군·구·읍·면·동 이름만 뽑습니다 — 응답의 `districts`에 씁니다.
 *
 * **시도 이름 목록을 따로 들지 않습니다.** 시도는 전부 `도`·`특별시`·`광역시`·
 * `특별자치시`로 끝나거나 짧은 형태(「경기」·「서울」)라, 아래 접미사 규칙만으로
 * 걸러집니다 — 목록을 또 만들면 시도 표와 어긋날 자리가 하나 더 생깁니다.
 *
 * 번지·건물번호(숫자 섞인 토큰)와 도로명(`…로`·`…길`)은 지역 이름이 아니라 뺍니다.
 */
export function extractDistrictNames(address: unknown): string[] {
  if (typeof address !== "string") return [];
  return address
    .trim()
    .split(/\s+/)
    .filter((t) => t !== "" && !/\d/.test(t))
    .filter((t) => /(시|군|구|읍|면|동)$/.test(t))
    .filter((t) => !/(특별시|광역시|특별자치시)$/.test(t));
}

function num(value: unknown, fallback: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `?categories=숲해설,산림치유` 형태를 배열로. 빈 값은 버립니다. */
function list(value: unknown): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map((v) => String(v).trim()).filter((v) => v !== "");
}

/** 날짜 문자열에 일수를 더합니다. KST 자정 기준이라 서머타임·시차 걱정이 없습니다. */
function addDays(date: string, days: number): string {
  return kstDateString(new Date(kstToInstant(date, "00:00").getTime() + days * DAY_MS));
}

/**
 * 기간 파라미터 정리 (17-2 · 17-6).
 *
 * **서버에서도 오늘~+90일, 최대 31일로 잘라냅니다** — 화면의 달력 제한만으로는
 * API 직접 호출을 막지 못합니다(17-6). 90일은 회차 요약(`scheduleDates`)이 담는
 * 범위와 같은 값이라, 그보다 먼 날짜를 받아줘도 어차피 판정할 데이터가 없습니다.
 */
function parsePeriod(
  query: Record<string, unknown>,
  now: Date
): { from: string | null; to: string | null } {
  const fromRaw = typeof query.from === "string" && query.from !== "" ? query.from : null;
  const toRaw = typeof query.to === "string" && query.to !== "" ? query.to : null;
  if (fromRaw == null && toRaw == null) return { from: null, to: null };

  const today = kstDateString(now);
  let from = fromRaw ?? today;
  let to = toRaw ?? from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new AppError("invalid-argument", "날짜 형식이 올바르지 않습니다");
  }
  if (to < from) [from, to] = [to, from];

  const windowEnd = kstDateString(new Date(now.getTime() + CALENDAR_WINDOW_DAYS * DAY_MS));
  if (from < today) from = today;
  if (to > windowEnd) to = windowEnd;
  // 전부 지난 기간이었으면 위 당김으로 from > to가 됩니다 — 오늘 하루로 접습니다.
  if (to < from) to = from;

  const cap = addDays(from, PERIOD_MAX_DAYS - 1);
  if (to > cap) to = cap;

  return { from, to };
}

export function parseSearchQuery(query: Record<string, unknown>, now = new Date()): SearchFilters {
  const categories = list(query.categories).filter((c) =>
    (PROGRAM_CATEGORIES as readonly string[]).includes(c)
  );

  const region = query.region == null || query.region === "" ? null : String(query.region);
  if (region != null && !(region in REGION_TO_SIDO)) {
    throw new AppError("invalid-argument", "알 수 없는 지역입니다");
  }

  const sidoRaw = query.sido == null || query.sido === "" ? null : String(query.sido);
  if (sidoRaw != null && !ALL_SIDO.has(sidoRaw)) {
    throw new AppError("invalid-argument", "알 수 없는 지역입니다");
  }

  // 지역 이름은 목록으로 검증하지 않습니다 — 전국 행정구역 목록을 서버에도 두면
  // 화면과 두 벌이 되고, 통합·신설이 있을 때 한쪽만 고쳐 「검색되던 지역이 갑자기
  // 안 되는」 상태가 됩니다. 길이만 자릅니다(주소 포함 검사라 위험이 없습니다).
  const localityRaw = typeof query.locality === "string" ? query.locality.trim() : "";

  const sortRaw = String(query.sort ?? "popular");
  const sort: SortKey = (["popular", "price_asc", "recent", "rating"] as const).includes(
    sortRaw as SortKey
  )
    ? (sortRaw as SortKey)
    : "popular";

  const headcountRaw = query.headcount;
  const headcount =
    headcountRaw == null || headcountRaw === "" ? null : Math.max(1, num(headcountRaw, 1));

  const keywordRaw = typeof query.keyword === "string" ? query.keyword.trim() : "";

  return {
    keyword: keywordRaw === "" ? null : keywordRaw.slice(0, 60),
    categories,
    region,
    sido: sidoRaw,
    locality: localityRaw === "" ? null : localityRaw.slice(0, 20),
    priceMin: Math.max(0, num(query.priceMin, 0)),
    priceMax: Math.min(PRICE_MAX, num(query.priceMax, PRICE_MAX)),
    headcount,
    ageTags: list(query.ageTags),
    difficulty:
      query.difficulty == null || query.difficulty === "" ? null : String(query.difficulty),
    barrierFree: query.barrierFree === "1" || query.barrierFree === "true",
    rainAlternative: query.rainAlternative === "1" || query.rainAlternative === "true",
    ...parsePeriod(query, now),
    sort,
    limit: Math.min(MAX_LIMIT, Math.max(1, num(query.limit, DEFAULT_LIMIT))),
  };
}

interface Candidate extends Record<string, unknown> {
  id: string;
}

/**
 * 지역 이름 — 주소에 그 이름이 들어 있는지 봅니다.
 *
 * **공백을 떼고 비교합니다.** 「부산진구」가 주소에 「부산진 구」로 저장될 일은
 * 없지만, 화면에서 넘어온 값에 공백이 섞이는 것은 막을 수 없습니다.
 */
function matchesLocality(program: Candidate, locality: string): boolean {
  const location = (program.location ?? {}) as { address?: string };
  if (typeof location.address !== "string") return false;
  const strip = (v: string) => v.replace(/\s+/g, "");
  return strip(location.address).includes(strip(locality));
}

function inRegion(sido: unknown, region: string): boolean {
  if (typeof sido !== "string") return false;
  const allowed = REGION_TO_SIDO[region] as readonly Sido[] | undefined;
  return allowed != null && allowed.includes(sido as Sido);
}

/**
 * 「N명이서 갈 수 있는가」 — **정원과 최소 인원을 함께 봅니다.**
 *
 * 최소 인원을 빠뜨리면 **혼자 신청해도 인원 미달로 자동 취소되는 프로그램**이
 * 「1인 가능」에 걸립니다(2-4). 참가자 입장에서 그건 예약이 된 것이 아닙니다.
 *
 * **남은 자리가 아니라 정원을 봅니다** — 남은 자리는 회차마다 달라 프로그램 단위
 * 필터로 성립하지 않습니다.
 */
function matchesHeadcount(program: Candidate, headcount: number): boolean {
  const capacity = (program.capacity as number) ?? 0;
  const minCapacity = (program.minCapacity as number) ?? 1;
  if (capacity < headcount) return false;
  if (minCapacity > headcount) return false;
  return true;
}

/**
 * 대상연령 — **「제한 없음(all)」은 어떤 연령을 골라도 포함합니다.**
 * 빼면 전연령 프로그램이 사라져 결과가 부자연스럽게 비어 보입니다(17-3).
 */
function matchesAge(program: Candidate, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const tags = (program.targetAgeTags as string[] | undefined) ?? [];
  if (tags.includes("all")) return true;
  return selected.some((tag) => tags.includes(tag));
}

/** 검색어 — 제목·소개·주소를 봅니다. 대소문자·공백만 정리합니다. */
function matchesKeyword(program: Candidate, keyword: string): boolean {
  const q = keyword.toLowerCase();
  const location = (program.location ?? {}) as { address?: string };
  return [program.title, program.description, location.address]
    .filter((v): v is string => typeof v === "string")
    .some((v) => v.toLowerCase().includes(q));
}

export function matchesFilters(program: Candidate, f: SearchFilters): boolean {
  if (f.keyword && !matchesKeyword(program, f.keyword)) return false;
  if (f.categories.length > 0 && !f.categories.includes(program.category as string)) {
    return false;
  }
  if (f.region && !inRegion(program.sido, f.region)) return false;
  if (f.sido && program.sido !== f.sido) return false;
  if (f.locality && !matchesLocality(program, f.locality)) return false;

  const price = (program.price as number) ?? 0;
  if (price < f.priceMin) return false;
  // 상한이 최대치면 「이상」이므로 위쪽을 막지 않습니다(17-3).
  if (f.priceMax < PRICE_MAX && price > f.priceMax) return false;

  if (f.headcount != null && !matchesHeadcount(program, f.headcount)) return false;
  if (!matchesAge(program, f.ageTags)) return false;
  if (f.difficulty && program.difficulty !== f.difficulty) return false;
  if (f.barrierFree && program.barrierFree !== true) return false;
  if (f.rainAlternative && ((program.rainAlternative as string) ?? "none") === "none") {
    return false;
  }
  if (f.from != null && f.to != null && !matchesPeriod(program, f.from, f.to)) return false;
  return true;
}

/**
 * 기간 — **회차 날짜 요약(`scheduleDates`)과의 교집합**으로 판정합니다(17-2 방법 C).
 * `nextScheduleAt <= 끝 && lastScheduleAt >= 시작` 같은 겹침 판정은 8/1과 9/30에만
 * 회차가 있는 프로그램이 8/20~8/25 검색에 잡혀서 쓰지 않습니다.
 *
 * **상시모집(`open`)은 예외로 포함합니다** — 회차가 없어 교집합으로는 전부 탈락하는데,
 * 실제로는 「그 기간에 협의가 가능한」 프로그램입니다. 문의 가능 기간이 선택 기간과
 * 겹치면 통과시키고, 화면이 「날짜 협의」임을 안내합니다(17-2).
 */
function matchesPeriod(program: Candidate, from: string, to: string): boolean {
  if (program.scheduleType === "open") {
    const af = program.availableFrom;
    const au = program.availableUntil;
    // 한쪽이 비어 있으면 그쪽은 제한이 없는 것으로 봅니다.
    if (typeof af === "string" && af > to) return false;
    if (typeof au === "string" && au < from) return false;
    return true;
  }
  const dates = (program.scheduleDates as string[] | undefined) ?? [];
  return dates.some((d) => d >= from && d <= to);
}

function toMillis(value: unknown): number {
  if (value == null) return 0;
  const ts = value as { toMillis?: () => number };
  return typeof ts.toMillis === "function" ? ts.toMillis() : 0;
}

/**
 * 정렬.
 *
 * **인기순은 `bookingCount30d`인데 그 값을 채우는 배치가 아직 없습니다**(5번의
 * `recalcProgramStats`). 전부 0이면 순서가 사실상 무작위가 되므로, 값이 없는 동안은
 * **게시 시각 역순으로 떨어지게** 했습니다 — 「인기순인데 순서가 매번 바뀌는」 것보다
 * 「최근 게시된 것이 위」가 덜 틀립니다. 배치가 생기면 이 폴백이 자동으로 안 쓰입니다.
 *
 * **평점순도 후기가 0건이면 같은 처지**라 뒤로 밀지 않고 게시 시각으로 갈라줍니다.
 */
function sortCandidates(rows: Candidate[], sort: SortKey): Candidate[] {
  const byPublished = (a: Candidate, b: Candidate) =>
    toMillis(b.publishedAt) - toMillis(a.publishedAt);

  const sorted = [...rows];
  switch (sort) {
    case "price_asc":
      sorted.sort(
        (a, b) => ((a.price as number) ?? 0) - ((b.price as number) ?? 0) || byPublished(a, b)
      );
      break;
    case "recent":
      sorted.sort(byPublished);
      break;
    case "rating":
      sorted.sort(
        (a, b) =>
          ((b.ratingAvg as number) ?? 0) - ((a.ratingAvg as number) ?? 0) || byPublished(a, b)
      );
      break;
    case "popular":
    default:
      sorted.sort(
        (a, b) =>
          ((b.bookingCount30d as number) ?? 0) - ((a.bookingCount30d as number) ?? 0) ||
          byPublished(a, b)
      );
      break;
  }
  return sorted;
}

/** 목록 카드가 쓰는 값만 내려보냅니다. 소개 블록·회차까지 실으면 응답이 커집니다. */
function toRow(program: Candidate): Record<string, unknown> {
  const location = (program.location ?? {}) as Record<string, unknown>;
  return {
    id: program.id,
    title: program.title,
    category: program.category,
    price: program.price,
    capacity: program.capacity,
    minCapacity: program.minCapacity,
    scheduleType: program.scheduleType,
    barrierFree: program.barrierFree === true,
    rainAlternative: program.rainAlternative ?? "none",
    difficulty: program.difficulty ?? null,
    sido: program.sido ?? null,
    targetAgeMin: program.targetAgeMin ?? null,
    targetAgeMax: program.targetAgeMax ?? null,
    targetAgeTags: program.targetAgeTags ?? [],
    walkingDistanceM: program.walkingDistanceM ?? null,
    ratingAvg: program.ratingAvg ?? 0,
    ratingCount: program.ratingCount ?? 0,
    scheduleDates: program.scheduleDates ?? [],
    // 목록 카드는 대표 사진 한 장만 씁니다(2-3 — 첫 장이 대표).
    imageUrls: ((program.imageUrls as string[] | undefined) ?? []).slice(0, 1),
    location: {
      address: location.address ?? "",
      lat: location.lat ?? null,
      lng: location.lng ?? null,
    },
  };
}

export interface SearchResult {
  programs: Array<Record<string, unknown>>;
  /** 필터를 통과한 전체 건수 (limit 적용 전) */
  total: number;
  /** 상한에 걸려 잘렸는지 — 조용히 자르면 「이게 전부」로 읽힙니다 */
  truncated: boolean;
  /**
   * 회차가 있는 날짜의 합집합 — 달력의 「회차 있는 날」 점(17-4 ④)에 씁니다.
   *
   * 설계상 출처는 `aggregates/scheduleCalendar`(17-5)인데 그 배치가 아직 없고,
   * 이 함수가 어차피 게시 프로그램 전체를 읽으므로 여기서 함께 만듭니다 —
   * 집계 문서를 도입하는 날 이 계산이 그쪽으로 옮겨갑니다.
   *
   * **필터와 무관한 전체 프로그램 기준**입니다(17-5의 알려진 한계) — 필터를 좁힌
   * 상태에서는 「점이 있는데 결과 0건」이 생길 수 있고, 그때는 안내 문구로 대응합니다.
   */
  calendarDates: string[];
  /**
   * **게시된 프로그램이 있는 지역** — 홈의 지역 칸 자동완성에 씁니다.
   *
   * 전국 행정구역 목록은 화면이 파일로 들고 있는데(`src/lib/districts.ts`), 그건
   * 시·군·구까지입니다. **읍·면·동은 전국을 넣으면 3,500개**가 되므로, 우리가
   * 실제로 프로그램을 가진 동 이름만 여기서 알려줍니다 — 이 함수가 어차피 게시
   * 프로그램 전체를 읽으므로 추가 비용이 없습니다(`calendarDates`와 같은 방식).
   *
   * `count`가 있어 화면이 **프로그램이 있는 지역을 위에 올릴 수** 있습니다.
   * 고른 지역에 프로그램이 없으면 결과가 0건인데, 그걸 미리 보여주는 편이 낫습니다.
   *
   * **필터와 무관한 전체 게시 프로그램 기준**입니다(`calendarDates`와 같은 한계).
   */
  districts: Array<{ sido: string; name: string; count: number }>;
}

export async function searchPrograms(
  db: Firestore,
  filters: SearchFilters
): Promise<SearchResult> {
  // ⚠️ status는 요청에서 받지 않습니다. 받으면 심사 중·반려 프로그램을 조회할 수
  //    있게 되고, 이 경로는 로그인 없이 호출됩니다(17-6).
  const snap = await db
    .collection("programs")
    .where("status", "==", "published")
    // 캐시가 없는 동안의 안전선입니다. 게시 프로그램이 이 수를 넘으면 집계 문서를
    // 도입할 시점이라는 신호이기도 합니다(17-1).
    .limit(500)
    .get();

  const candidates: Candidate[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
  }));

  const matched = candidates.filter((p) => matchesFilters(p, filters));
  const sorted = sortCandidates(matched, filters.sort);

  // 지난 날짜는 점에서 뺍니다 — 요약을 정리하는 배치(rebuildSearchIndex)가 아직 없어
  // 과거 날짜가 scheduleDates에 남아 있을 수 있습니다(17-2의 「날짜가 그냥 지남」).
  const today = kstDateString(new Date());
  const dateSet = new Set<string>();
  for (const p of candidates) {
    for (const d of (p.scheduleDates as string[] | undefined) ?? []) {
      if (typeof d === "string" && d >= today) dateSet.add(d);
    }
  }

  // 지역 이름 모으기 — 한 프로그램이 「수원시」·「팔달구」·「화서동」 셋에 함께
  // 들어갑니다(셋 다 유효한 검색어입니다).
  const districtCounts = new Map<string, { sido: string; name: string; count: number }>();
  for (const p of candidates) {
    const sido = typeof p.sido === "string" ? p.sido : null;
    if (sido == null) continue;
    const location = (p.location ?? {}) as { address?: string };
    for (const name of extractDistrictNames(location.address)) {
      const key = `${sido}|${name}`;
      const hit = districtCounts.get(key);
      if (hit) hit.count += 1;
      else districtCounts.set(key, { sido, name, count: 1 });
    }
  }

  return {
    programs: sorted.slice(0, filters.limit).map(toRow),
    total: matched.length,
    truncated: matched.length > filters.limit,
    calendarDates: [...dateSet].sort(),
    districts: [...districtCounts.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      // 응답이 커지지 않게 상한을 둡니다. 자동완성 후보라 전국 목록이 뒤를 받칩니다.
      .slice(0, 100),
  };
}
