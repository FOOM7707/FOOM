/**
 * 직접 입력한 지역 이름을 권역으로 맞춥니다 — 홈의 통합 검색이 씁니다 (2026-08-27).
 *
 * 지역 칸을 목록에서만 고르게 두면 「인천」·「부산」처럼 **머릿속에 있는 이름**을
 * 그대로 칠 수 없습니다. 저장·판정 단위는 그대로 7개 권역이고(`sido.ts`), 이 파일은
 * **입력한 글자를 그 권역으로 옮기는 일만** 합니다 — 판정 규칙을 늘리지 않습니다.
 *
 * 맞는 권역이 없으면 null을 돌려줍니다. 그때는 홈이 그 글자를 **검색어로** 넘깁니다
 * (「양평」처럼 권역이 아닌 지명이 그렇습니다) — 조용히 버리면 고른 조건이 무시된
 * 채로 전체 결과가 나와서, 왜 안 걸렸는지 알 방법이 없습니다.
 */

import { REGION_KEYS, type RegionKey } from "@/lib/sido";

/**
 * 사람들이 실제로 치는 이름 → 권역.
 *
 * **17개 시도 이름을 모두 넣습니다.** 권역 이름(「충청」)만 받으면 「충남」이라고 친
 * 사람에게는 목록에 없는 지역이 됩니다. 광역시 이름도 마찬가지입니다.
 */
const ALIASES: Record<string, RegionKey> = {
  서울: "서울",
  서울특별시: "서울",

  경기: "경기·인천",
  경기도: "경기·인천",
  인천: "경기·인천",
  수도권: "경기·인천",

  강원: "강원",
  강원도: "강원",
  강원특별자치도: "강원",

  충청: "충청",
  충북: "충청",
  충청북도: "충청",
  충남: "충청",
  충청남도: "충청",
  대전: "충청",
  세종: "충청",

  전라: "전라",
  전북: "전라",
  전라북도: "전라",
  전남: "전라",
  전라남도: "전라",
  광주: "전라",

  경상: "경상",
  경북: "경상",
  경상북도: "경상",
  경남: "경상",
  경상남도: "경상",
  부산: "경상",
  대구: "경상",
  울산: "경상",

  제주: "제주",
  제주도: "제주",
  제주특별자치도: "제주",
};

/** 공백·구분점을 떼고 비교합니다 — 「경기 인천」·「경기/인천」도 같은 값입니다 */
function normalize(text: string): string {
  return text.replace(/[\s·/,]/g, "");
}

/**
 * 입력한 글자에 맞는 권역. 없으면 null.
 *
 * ① 권역 이름과 같으면 그것 ② 별칭 표와 같으면 그것 ③ 「부산광역시」처럼 별칭으로
 * 시작하면 그것 ④ 두 글자 이상이면 별칭의 앞부분과 맞춰봅니다(「충청남」 → 충청).
 *
 * ④에서 **두 글자 이상만** 보는 이유: 「대」 한 글자는 대전과 대구 둘에 걸려서,
 * 하나를 골라 넣으면 고르지 않은 지역이 조용히 걸립니다.
 */
export function matchRegion(text: string): RegionKey | null {
  const key = normalize(text);
  if (key === "") return null;

  const exactRegion = REGION_KEYS.find((r) => normalize(r) === key);
  if (exactRegion) return exactRegion;

  if (ALIASES[key]) return ALIASES[key];

  const names = Object.keys(ALIASES);
  const startsWithAlias = names.find((n) => key.startsWith(n));
  if (startsWithAlias) return ALIASES[startsWithAlias];

  if (key.length >= 2) {
    const aliasStartsWith = names.find((n) => n.startsWith(key));
    if (aliasStartsWith) return ALIASES[aliasStartsWith];
  }

  return null;
}

/** 입력한 글자에 맞춰 좁힌 권역 목록 — 아무것도 안 쳤으면 전체 */
export function suggestRegions(text: string): RegionKey[] {
  const key = normalize(text);
  if (key === "") return [...REGION_KEYS];

  const matched = matchRegion(text);
  const narrowed = REGION_KEYS.filter(
    (r) => normalize(r).includes(key) || r === matched
  );
  // 맞는 것이 없으면 목록을 비우지 않고 전체를 보여줍니다 — 목록이 사라지면
  // 「고를 수 있는 곳」이 화면에서 없어져 검색을 포기하게 됩니다.
  return narrowed.length > 0 ? narrowed : [...REGION_KEYS];
}
