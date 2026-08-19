import type { Sido } from "@/types/firestore";

/**
 * 지역 필터의 권역 ↔ 시도 매핑 (스키마 4번 매핑표 · 17-3).
 *
 * **저장은 17개 시도, 화면은 권역 단위**입니다. 권역으로 저장하면 나중에 구분을
 * 바꿀 때 원본이 사라집니다. 화면이 권역을 고르면 시도 목록으로 펼쳐 판정합니다.
 *
 * ⚠️ **이 표는 서버(`functions/src/lib/sido.ts`)의 사본입니다.** 검색이 아직
 * `GET /programs/search`를 거치지 않고 mock을 프론트에서 거르기 때문에 임시로 둡니다.
 * 검색 API를 붙이면 판정은 서버로 넘어가고 여기에는 라벨만 남습니다 — 그때까지
 * **한쪽만 고치면 결과가 갈립니다.**
 *
 * 문서 17-3은 「8개 권역」이라 적혀 있는데 4번 매핑표는 7개입니다. 17개 시도를
 * 빠짐없이 덮고 있어 기능 영향은 없고 숫자만 안 맞습니다 — 미결정 사항이라
 * 임의로 고치지 않고 매핑표(7개)를 그대로 따릅니다.
 */
export const REGION_TO_SIDO = {
  서울: ["seoul"],
  "경기·인천": ["gyeonggi", "incheon"],
  강원: ["gangwon"],
  충청: ["chungbuk", "chungnam", "daejeon", "sejong"],
  전라: ["jeonbuk", "jeonnam", "gwangju"],
  경상: ["gyeongbuk", "gyeongnam", "busan", "daegu", "ulsan"],
  제주: ["jeju"],
} as const satisfies Record<string, readonly Sido[]>;

export type RegionKey = keyof typeof REGION_TO_SIDO;

export const REGION_KEYS = Object.keys(REGION_TO_SIDO) as RegionKey[];

/** 프로그램의 시도가 고른 권역에 속하는지 */
export function isInRegion(sido: Sido | undefined, region: RegionKey): boolean {
  if (!sido) return false;
  return (REGION_TO_SIDO[region] as readonly Sido[]).includes(sido);
}
