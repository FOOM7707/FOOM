/**
 * 주소·장소 검색 → 좌표 (스키마 5번 「외부 연동」 · 16-4).
 *
 * **이 경로가 생기기 전까지 프로그램에는 좌표가 없었습니다.** 등록 화면이 주소를
 * 문자열로만 받았기 때문에 `location.lat`/`lng`가 계속 null이었고, 그래서 상세 화면의
 * 날씨 위젯이 실제 등록된 프로그램에서는 항상 「예보를 제공하지 않는 지역입니다」로
 * 떴습니다(16-4). 날씨는 좌표가 있어야만 붙습니다 — 기상청은 주소를 받지 않습니다.
 *
 * 좌표를 얻는 김에 **주소 문자열도 카카오가 준 정식 표기로 바꿔 저장**합니다.
 * 공급자가 손으로 "홍천군 서면"이라고 적으면 `extractSido`가 시도를 못 뽑아 등록이
 * 거부되는데(4번), 카카오 결과는 항상 시도로 시작하므로 이 문제가 함께 없어집니다.
 *
 * 카카오 호출부는 주입 지점(`KakaoLocalPort`)으로 빼뒀습니다 — 기상청·네이버와 같은
 * 방식입니다. **키 없이도 좌표 파싱·검증·정렬을 전부 테스트할 수 있습니다.**
 */

import { AppError } from "./errors";
import { isInKorea } from "./kmaGrid";
import { extractSido, type Sido } from "./sido";

/**
 * 카카오 응답 문서에서 우리가 쓰는 필드만 추린 모양.
 *
 * **`x`/`y`를 문자열 그대로 들고 옵니다.** 카카오가 문자열로 주기도 하고, 숫자 변환과
 * 범위 검증이 이 파일에서 테스트되게 하려는 의도이기도 합니다 — 좌표를 다루는 코드는
 * 틀려도 에러가 안 나고 "엉뚱한 위치"로만 나타나서 눈으로는 못 잡습니다(16-4 ②와 같은 함정).
 */
export interface KakaoPlaceDoc {
  /** 지번 주소. 시도로 시작합니다 — `sido` 파생의 원본 */
  addressName: string;
  /** 도로명 주소. 없는 곳도 있습니다(신규 조성지·임야 등) */
  roadAddressName: string | null;
  /** 장소명. 키워드 검색 결과에만 있습니다 */
  placeName: string | null;
  /** 경도(longitude). **카카오는 x가 경도입니다** */
  x: string;
  /** 위도(latitude). **y가 위도입니다** */
  y: string;
}

/** 카카오 로컬 API 호출부. 테스트에서 갈아끼웁니다. */
export interface KakaoLocalPort {
  /** 주소 검색 — 정확한 주소를 넣었을 때만 결과가 나옵니다 */
  searchAddress(query: string): Promise<KakaoPlaceDoc[]>;
  /** 키워드(장소) 검색 — "국립산음자연휴양림" 같은 이름으로 찾습니다 */
  searchKeyword(query: string): Promise<KakaoPlaceDoc[]>;
}

export interface Place {
  /** 저장·표시용 주소(지번). `programs.location.address`에 그대로 들어갑니다 */
  address: string;
  roadAddress: string | null;
  placeName: string | null;
  lat: number;
  lng: number;
  /**
   * 주소에서 뽑은 시도 코드.
   *
   * **null이면 이 결과로는 프로그램을 등록할 수 없습니다** — 서버가 저장을 거부합니다(4번).
   * 걸러내지 않고 내려보내는 이유는, 조용히 빼면 화면에 "검색은 되는데 결과가 안 보인다"로
   * 나타나 원인을 찾을 수 없기 때문입니다. 화면에서 선택을 막고 이유를 알려줍니다.
   */
  sido: Sido | null;
}

export interface PlaceSearchResult {
  places: Place[];
  /** 어느 검색으로 나온 결과인지 — 화면 문구와 운영 확인용 */
  source: "address" | "keyword" | "none";
  /** 상한(MAX_RESULTS)에 걸려 잘렸는지. 조용히 자르면 "이게 전부"로 읽힙니다 */
  truncated: boolean;
}

