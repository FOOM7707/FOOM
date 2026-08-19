// 위치 기반 유틸 (프로토타입)
//
// TODO(백엔드 연동): 실제 서비스에서는 반경 검색을 프론트에서 계산하지 않습니다.
// 스키마 문서 7-1 "지오쿼리" 참고 — Firestore에 geohash를 저장해두고
// geofire-common으로 후보를 좁혀서 받아온 뒤, 화면 표시만 지도 SDK가 담당합니다.
// 아래 계산식은 mock 데이터가 전부 클라이언트에 있는 프로토타입 단계용입니다.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** 두 좌표 사이 직선거리(km) — 하버사인 공식 */
export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** 거리 표기 — 1km 미만은 m 단위 */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

/**
 * @deprecated 지역 **필터**는 이제 `programs.sido` 코드로 판정합니다(17-3, `lib/sido.ts`).
 * 이 목록과 아래 `regionOfAddress`는 상세 화면의 **표시용 라벨**로만 남아 있습니다 —
 * 주소 문자열 파싱은 "경기도 광주시"를 광주광역시로 읽는 식의 오분류가 있어
 * 걸러내는 데 쓰면 안 됩니다.
 */
export const REGIONS = [
  "전체지역",
  "서울",
  "경기",
  "인천",
  "강원",
  "충청",
  "전라",
  "경상",
  "제주",
] as const;

export type Region = (typeof REGIONS)[number];

/**
 * 주소 문자열에서 광역 지역을 추정합니다.
 * TODO(연동): 카카오 로컬 API의 주소 검색 응답(region_1depth_name)으로 대체.
 */
export function regionOfAddress(address: string): Region {
  if (address.startsWith("서울")) return "서울";
  if (address.startsWith("경기")) return "경기";
  if (address.startsWith("인천")) return "인천";
  if (address.startsWith("강원")) return "강원";
  if (/^(충청|충북|충남|대전|세종)/.test(address)) return "충청";
  if (/^(전라|전북|전남|광주)/.test(address)) return "전라";
  if (/^(경상|경북|경남|대구|부산|울산)/.test(address)) return "경상";
  if (address.startsWith("제주")) return "제주";
  return "전체지역";
}

/** 서울시청 — 현재위치를 못 받았을 때 지도 기본 중심 */
export const DEFAULT_CENTER: LatLng = { lat: 37.5665, lng: 126.978 };
