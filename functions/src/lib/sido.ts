/**
 * 주소 문자열 → 17개 시도 코드 (스키마 4번, 2-3).
 *
 * **Firestore는 문자열 부분일치 검색이 불가**하므로 지역 필터는 `location.address`가
 * 아니라 이 코드로 합니다. 저장은 반드시 **시도 단위**입니다 — 화면은 8개 권역으로
 * 묶어 보여주지만, 권역으로 저장하면 나중에 권역 구분을 바꿀 때 원본이 사라집니다.
 *
 * **매핑에 실패한 주소는 저장을 거부합니다(4번).** 빈 값으로 두면 그 프로그램은
 * 지역 필터 결과에서 영구히 누락되는데, 화면에는 정상 등록된 것처럼 보입니다.
 */

export type Sido =
  | "seoul"
  | "busan"
  | "daegu"
  | "incheon"
  | "gwangju"
  | "daejeon"
  | "ulsan"
  | "sejong"
  | "gyeonggi"
  | "gangwon"
  | "chungbuk"
  | "chungnam"
  | "jeonbuk"
  | "jeonnam"
  | "gyeongbuk"
  | "gyeongnam"
  | "jeju";

/**
 * 표기 변형을 함께 담습니다. 실제 주소는 "강원도"·"강원특별자치도"·"강원"이
 * 모두 나타납니다(2023~2024년 특별자치도 전환).
 *
 * **긴 이름을 먼저 검사해야 합니다.** "전북특별자치도"를 "전북"보다 뒤에 두면
 * 짧은 쪽이 먼저 걸려도 결과는 같지만, 다른 시도에서는 어긋날 수 있습니다.
 */
const ALIASES: ReadonlyArray<readonly [Sido, readonly string[]]> = [
  ["seoul", ["서울특별시", "서울시", "서울"]],
  ["busan", ["부산광역시", "부산시", "부산"]],
  ["daegu", ["대구광역시", "대구시", "대구"]],
  ["incheon", ["인천광역시", "인천시", "인천"]],
  ["gwangju", ["광주광역시", "광주시", "광주"]],
  ["daejeon", ["대전광역시", "대전시", "대전"]],
  ["ulsan", ["울산광역시", "울산시", "울산"]],
  ["sejong", ["세종특별자치시", "세종시", "세종"]],
  ["gyeonggi", ["경기도", "경기"]],
  ["gangwon", ["강원특별자치도", "강원도", "강원"]],
  ["chungbuk", ["충청북도", "충북"]],
  ["chungnam", ["충청남도", "충남"]],
  ["jeonbuk", ["전북특별자치도", "전라북도", "전북"]],
  ["jeonnam", ["전라남도", "전남"]],
  ["gyeongbuk", ["경상북도", "경북"]],
  ["gyeongnam", ["경상남도", "경남"]],
  ["jeju", ["제주특별자치도", "제주도", "제주"]],
];

/**
 * **주소의 맨 앞에서만** 찾습니다. 문자열 어디서나 찾으면 "경기도 광주시"가
 * 광주광역시로 잡히는 식의 오분류가 생깁니다. 한국 주소는 시도로 시작합니다.
 */
export function extractSido(address: string | null | undefined): Sido | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (trimmed.length === 0) return null;

  for (const [code, aliases] of ALIASES) {
    for (const alias of aliases) {
      if (trimmed.startsWith(alias)) return code;
    }
  }
  return null;
}

/**
 * 필터 UI의 8개 권역 → 시도 목록 (4번 매핑표).
 * 서버가 권역을 시도 목록으로 펼쳐 판정합니다. 화면 구분을 바꿔도 저장된
 * 데이터는 시도 단위라 손실이 없습니다.
 */
export const REGION_TO_SIDO: Readonly<Record<string, readonly Sido[]>> = {
  서울: ["seoul"],
  "경기·인천": ["gyeonggi", "incheon"],
  강원: ["gangwon"],
  충청: ["chungbuk", "chungnam", "daejeon", "sejong"],
  전라: ["jeonbuk", "jeonnam", "gwangju"],
  경상: ["gyeongbuk", "gyeongnam", "busan", "daegu", "ulsan"],
  제주: ["jeju"],
};
