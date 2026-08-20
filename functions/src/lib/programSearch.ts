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

/** 가격 상한. 이 값이면 「이상」이라 위쪽을 막지 않습니다(17-3). */
export const PRICE_MAX = 300_000;

/** 한 번에 돌려주는 최대 건수 */
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

export type SortKey = "popular" | "price_asc" | "recent" | "rating";

export interface SearchFilters {
  keyword: string | null;
  /** 빈 배열 = 전체 */
  categories: string[];
  /** null = 전국 */
  region: string | null;
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
  sort: SortKey;
  limit: number;
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

export function parseSearchQuery(query: Record<string, unknown>): SearchFilters {
  const categories = list(query.categories).filter((c) =>
    (PROGRAM_CATEGORIES as readonly string[]).includes(c)
  );

  const region = query.region == null || query.region === "" ? null : String(query.region);
  if (region != null && !(region in REGION_TO_SIDO)) {
    throw new AppError("invalid-argument", "알 수 없는 지역입니다");
  }

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
    priceMin: Math.max(0, num(query.priceMin, 0)),
    priceMax: Math.min(PRICE_MAX, num(query.priceMax, PRICE_MAX)),
    headcount,
    ageTags: list(query.ageTags),
    difficulty:
      query.difficulty == null || query.difficulty === "" ? null : String(query.difficulty),
    barrierFree: query.barrierFree === "1" || query.barrierFree === "true",
    rainAlternative: query.rainAlternative === "1" || query.rainAlternative === "true",
    sort,
    limit: Math.min(MAX_LIMIT, Math.max(1, num(query.limit, DEFAULT_LIMIT))),
  };
}

interface Candidate extends Record<string, unknown> {
  id: string;
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
  return true;
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

  return {
    programs: sorted.slice(0, filters.limit).map(toRow),
    total: matched.length,
    truncated: matched.length > filters.limit,
  };
}
