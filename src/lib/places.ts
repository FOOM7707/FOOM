/**
 * 주소·장소 검색 (스키마 5번 「외부 연동」 · 16-4).
 *
 * 카카오를 브라우저에서 직접 부르지 않고 서버(`GET /external/kakao-map/search`)를
 * 거칩니다 — 이 검색에 쓰는 **REST API 키에는 도메인 제한이 없어서** 프론트에 두면
 * 그대로 남의 쿼터로 쓰입니다. 지도 SDK가 쓰는 JavaScript 키와는 성격이 다릅니다.
 */

import { apiFetch } from "./api";

export interface Place {
  /** 저장·표시용 주소(지번). `programs.location.address`에 그대로 들어갑니다 */
  address: string;
  roadAddress: string | null;
  /** 장소명 — 키워드로 찾았을 때만 있습니다 */
  placeName: string | null;
  lat: number;
  lng: number;
  /**
   * 시도 코드. **null이면 이 주소로는 등록할 수 없습니다** — 서버가 거부합니다(4번).
   * 화면에서 선택을 막고 이유를 알려줍니다.
   */
  sido: string | null;
}

export interface PlaceSearchResult {
  places: Place[];
  source: "address" | "keyword" | "none";
  /** 상한에 걸려 잘렸는지 — 조용히 자르면 "이게 전부"로 읽힙니다 */
  truncated: boolean;
}

export function searchPlaces(query: string): Promise<PlaceSearchResult> {
  return apiFetch<PlaceSearchResult>(
    `/external/kakao-map/search?query=${encodeURIComponent(query)}`,
    { requireAuth: true }
  );
}
