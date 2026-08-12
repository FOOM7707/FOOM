// 날씨 정보 (프로토타입 — mock)
//
// TODO(연동): 기상청 공공데이터포털 "단기예보 조회서비스"(getVilageFcst)와
// "기상특보 조회서비스"로 교체합니다. 벤더 선정 문서 4번 참고.
//   - 호출은 반드시 Cloud Functions(`GET /external/weather`)를 경유합니다.
//     기상청 API 키를 프론트에 노출하면 안 되고, CORS도 막혀 있습니다.
//   - 좌표(lat/lng) → 기상청 격자(nx, ny) 변환이 필요합니다(Lambert Conformal Conic).
//   - 응답의 SKY(하늘상태)/PTY(강수형태)/TMP(기온)/POP(강수확률) 코드를
//     아래 WeatherSnapshot 형태로 정규화해서 내려주면 화면 코드는 그대로 씁니다.
//
// 날씨는 "참고용 정보 제공"이며 환불정책·자동취소와는 무관합니다.
// (대화기록 요약 1-4 정정 이력 참고 — 취소 여부는 공급자 재량)

import type { LatLng } from "./geo";

export type SkyCondition = "맑음" | "구름많음" | "흐림" | "비" | "눈";

export interface WeatherSnapshot {
  /** 표시용 지역명 */
  regionLabel: string;
  condition: SkyCondition;
  /** 섭씨 기온 */
  tempC: number;
  /** 강수확률 % (기상청 POP) */
  precipProbability: number;
  /** 기상특보 — 없으면 null */
  advisory: string | null;
  /** 참고용 한 줄 코멘트 */
  comment: string;
}

const ICONS: Record<SkyCondition, string> = {
  맑음: "☀️",
  구름많음: "⛅",
  흐림: "☁️",
  비: "🌧",
  눈: "🌨",
};

export function weatherIcon(condition: SkyCondition): string {
  return ICONS[condition];
}

/** 좌표+날짜로 항상 같은 값이 나오도록 만든 결정론적 해시 (mock 전용) */
function seedOf(point: LatLng, dateKey: string): number {
  const raw = `${point.lat.toFixed(2)},${point.lng.toFixed(2)},${dateKey}`;
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (h * 31 + raw.charCodeAt(i)) % 100000;
  }
  return h;
}

const CONDITIONS: SkyCondition[] = ["맑음", "맑음", "구름많음", "흐림", "비", "눈"];

/**
 * mock 날씨 스냅샷. 실제 API 대신 좌표·날짜 기반으로 그럴듯한 값을 만들어냅니다.
 * @param date 예보 기준일 (없으면 오늘)
 */
export function getMockWeather(
  point: LatLng,
  regionLabel: string,
  date?: Date
): WeatherSnapshot {
  const target = date ?? new Date();
  const dateKey = target.toISOString().slice(0, 10);
  const seed = seedOf(point, dateKey);
  const month = target.getMonth() + 1;

  // 눈은 12~2월에만 나오도록 (여름에 눈 예보가 뜨면 프로토타입이라도 이상해 보임)
  const pool = month >= 12 || month <= 2 ? CONDITIONS : CONDITIONS.slice(0, 5);
  const condition = pool[seed % pool.length];

  const seasonalBase = [2, 4, 10, 17, 22, 26, 28, 29, 24, 17, 10, 3][month - 1];
  const tempC = seasonalBase + (seed % 7) - 3;

  const precipProbability =
    condition === "비" || condition === "눈"
      ? 60 + (seed % 40)
      : condition === "흐림"
        ? 20 + (seed % 30)
        : seed % 20;

  // 특보는 강수확률이 매우 높을 때만 (전체의 소수만 걸리도록)
  const advisory =
    precipProbability >= 90 ? (condition === "눈" ? "대설주의보" : "강풍주의보") : null;

  const comment = advisory
    ? `${advisory} 발효 중 — 진행 여부를 운영자에게 확인하세요`
    : precipProbability >= 60
      ? "우천 가능성이 높습니다 — 우비·여벌옷을 준비하세요"
      : condition === "맑음"
        ? "야외 프로그램 진행에 좋은 날씨입니다"
        : "야외 활동에 무리 없는 날씨입니다";

  return { regionLabel, condition, tempC, precipProbability, advisory, comment };
}
