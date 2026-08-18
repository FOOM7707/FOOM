/**
 * 위경도 → 기상청 격자(nx, ny) 변환 (스키마 16-3).
 *
 * **기상청은 위경도를 받지 않습니다.** 전국을 5km 칸으로 나눈 자체 격자 좌표만
 * 받으므로, 프로그램의 좌표를 격자로 바꿔야 조회가 됩니다.
 *
 * 이 격자가 캐시 단위이기도 합니다(16-1) — 같은 칸에 있는 프로그램들은 예보가
 * 같으므로 캐시 하나를 나눠 씁니다. 그래서 호출 수가 방문자 수가 아니라
 * **격자 수에 비례**합니다.
 *
 * 변환식은 기상청이 배포하는 람베르트 정각원추도법(Lambert Conformal Conic)
 * 상수를 그대로 씁니다. 상수를 임의로 바꾸면 조용히 엉뚱한 지역 예보가 나옵니다 —
 * 에러가 아니라 "옆 동네 날씨"로 나타나므로 눈치채기 어렵습니다.
 */

const RE = 6371.00877; // 지구 반경(km)
const GRID = 5.0; // 격자 간격(km)
const SLAT1 = 30.0; // 표준 위도 1
const SLAT2 = 60.0; // 표준 위도 2
const OLON = 126.0; // 기준점 경도
const OLAT = 38.0; // 기준점 위도
const XO = 43; // 기준점 X 격자
const YO = 136; // 기준점 Y 격자

const DEGRAD = Math.PI / 180.0;

export interface KmaGrid {
  nx: number;
  ny: number;
}

/** 한반도 범위를 크게 벗어난 좌표는 격자로 바꿔도 의미가 없습니다. */
export function isInKorea(lat: number, lng: number): boolean {
  return lat >= 32 && lat <= 40 && lng >= 124 && lng <= 132;
}

export function toKmaGrid(lat: number, lng: number): KmaGrid {
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn =
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);

  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;

  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);

  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}