/**
 * 한 번에 내려보내는 최대 개수.
 *
 * 카카오는 최대 45건까지 주지만, 등록 화면은 목록에서 하나를 고르는 자리라 10건이면
 * 충분합니다. 그보다 많으면 고르는 쪽이 오히려 어려워집니다.
 */
const MAX_RESULTS = 10;

/** 검색어 길이 상한 — 카카오 쪽 제한이 아니라 우리 쿼터를 지키기 위한 값입니다. */
const MAX_QUERY_LENGTH = 100;

export function parsePlaceQuery(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AppError("invalid-argument", "검색어를 입력해 주세요");
  }
  const query = raw.trim();
  if (query.length < 2) {
    throw new AppError("invalid-argument", "검색어를 두 글자 이상 입력해 주세요");
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new AppError("invalid-argument", "검색어가 너무 깁니다");
  }
  return query;
}

/**
 * 카카오 문서 하나 → `Place`. **변환할 수 없으면 null을 돌려주고 결과에서 뺍니다.**
 *
 * 좌표를 버리는 경우가 둘 있습니다.
 *  ① 숫자로 못 읽는 값 — 응답 형식이 바뀌었거나 빈 값
 *  ② 한반도 범위 밖 — 국외 지점이거나 **x/y를 바꿔 읽은 경우**
 *
 * ②가 이 검사를 넣은 진짜 이유입니다. 경도(126)를 위도로 읽으면 지도에는 아무 데도
 * 없는 지점이 찍히는데 예외는 안 납니다. 범위로 걸러내면 그 실수가 "결과 없음"으로
 * 드러나서 최소한 알아챌 수는 있습니다.
 */
export function toPlace(doc: KakaoPlaceDoc): Place | null {
  const lng = Number(doc.x);
  const lat = Number(doc.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!isInKorea(lat, lng)) return null;

  const address = (doc.addressName ?? "").trim();
  const road = (doc.roadAddressName ?? "").trim();
  const place = (doc.placeName ?? "").trim();

  // 주소가 비면 저장할 값이 없습니다 — 좌표만으로는 프로그램을 만들 수 없습니다.
  if (address.length === 0 && road.length === 0) return null;

  return {
    address: address.length > 0 ? address : road,
    roadAddress: road.length > 0 ? road : null,
    placeName: place.length > 0 ? place : null,
    lat,
    lng,
    sido: extractSido(address.length > 0 ? address : road),
  };
}

/** 같은 지점이 주소·키워드 양쪽에서 나올 수 있어 주소+좌표로 한 번 걸러냅니다. */
function dedupe(places: Place[]): Place[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    const key = `${p.address}|${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 주소 검색 → (결과 없으면) 키워드 검색.
 *
 * **두 번 부르지 않고 한 번으로 끝내는 이유:** 등록 화면의 입력칸은 「주소」라 대부분
 * 주소가 들어옵니다. 다만 산림 프로그램은 "국립산음자연휴양림"처럼 장소명으로 부르는
 * 곳이 많은데, 주소 검색은 그런 이름에 0건을 돌려줍니다. 그래서 0건일 때만 키워드
 * 검색으로 넘어갑니다 — 항상 둘 다 부르면 호출이 두 배가 되고 응답도 그만큼 느려집니다.
 */
export async function searchPlaces(
  query: string,
  deps: { port: KakaoLocalPort }
): Promise<PlaceSearchResult> {
  const byAddress = await deps.port.searchAddress(query);
  let docs = byAddress;
  let source: PlaceSearchResult["source"] = "address";

  if (docs.length === 0) {
    docs = await deps.port.searchKeyword(query);
    source = "keyword";
  }

  const places = dedupe(docs.map(toPlace).filter((p): p is Place => p !== null));

  return {
    places: places.slice(0, MAX_RESULTS),
    source: places.length > 0 ? source : "none",
    truncated: places.length > MAX_RESULTS,
  };
}
