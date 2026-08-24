import type { Difficulty, TargetAgeTag } from "@/types/firestore";
import type { RegionKey } from "@/lib/sido";

/**
 * 검색 필터 — **화면 표시용 값과 쿼리 만들기만** 남아 있습니다 (스키마 17-3).
 *
 * **판정은 서버가 합니다(v28).** `GET /programs/search`가 걸러 내려주고, 규칙 원본은
 * `functions/src/lib/programSearch.ts`입니다 — 17-1이 예고한 이동입니다.
 * 프론트에서 Firestore를 직접 쿼리하지 않는 이유(논리합 30개 제한)도 거기 적혀 있습니다.
 */

/** 가격 상한. 이 값이면 "이상"으로 보고 위쪽을 열어둡니다(17-3) */
export const PRICE_MAX = 300_000;

export interface ProgramFilters {
  /** 빈 배열 = 전체. 「전체」는 배타적이라 값이 아니라 빈 배열로 표현합니다 */
  categories: string[];
  /** null = 전국 */
  region: RegionKey | null;
  priceMin: number;
  priceMax: number;
  /** 함께 가는 인원. null = 상관없음. 판정은 `matchesHeadcount` 참고 */
  headcount: number | null;
  /** 빈 배열 = 전체 */
  ageTags: TargetAgeTag[];
  /** null = 전체 */
  difficulty: Difficulty | null;
  barrierFree: boolean;
  /** 우천 시 대체 방식이 있는 프로그램만 (`rainAlternative != 'none'`) */
  rainAlternative: boolean;
  /** 기간 시작 `YYYY-MM-DD`. null = 기간 필터 없음 (17-2) */
  from: string | null;
  /** 기간 끝. 시작만 고른 상태면 null이고, 서버에는 시작 하루로 보냅니다 */
  to: string | null;
}

export const DEFAULT_FILTERS: ProgramFilters = {
  categories: [],
  region: null,
  priceMin: 0,
  priceMax: PRICE_MAX,
  headcount: null,
  ageTags: [],
  difficulty: null,
  barrierFree: false,
  rainAlternative: false,
  from: null,
  to: null,
};

export const AGE_TAG_LABELS: { value: TargetAgeTag; label: string }[] = [
  { value: "infant", label: "유아 (0~6세)" },
  { value: "child", label: "어린이 (7~12세)" },
  { value: "teen", label: "청소년 (13~18세)" },
  { value: "adult", label: "성인 (19~64세)" },
  { value: "senior", label: "시니어 (65세~)" },
];

/** 라벨에 기준을 함께 노출합니다 — 난이도는 보행거리에서 나온 값입니다(17-3) */
export const DIFFICULTY_LABELS: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "쉬움 · 1km 이하" },
  { value: "normal", label: "보통 · 1~3km" },
  { value: "hard", label: "어려움 · 3km 이상" },
];

export const HEADCOUNT_OPTIONS = [1, 2, 4, 10, 20] as const;

/**
 * ⚠️ **필터 판정은 서버로 옮겼습니다(v28).** `matchesFilters`·`matchesHeadcount`가
 * 여기 있었는데, 이제 `functions/src/lib/programSearch.ts`가 기준입니다 —
 * `GET /programs/search`가 그 규칙으로 걸러 내려줍니다(17-1의 예정된 이동).
 *
 * **두 벌로 두지 않는 이유:** 판정이 양쪽에 있으면 어느 쪽이 맞는지 알 수 없고,
 * 「화면에는 보이는데 서버 결과에는 없는」 프로그램이 생깁니다. 모달의
 * 「N개 결과 보기」 숫자도 서버가 돌려준 `total`을 씁니다.
 *
 * 여기 남은 것은 **화면 표시에만 쓰이는 값**입니다 — 라벨, 기본값, 손댄 항목 수.
 */

/**
 * 모달 안에서 손댄 항목 수. 필터 버튼의 배지에 씁니다.
 * **카테고리는 세지 않습니다** — 칩이 모달 밖에 있어 눈에 이미 보입니다.
 */
export function countActiveFilters(f: ProgramFilters): number {
  let n = 0;
  if (f.region) n += 1;
  if (f.priceMin > 0 || f.priceMax < PRICE_MAX) n += 1;
  if (f.headcount != null) n += 1;
  if (f.ageTags.length > 0) n += 1;
  if (f.difficulty) n += 1;
  if (f.barrierFree) n += 1;
  if (f.rainAlternative) n += 1;
  if (f.from) n += 1;
  return n;
}

export type SortKey = "인기순" | "낮은가격순" | "가까운거리순" | "평점순";

/** 화면 정렬 이름 → 서버 값. 「가까운거리순」은 현재위치가 필요해 화면이 직접 합니다. */
const SORT_TO_SERVER: Record<SortKey, string> = {
  인기순: "popular",
  낮은가격순: "price_asc",
  평점순: "rating",
  // 서버는 사용자의 위치를 모릅니다. 후보를 받아 화면에서 거리로 다시 정렬합니다.
  가까운거리순: "popular",
};

/**
 * 검색 API에 보낼 쿼리 문자열.
 *
 * **기본값은 보내지 않습니다** — 주소창과 요청이 짧아지고, 서버 기본값과 어긋날
 * 여지도 줄어듭니다.
 */
export function toSearchQuery(
  filters: ProgramFilters,
  sort: SortKey,
  keyword: string
): string {
  const q = new URLSearchParams();
  const trimmed = keyword.trim();
  if (trimmed !== "") q.set("keyword", trimmed);
  if (filters.categories.length > 0) q.set("categories", filters.categories.join(","));
  if (filters.region) q.set("region", filters.region);
  if (filters.priceMin > 0) q.set("priceMin", String(filters.priceMin));
  if (filters.priceMax < PRICE_MAX) q.set("priceMax", String(filters.priceMax));
  if (filters.headcount != null) q.set("headcount", String(filters.headcount));
  if (filters.ageTags.length > 0) q.set("ageTags", filters.ageTags.join(","));
  if (filters.difficulty) q.set("difficulty", filters.difficulty);
  if (filters.barrierFree) q.set("barrierFree", "1");
  if (filters.rainAlternative) q.set("rainAlternative", "1");
  if (filters.from) {
    q.set("from", filters.from);
    // 시작만 고른 상태로 적용하면 그 하루로 봅니다 — 서버 판정과 같은 규칙입니다.
    q.set("to", filters.to ?? filters.from);
  }
  q.set("sort", SORT_TO_SERVER[sort]);
  return q.toString();
}

/** 검색 결과 한 줄 — 서버가 목록 카드에 필요한 값만 내려줍니다(`toRow`). */
export interface SearchRow {
  id: string;
  title: string;
  category: string;
  price: number;
  capacity: number;
  minCapacity: number;
  scheduleType: string;
  barrierFree: boolean;
  rainAlternative: string;
  difficulty: string | null;
  sido: string | null;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
  targetAgeTags: string[];
  walkingDistanceM: number | null;
  ratingAvg: number;
  ratingCount: number;
  scheduleDates: string[];
  imageUrls: string[];
  location: { address: string; lat: number | null; lng: number | null };
}
