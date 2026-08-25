import { Cloud, CloudRain, CloudSnow, CloudSun, Sun, type LucideIcon } from "lucide-react";
/**
 * 날씨 정보 (스키마 16번).
 *
 * **기상청을 직접 부르지 않습니다.** API 키가 노출되고, 기상청 서버가 CORS를
 * 막아 요청 자체가 거부됩니다. `GET /external/weather`(Cloud Functions)만 부릅니다.
 *
 * 날씨는 **참고용**이며 환불정책·자동취소와 무관합니다. 우천 시 진행 여부는
 * 공급자 재량입니다.
 */

import { apiFetch } from "./api";
import type { LatLng } from "./geo";

export type SkyCondition = "맑음" | "구름많음" | "흐림" | "비" | "눈";

export interface WeatherSnapshot {
  /** 표시용 지역명 */
  regionLabel: string;
  condition: SkyCondition;
  /** 섭씨 기온 — 진행 시간대(낮) 기준 */
  tempC: number;
  /** 강수확률 % (기상청 POP) */
  precipProbability: number;
  /** 기상특보 — 없으면 null */
  advisory: string | null;
  /** 참고용 한 줄 코멘트 */
  comment: string;
}

export type WeatherUnavailableReason = "out_of_range" | "out_of_area" | "unavailable";

export interface WeatherResult {
  weather: WeatherSnapshot | null;
  reason: WeatherUnavailableReason | null;
  cached: boolean;
}

/**
 * 하늘 상태 아이콘 — 이모지 대신 선 아이콘 한 세트(lucide)로 통일했습니다.
 * 이모지는 기기·브라우저마다 모양과 크기가 달라 같은 줄의 글자와 높이가 안 맞고,
 * 화면 곳곳의 다른 아이콘과 섞이면 정리가 안 된 인상을 줍니다.
 */
const ICONS: Record<SkyCondition, LucideIcon> = {
  맑음: Sun,
  구름많음: CloudSun,
  흐림: Cloud,
  비: CloudRain,
  눈: CloudSnow,
};

export function weatherIcon(condition: SkyCondition): LucideIcon {
  return ICONS[condition];
}

/** 예보가 없을 때 화면에 띄우는 문구 (16-2) */
export function unavailableMessage(reason: WeatherUnavailableReason | null): string {
  switch (reason) {
    case "out_of_range":
      // 단기예보는 3~4일까지입니다. 한 달 뒤 날씨를 억지로 보여주지 않습니다.
      return "진행일이 가까워지면 예보가 표시됩니다";
    case "out_of_area":
      return "예보를 제공하지 않는 지역입니다";
    default:
      return "날씨 정보를 잠시 불러올 수 없습니다";
  }
}

function dateKeyOf(date?: Date): string {
  return (date ?? new Date()).toISOString().slice(0, 10);
}

/**
 * 같은 좌표·날짜를 여러 위젯이 동시에 물어보는 것을 막습니다.
 *
 * 프로그램 상세는 회차마다 위젯을 그리므로, 이게 없으면 화면 한 번 여는 데
 * 요청이 회차 수만큼 나갑니다. 서버도 격자 단위로 캐시하지만(16-1) 왕복 자체를
 * 줄이는 게 낫습니다. 진행 중인 요청을 공유하는 방식이라 값이 갈리지 않습니다.
 */
const inflight = new Map<string, Promise<WeatherResult>>();

export function fetchWeather(
  point: LatLng,
  regionLabel: string,
  date?: Date
): Promise<WeatherResult> {
  const key = `${point.lat.toFixed(2)},${point.lng.toFixed(2)},${dateKeyOf(date)}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const params = new URLSearchParams({
    lat: String(point.lat),
    lng: String(point.lng),
    regionLabel,
  });
  if (date) params.set("date", date.toISOString());

  const request = apiFetch<WeatherResult>(`/external/weather?${params.toString()}`)
    .catch((): WeatherResult => {
      // 서버 오류로 화면이 깨지지 않게 합니다 — 날씨는 참고용입니다(16-3).
      return { weather: null, reason: "unavailable", cached: false };
    })
    .finally(() => {
      // 응답이 오면 캐시에서 뺍니다. 결과 캐싱은 서버와 브라우저 HTTP 캐시가 맡습니다.
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}
