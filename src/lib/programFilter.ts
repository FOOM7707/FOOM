import { CATEGORIES, type Difficulty, type Sido, type TargetAgeTag } from "@/types/firestore";
import { REGION_KEYS, type RegionKey } from "@/lib/sido";
import { SIDO_LABEL } from "@/lib/districts";

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
/**
 * 홈의 지역 칸에서 고른 곳 — 권역(`ProgramFilters.region`)보다 좁습니다.
 *
 * **필터 모델에 넣지 않았습니다.** 상세 필터 모달은 권역 단위로 고르는 화면이고,
 * 여기에 시도·지역 이름을 섞으면 「모달에서 경상을 골랐는데 사상구가 함께 걸린」
 * 상태를 화면에 표현할 방법이 없어집니다. 검색 화면이 따로 들고 다니며 칩으로
 * 보여주고, 칩을 지우면 사라집니다.
 */
export interface PlaceFilter {
  /** 시도 코드 */
  sido: string;
  /** 시·군·구·읍·면·동 이름. null이면 시도 전체 */
  locality: string | null;
  /** 화면에 보여줄 이름 — 「부산 사상구」 */
  label: string;
}

export function toSearchQuery(
  filters: ProgramFilters,
  sort: SortKey,
  keyword: string,
  place?: PlaceFilter | null
): string {
  const q = new URLSearchParams();
  const trimmed = keyword.trim();
  if (trimmed !== "") q.set("keyword", trimmed);
  if (filters.categories.length > 0) q.set("categories", filters.categories.join(","));
  if (filters.region) q.set("region", filters.region);
  if (place) {
    q.set("sido", place.sido);
    if (place.locality) q.set("locality", place.locality);
  }
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
  /** (20-6) 목록 카드용 작은 사진. 비어 있을 수 있어 `cardImageUrl()`로 읽습니다 */
  thumbUrls?: string[];
  location: { address: string; lat: number | null; lng: number | null };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 주소(URL) ↔ 화면 조건
 *
 * **주소가 원본입니다**(17-4 ⑤). 화면이 조건을 따로 기억하지 않습니다.
 *
 * 왜 이렇게 두는가 — 헤더의 「프로그램 찾기」↔「지도로 찾기」와 푸터의 카테고리
 * 링크는 **같은 화면 안에서 주소만 바꿉니다**(화면을 새로 만들지 않습니다).
 * 화면이 조건을 자기 안에 기억하면 그때 주소를 다시 읽지 않아, **주소와 헤더
 * 강조는 바뀌었는데 목록은 그대로**가 됩니다. 실제로 그 고장이 있었습니다.
 *
 * ⚠️ 17-4 ⑤의 예시 주소는 `price=0-50000`·`age=`·`level=`·`bf=`처럼 짧은 이름을
 *    쓰지만, 여기서는 **검색 API에 보내는 이름과 같은 이름**을 씁니다
 *    (`priceMin`·`ageTags`·`difficulty`·`barrierFree`). 이름이 두 벌이면 옮겨 적는
 *    자리가 생기고 한쪽만 고치는 사고가 납니다. 홈·헤더·푸터가 이미 쓰고 있는
 *    `category`·`region`·`headcount`·`from`·`to`·`sido`·`locality`·`q`·`view`는
 *    그대로 둡니다 — 바꾸면 그 링크들이 조용히 무시됩니다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 찾기 화면이 다루는 조건 한 벌 */
export interface SearchScreenState {
  filters: ProgramFilters;
  place: PlaceFilter | null;
  sort: SortKey;
  view: "list" | "map";
  keyword: string;
}

/**
 * 정렬 ↔ 주소 값.
 *
 * **서버로 보내는 값(`SORT_TO_SERVER`)과 다릅니다** — 「가까운거리순」은 서버가
 * 판단할 수 없어 인기순으로 받아 화면이 다시 정렬하는데, 주소에까지 `popular`로
 * 적으면 링크를 열었을 때 정렬이 인기순으로 바뀝니다.
 */
const SORT_TO_URL: Record<SortKey, string> = {
  인기순: "popular",
  낮은가격순: "price_asc",
  평점순: "rating",
  가까운거리순: "near",
};

const URL_TO_SORT: Record<string, SortKey> = Object.fromEntries(
  Object.entries(SORT_TO_URL).map(([key, value]) => [value, key as SortKey])
) as Record<string, SortKey>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AGE_TAG_VALUES = new Set<string>(AGE_TAG_LABELS.map((a) => a.value));
const DIFFICULTY_VALUES = new Set<string>(DIFFICULTY_LABELS.map((d) => d.value));
/** 「전체」는 UI 전용 값이라 주소에 적지 않습니다(4번 enum 주석과 같은 규칙) */
const CATEGORY_VALUES = new Set<string>(CATEGORIES.filter((c) => c !== "전체"));

/** 정수만 받습니다. 값이 없거나 숫자가 아니면 null — 주소는 손으로 고칠 수 있습니다 */
function intOrNull(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

/**
 * 주소 → 화면 조건.
 *
 * **모르는 값은 조용히 무시하고 기본값으로 떨어집니다.** 주소는 손으로 고칠 수
 * 있고 옛 링크도 남아 있어서, 오류로 처리하면 화면이 열리지 않습니다.
 */
export function parseSearchScreenParams(params: URLSearchParams): SearchScreenState {
  const from = (() => {
    const raw = params.get("from");
    return raw != null && DATE_RE.test(raw) ? raw : null;
  })();
  const to = (() => {
    if (from == null) return null;
    const raw = params.get("to");
    return raw != null && DATE_RE.test(raw) ? raw : null;
  })();

  const regionRaw = params.get("region");
  const region = (REGION_KEYS as string[]).includes(regionRaw ?? "")
    ? (regionRaw as ProgramFilters["region"])
    : null;

  // 가격은 범위가 뒤집히면(min > max) 결과가 영원히 0건인데 화면에는 이유가
  // 보이지 않습니다 — 그런 조합은 기본값으로 되돌립니다.
  const minRaw = intOrNull(params.get("priceMin"));
  const maxRaw = intOrNull(params.get("priceMax"));
  const priceMin = minRaw != null && minRaw >= 0 && minRaw <= PRICE_MAX ? minRaw : 0;
  const priceMaxCandidate =
    maxRaw != null && maxRaw >= 0 && maxRaw <= PRICE_MAX ? maxRaw : PRICE_MAX;
  const priceMax = priceMaxCandidate >= priceMin ? priceMaxCandidate : PRICE_MAX;

  const headcountRaw = intOrNull(params.get("headcount"));
  const difficultyRaw = params.get("difficulty");

  const place: PlaceFilter | null = (() => {
    const sido = params.get("sido");
    if (sido == null || SIDO_LABEL[sido as Sido] == null) return null;
    const short = SIDO_LABEL[sido as Sido];
    const localityRaw = params.get("locality");
    const locality =
      localityRaw != null && localityRaw.trim() !== "" ? localityRaw.trim() : null;
    return { sido, locality, label: locality ? `${short} ${locality}` : short };
  })();

  return {
    filters: {
      ...DEFAULT_FILTERS,
      categories: (params.get("category") ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => CATEGORY_VALUES.has(c)),
      region,
      priceMin,
      priceMax,
      headcount: headcountRaw != null && headcountRaw > 0 ? headcountRaw : null,
      ageTags: (params.get("ageTags") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => AGE_TAG_VALUES.has(t)) as ProgramFilters["ageTags"],
      difficulty:
        difficultyRaw != null && DIFFICULTY_VALUES.has(difficultyRaw)
          ? (difficultyRaw as ProgramFilters["difficulty"])
          : null,
      barrierFree: params.get("barrierFree") === "1",
      rainAlternative: params.get("rainAlternative") === "1",
      from,
      to,
    },
    place,
    sort: URL_TO_SORT[params.get("sort") ?? ""] ?? "인기순",
    view: params.get("view") === "map" ? "map" : "list",
    keyword: params.get("q") ?? "",
  };
}

/**
 * 화면 조건 → 주소.
 *
 * **기본값은 적지 않습니다** — 주소가 짧아지고, 「아무 조건도 안 건 상태」가
 * 주소에서도 한눈에 보입니다.
 */
export function toScreenParams(state: SearchScreenState): URLSearchParams {
  const p = new URLSearchParams();
  const { filters: f } = state;

  const keyword = state.keyword.trim();
  if (keyword !== "") p.set("q", keyword);
  if (f.categories.length > 0) p.set("category", f.categories.join(","));
  if (state.place) {
    p.set("sido", state.place.sido);
    if (state.place.locality) p.set("locality", state.place.locality);
  }
  if (f.region) p.set("region", f.region);
  if (f.priceMin > 0) p.set("priceMin", String(f.priceMin));
  if (f.priceMax < PRICE_MAX) p.set("priceMax", String(f.priceMax));
  if (f.headcount != null) p.set("headcount", String(f.headcount));
  if (f.ageTags.length > 0) p.set("ageTags", f.ageTags.join(","));
  if (f.difficulty) p.set("difficulty", f.difficulty);
  if (f.barrierFree) p.set("barrierFree", "1");
  if (f.rainAlternative) p.set("rainAlternative", "1");
  if (f.from) {
    p.set("from", f.from);
    // 시작만 고른 상태는 그 하루로 봅니다 — 서버 판정·검색 쿼리와 같은 규칙입니다.
    p.set("to", f.to ?? f.from);
  }
  if (state.sort !== "인기순") p.set("sort", SORT_TO_URL[state.sort]);
  if (state.view === "map") p.set("view", "map");

  return p;
}
