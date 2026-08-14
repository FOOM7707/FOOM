/**
 * `programs` 파생 필드 산출 (스키마 2-3, 17-7).
 *
 * 여기서 만드는 값은 전부 **다른 필드에서 계산한 사본**입니다. 공급자가 직접
 * 입력하지 않고, 보안규칙 허용목록에도 없어 클라이언트가 쓰면 수정 전체가
 * 거부됩니다. 원본과 사본이 어긋나면 **원본이 기준**이고 사본을 다시 계산합니다.
 *
 * 산출식을 한 곳에 모으는 이유: 등록·수정·심사 승인 세 경로가 같은 값을 계산해야
 * 하는데, 흩어놓으면 경로마다 경계가 미묘하게 달라집니다(17-7).
 */

import { extractSido, type Sido } from "./sido";

export type Difficulty = "easy" | "normal" | "hard";
export type TargetAgeTag = "all" | "infant" | "child" | "teen" | "adult" | "senior";

/** 2-3 산출 기준표. 여기를 고치면 기존 문서는 자동으로 안 바뀌므로 백필이 필요합니다. */
const AGE_TAG_RANGES: ReadonlyArray<readonly [Exclude<TargetAgeTag, "all">, number, number]> = [
  ["infant", 0, 6],
  ["child", 7, 12],
  ["teen", 13, 18],
  ["adult", 19, 64],
  ["senior", 65, 120],
];

/**
 * 난이도 — **전적으로 `walkingDistanceM`에서 나옵니다**(v13 정정).
 * 공급자가 직접 고르지 않습니다. 값이 없으면 "거의 걷지 않는 프로그램"이므로
 * `easy`가 맞습니다(실내 명상·유아 놀이 등).
 *
 * 경계는 필터 라벨과 같습니다 — 쉬움 1km 이하 / 보통 1~3km / 어려움 3km 이상(17-3).
 */
export function deriveDifficulty(walkingDistanceM: number | null | undefined): Difficulty {
  if (walkingDistanceM == null || walkingDistanceM <= 1000) return "easy";
  if (walkingDistanceM <= 3000) return "normal";
  return "hard";
}

/**
 * 연령 태그 — 프로그램 구간과 태그 구간이 **한 살이라도 겹치면** 붙입니다(양끝 포함).
 *
 * **둘 다 null인 경우에만 `['all']`**이고 이때 다른 태그는 붙이지 않습니다.
 * `all`을 다른 태그와 함께 붙이면 연령 필터가 아무것도 걸러내지 못합니다(2-3).
 */
export function deriveTargetAgeTags(
  targetAgeMin: number | null | undefined,
  targetAgeMax: number | null | undefined
): TargetAgeTag[] {
  const minIsNull = targetAgeMin == null;
  const maxIsNull = targetAgeMax == null;

  if (minIsNull && maxIsNull) return ["all"];

  const min = minIsNull ? 0 : targetAgeMin;
  const max = maxIsNull ? 120 : targetAgeMax;

  const tags = AGE_TAG_RANGES.filter(([, lo, hi]) => min <= hi && max >= lo).map(
    ([tag]) => tag
  );

  // 구간이 뒤집혔거나 범위 밖이면 겹치는 태그가 없을 수 있습니다.
  // 태그가 비면 그 프로그램은 어떤 연령 필터에도 안 걸려 검색에서 사라집니다.
  return tags.length > 0 ? tags : ["all"];
}

/**
 * 예약 시 아동 정보를 필수로 받을지 (15-6의 판별 근거).
 * 산출식: `targetAgeMax != null && targetAgeMax <= 13` 이거나 `category == '유아숲체험'`.
 */
export function deriveRequiresChildInfo(
  targetAgeMax: number | null | undefined,
  category: string
): boolean {
  if (category === "유아숲체험") return true;
  return targetAgeMax != null && targetAgeMax <= 13;
}

export interface DerivedProgramFields {
  targetAgeTags: TargetAgeTag[];
  difficulty: Difficulty;
  sido: Sido;
  requiresChildInfo: boolean;
}

export interface DeriveInput {
  category: string;
  address: string;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
  walkingDistanceM: number | null;
}

/**
 * 등록·수정·심사 승인이 전부 이 함수를 씁니다.
 *
 * 주소에서 시도를 못 뽑으면 **예외를 던집니다** — 빈 값으로 저장하면 그 프로그램은
 * 지역 필터에서 영구히 누락되는데 화면상으로는 정상 등록된 것처럼 보입니다(4번).
 */
export function deriveProgramFields(input: DeriveInput): DerivedProgramFields {
  const sido = extractSido(input.address);
  if (!sido) {
    throw new Error(
      `주소에서 시도를 인식하지 못했습니다: "${input.address}". ` +
        `"강원도 홍천군 서면"처럼 시도로 시작하는 주소를 입력해 주세요.`
    );
  }

  return {
    targetAgeTags: deriveTargetAgeTags(input.targetAgeMin, input.targetAgeMax),
    difficulty: deriveDifficulty(input.walkingDistanceM),
    sido,
    requiresChildInfo: deriveRequiresChildInfo(input.targetAgeMax, input.category),
  };
}
