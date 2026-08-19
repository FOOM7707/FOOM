import type { Difficulty, Program, TargetAgeTag } from "@/types/firestore";
import { isInRegion, type RegionKey } from "@/lib/sido";

/**
 * 검색 필터 판정 (스키마 17-3).
 *
 * 화면(모달)과 떼어 순수 함수로 둡니다 — UI를 바꿔도 판정은 그대로여야 하고,
 * 나중에 `GET /programs/search`가 생기면 **이 규칙이 서버로 옮겨갑니다**(17-1).
 * 그때 대조할 원본이 한 곳에 있어야 합니다.
 *
 * ⚠️ 지금은 mock을 프론트에서 거르는 임시 구현입니다. 실제 검색은 Firestore를
 * 직접 쿼리하지 않습니다 — 논리합 30개 제한 때문에 카테고리 다중선택 × 연령
 * 다중선택만으로 상한에 닿습니다(17-1).
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
 * 「N명이서 갈 수 있는가」 — **두 가지를 함께 봅니다.**
 *
 * | 필드 | 뜻 | 빠뜨리면 |
 * |---|---|---|
 * | `capacity` | 회차당 최대 정원 | 정원 8명짜리에 20명이 걸립니다 |
 * | `minCapacity` | 최소 진행 인원 | **혼자 신청해도 인원 미달로 자동 취소되는 프로그램**이 「1인 가능」에 걸립니다(2-4) |
 *
 * 두 번째가 핵심입니다. 정원만 보면 「혼자 가도 되는 프로그램」을 고를 수 없습니다 —
 * 최소 인원이 4명이면 혼자 신청은 받아주지만 D-1에 인원이 안 차면 폐강됩니다.
 * 참가자 입장에서 그건 "예약이 된 것"이 아닙니다.
 *
 * **남은 자리(`remainingSlots`)가 아니라 정원을 봅니다.** 남은 자리는 회차마다
 * 달라서 프로그램 단위 필터로는 성립하지 않습니다.
 */
export function matchesHeadcount(program: Program, headcount: number): boolean {
  if (program.capacity < headcount) return false;
  if (program.minCapacity > headcount) return false;
  return true;
}

function matchesAge(program: Program, selected: TargetAgeTag[]): boolean {
  if (selected.length === 0) return true;
  const tags = program.targetAgeTags ?? [];
  // 「제한 없음(all)」은 어떤 연령을 골라도 항상 포함합니다 — 빼면 전연령
  // 프로그램이 사라져 결과가 부자연스럽게 비어 보입니다(17-3).
  if (tags.includes("all")) return true;
  return selected.some((tag) => tags.includes(tag));
}

export function matchesFilters(program: Program, f: ProgramFilters): boolean {
  if (f.categories.length > 0 && !f.categories.includes(program.category)) return false;
  if (f.region && !isInRegion(program.sido, f.region)) return false;

  if (program.price < f.priceMin) return false;
  // 상한이 최대치면 "이상"이므로 위쪽을 막지 않습니다.
  if (f.priceMax < PRICE_MAX && program.price > f.priceMax) return false;

  if (f.headcount != null && !matchesHeadcount(program, f.headcount)) return false;
  if (!matchesAge(program, f.ageTags)) return false;
  if (f.difficulty && program.difficulty !== f.difficulty) return false;
  if (f.barrierFree && !program.barrierFree) return false;
  if (f.rainAlternative && (program.rainAlternative ?? "none") === "none") return false;

  return true;
}

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
  return n;
}
