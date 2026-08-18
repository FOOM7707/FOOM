/**
 * 기상청 단기예보 해석 (스키마 16번).
 *
 * 하는 일 셋입니다.
 *   ① 지금 시각으로 **어느 발표본을 받아야 하는지** 계산 (16-1)
 *   ② 기상청 응답(코드 덩어리)을 화면이 쓰는 한 줄 요약으로 정규화
 *   ③ 예보가 없는 기간을 구분 (16-2)
 *
 * **시각 계산은 반드시 한국시간(KST) 기준입니다.** Cloud Functions는 UTC로
 * 돕니다 — 서버 시각을 그대로 쓰면 9시간 어긋난 발표본을 요청하게 되고,
 * 에러가 아니라 "왜 어제 예보가 나오지" 로 나타납니다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 단기예보 발표 시각 — 하루 8번뿐입니다(16-1). 그 사이에는 값이 바뀌지 않습니다. */
const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

/** 발표 직후에는 아직 자료가 없습니다. 10분 지나서 요청합니다. */
const PUBLISH_DELAY_MIN = 10;

/** 단기예보가 닿는 범위. 그 뒤는 안내 문구로 대체합니다(16-2). */
export const FORECAST_RANGE_DAYS = 3;

export type SkyCondition = "맑음" | "구름많음" | "흐림" | "비" | "눈";

/** 프론트의 WeatherSnapshot과 같은 모양입니다. 여기가 원본입니다. */
export interface WeatherSnapshot {
  regionLabel: string;
  condition: SkyCondition;
  tempC: number;
  precipProbability: number;
  advisory: string | null;
  comment: string;
}

export interface BaseTime {
  /** YYYYMMDD (KST) */
  baseDate: string;
  /** HHMM */
  baseTime: string;
}

function toKst(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/** KST 기준 YYYYMMDD. Date의 UTC 게터를 쓰는 것은 이미 9시간을 더했기 때문입니다. */
export function kstDateKey(date: Date): string {
  const k = toKst(date);
  const y = k.getUTCFullYear();
  const m = String(k.getUTCMonth() + 1).padStart(2, "0");
  const d = String(k.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * 지금 받을 수 있는 **가장 최근 발표본**.
 *
 * 02:10 이전에는 당일 발표본이 아직 없으므로 전날 23시 발표본을 씁니다.
 */
export function latestBaseTime(now: Date): BaseTime {
  const k = toKst(now);
  const minutes = k.getUTCHours() * 60 + k.getUTCMinutes() - PUBLISH_DELAY_MIN;

  for (let i = BASE_HOURS.length - 1; i >= 0; i -= 1) {
    const hour = BASE_HOURS[i];
    if (minutes >= hour * 60) {
      return {
        baseDate: kstDateKey(now),
        baseTime: `${String(hour).padStart(2, "0")}00`,
      };
    }
  }

  // 자정~02:10 — 전날 23시 발표본
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return { baseDate: kstDateKey(yesterday), baseTime: "2300" };
}

/** 예보가 닿는 날짜인가 (16-2). 지난 날짜도 대상이 아닙니다. */
export function isWithinForecastRange(target: Date, now: Date): boolean {
  const todayKey = kstDateKey(now);
  const targetKey = kstDateKey(target);
  if (targetKey < todayKey) return false;

  const limit = new Date(now.getTime() + FORECAST_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return targetKey <= kstDateKey(limit);
}

export interface FcstItem {
  category: string;
  fcstDate: string;
  fcstTime: string;
  fcstValue: string;
}

// 나쁜 순서대로. 낮 동안 한 번이라도 비가 오면 야외 프로그램에는 영향이 있으므로
// 구간 안에서 **가장 나쁜 상태**를 대표값으로 씁니다.
const SEVERITY: SkyCondition[] = ["맑음", "구름많음", "흐림", "비", "눈"];

function skyOf(code: string): SkyCondition {
  if (code === "1") return "맑음";
  if (code === "3") return "구름많음";
  return "흐림"; // 4
}

function ptyOf(code: string): SkyCondition | null {
  // 단기예보 강수형태: 0 없음 / 1 비 / 2 비·눈 / 3 눈 / 4 소나기
  if (code === "3") return "눈";
  if (code === "1" || code === "2" || code === "4") return "비";
  return null;
}

function worse(a: SkyCondition, b: SkyCondition): SkyCondition {
  return SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;
}

function commentFor(
  condition: SkyCondition,
  precipProbability: number,
  advisory: string | null
): string {
  if (advisory) return `${advisory} 발효 중 — 진행 여부를 운영자에게 확인하세요`;
  if (precipProbability >= 60) return "우천 가능성이 높습니다 — 우비·여벌옷을 준비하세요";
  if (condition === "맑음") return "야외 프로그램 진행에 좋은 날씨입니다";
  return "야외 활동에 무리 없는 날씨입니다";
}

/**
 * 응답 항목 → 하루 한 줄 요약.
 *
 * **낮 시간대(09~18시)만 봅니다.** 프로그램이 진행되는 시간이고, 새벽 기온까지
 * 섞으면 "10도"처럼 참가자에게 쓸모없는 값이 나옵니다. 기온은 그 구간의 최고,
 * 강수확률은 최대, 하늘상태는 가장 나쁜 것을 씁니다.
 *
 * 대상일 항목이 아예 없으면 null입니다 — 화면은 안내 문구로 대체합니다(16-2).
 */
export function summarizeDay(
  items: FcstItem[],
  targetDateKey: string,
  regionLabel: string
): WeatherSnapshot | null {
  const sameDay = items.filter((i) => i.fcstDate === targetDateKey);
  if (sameDay.length === 0) return null;

  const daytime = sameDay.filter((i) => {
    const hour = Number(i.fcstTime.slice(0, 2));
    return hour >= 9 && hour <= 18;
  });
  // 이미 저녁이라 낮 예보가 남아 있지 않은 경우엔 남은 항목으로 채웁니다.
  const scope = daytime.length > 0 ? daytime : sameDay;

  let tempC: number | null = null;
  let precipProbability = 0;
  let sky: SkyCondition | null = null;
  let pty: SkyCondition | null = null;

  for (const item of scope) {
    const raw = item.fcstValue;
    switch (item.category) {
      case "TMP": {
        const v = Number(raw);
        if (Number.isFinite(v)) tempC = tempC == null ? v : Math.max(tempC, v);
        break;
      }
      case "POP": {
        const v = Number(raw);
        if (Number.isFinite(v)) precipProbability = Math.max(precipProbability, v);
        break;
      }
      case "SKY": {
        const v = skyOf(raw);
        sky = sky == null ? v : worse(sky, v);
        break;
      }
      case "PTY": {
        const v = ptyOf(raw);
        if (v) pty = pty == null ? v : worse(pty, v);
        break;
      }
      default:
        break;
    }
  }

  if (tempC == null && sky == null && pty == null) return null;

  // 강수형태가 있으면 그게 하늘상태보다 우선입니다 — "흐림"보다 "비"가 중요합니다.
  const condition = pty ?? sky ?? "흐림";

  // TODO(16번): 기상특보는 별도 API(기상특보 조회서비스)입니다. 활용신청이
  //   따로 필요해 1단계에서는 항상 null이고, 붙이면 이 값만 채워집니다.
  const advisory: string | null = null;

  return {
    regionLabel,
    condition,
    tempC: tempC == null ? 0 : Math.round(tempC),
    precipProbability,
    advisory,
    comment: commentFor(condition, precipProbability, advisory),
  };
}
