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

/**
 * 날씨에 붙일 지역 이름 — **동 단위까지** (v29).
 *
 * 「경기」로는 내 날씨인지 알 수 없습니다. 저장된 주소에 이미 동이 들어 있으므로
 * (등록 화면에서 주소를 **검색해서 고르고** 지번 주소로 저장합니다 — 19-2) 여기서
 * 뽑아 씁니다. **API를 부르지 않습니다.**
 *
 * 규칙은 「앞의 시도와 뒤의 번지를 떼고 남는 것」입니다. 동 이름 목록을 갖고
 * 맞춰보는 방식이 아니라, 붙였다 뗐다 하는 규칙이라 **모르는 지명에도 그냥 됩니다.**
 *
 * | 저장된 주소 | 표시 |
 * |---|---|
 * | 경기도 수원시 팔달구 화서동 123-4 | 수원시 팔달구 화서동 |
 * | 서울특별시 중구 신당동 10 | 중구 신당동 |
 * | 경기도 수원시 팔달구 화서로 12 | 수원시 팔달구 화서로 |
 * | 세종특별자치시 고운동 | 고운동 |
 *
 * **도로명 주소로 저장된 프로그램은 동이 없어** 「시·군·구 + 도로명」이 됩니다. 「경기」
 * 보다는 낫지만 동은 아닙니다 — 주소 검색이 지번을 우선 저장하므로 흔하지는 않습니다.
 *
 * 뽑을 것이 없으면 광역 라벨(`regionOfAddress`)로 떨어집니다. **표시용이라 틀려도
 * 예보 값에는 영향이 없습니다** — 예보는 좌표에서 계산한 격자로 받습니다(16-1).
 */
export function localityOfAddress(address: string): string {
  const tokens = (address ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return fallbackLabel(address ?? "");

  // 앞의 시도를 뗍니다. 세종특별자치시처럼 시·군·구가 없는 곳은 이걸 떼면
  // 바로 동이 남습니다.
  const head = tokens[0];
  const body =
    /(특별시|광역시|특별자치시|특별자치도|(^|[^시])도)$/.test(head) || /^[가-힣]{2}도$/.test(head)
      ? tokens.slice(1)
      : tokens;

  // 뒤의 번지·건물번호를 뗍니다. 숫자가 섞인 토큰(123-4, 12, 산25)이 대상입니다.
  const named = body.filter((t) => !/\d/.test(t));
  if (named.length === 0) return fallbackLabel(address);

  // 세 칸까지만 씁니다. 뒤에서 세는 이유: 시도가 짧은 형태(「경기 수원시 …」)로
  // 저장돼 앞에서 떼지 못한 경우에도 **가장 좁은 쪽 세 칸**이 남습니다.
  return named.slice(-3).join(" ");
}

/** 주소에서 아무것도 뽑지 못한 경우 — 「전체지역」은 날씨 라벨로 읽히지 않습니다 */
function fallbackLabel(address: string): string {
  const region = regionOfAddress(address);
  return region === "전체지역" ? "진행 장소" : region;
}

/** 서울시청 — 현재위치를 못 받았을 때 지도 기본 중심 */
export const DEFAULT_CENTER: LatLng = { lat: 37.5665, lng: 126.978 };
