/**
 * 날씨 조회 (스키마 16번) — 격자 변환 · 캐싱 · 기상청 호출을 묶습니다.
 *
 * **캐시가 이 설계의 전부입니다(16-1).** 기상청 단기예보는 하루 8번만 발표되므로
 * 그 사이에는 몇 번을 물어도 같은 값이 돌아옵니다. 격자(5km 칸) 단위로 발표본을
 * 한 번만 받아 저장하면, 호출 수가 **방문자 수가 아니라 격자 수에 비례**합니다.
 * 캐시가 없으면 상세 화면을 열 때마다 기상청을 부르게 되고 무료 한도를 넘습니다.
 *
 * 기상청 호출부는 주입 지점(`KmaPort`)으로 빼뒀습니다 — 네이버 로그인과 같은
 * 방식입니다. 키 없이도 캐시·정규화·범위 판정을 전부 테스트할 수 있습니다.
 */

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { isInKorea, toKmaGrid, type KmaGrid } from "./kmaGrid";
import {
  isWithinForecastRange,
  kstDateKey,
  latestBaseTime,
  summarizeDay,
  type BaseTime,
  type FcstItem,
  type SkyCondition,
  type WeatherSnapshot,
} from "./kmaWeather";

/** 기상청 호출부. 테스트에서 갈아끼웁니다. */
export interface KmaPort {
  fetchVilageFcst(base: BaseTime, grid: KmaGrid): Promise<FcstItem[]>;
}

export interface WeatherDeps {
  db: Firestore;
  kmaPort: KmaPort;
  /** 테스트에서 시각을 고정하기 위한 주입 지점 */
  now?: () => Date;
}

/** 캐시에는 표시용 이름을 넣지 않습니다 — 같은 격자를 여러 지역명이 공유합니다. */
interface CachedDay {
  condition: SkyCondition;
  tempC: number;
  precipProbability: number;
}

export type WeatherUnavailableReason = "out_of_range" | "out_of_area" | "unavailable";

export interface WeatherResult {
  weather: WeatherSnapshot | null;
  /** weather가 null인 이유. 화면이 안내 문구를 고르는 근거입니다 */
  reason: WeatherUnavailableReason | null;
  /** 캐시에서 나왔는지 — 운영 중 캐시가 실제로 먹히는지 확인용 */
  cached: boolean;
}

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 발표 주기와 같은 3시간(16-1)

function cacheDocId(grid: KmaGrid, base: BaseTime): string {
  return `${grid.nx}_${grid.ny}_${base.baseDate}${base.baseTime}`;
}

/** 발표본 하나에서 향후 며칠분을 한꺼번에 요약해 저장합니다 — 날짜마다 다시 부르지 않도록. */
function summarizeAll(items: FcstItem[]): Record<string, CachedDay> {
  const dates = [...new Set(items.map((i) => i.fcstDate))];
  const out: Record<string, CachedDay> = {};

  for (const date of dates) {
    // regionLabel은 캐시에 넣지 않으므로 자리표시자를 넘깁니다.
    const day = summarizeDay(items, date, "");
    if (day) {
      out[date] = {
        condition: day.condition,
        tempC: day.tempC,
        precipProbability: day.precipProbability,
      };
    }
  }
  return out;
}

function toSnapshot(day: CachedDay, regionLabel: string): WeatherSnapshot {
  const advisory: string | null = null; // 기상특보는 별도 API (16번 TODO)
  const comment =
    day.precipProbability >= 60
      ? "우천 가능성이 높습니다 — 우비·여벌옷을 준비하세요"
      : day.condition === "맑음"
        ? "야외 프로그램 진행에 좋은 날씨입니다"
        : "야외 활동에 무리 없는 날씨입니다";

  return { regionLabel, ...day, advisory, comment };
}

export interface WeatherQuery {
  lat: number;
  lng: number;
  regionLabel: string;
  /** 조회할 날짜. 없으면 오늘 */
  date?: Date;
}

/**
 * 실패해도 예외를 던지지 않고 `weather: null`을 돌려주는 이유(16-3):
 * **날씨는 참고용이고 화면 렌더링을 막지 않아야 합니다.** 기상청은 간헐적으로
 * 빈 응답이나 오류를 주는데, 그때마다 5xx를 던지면 프로그램 상세 화면 전체가
 * 실패한 것처럼 보입니다. 프론트도 분기를 두 갈래로 만들 필요가 없습니다.
 */
export async function getWeather(
  query: WeatherQuery,
  deps: WeatherDeps
): Promise<WeatherResult> {
  const now = deps.now?.() ?? new Date();
  const target = query.date ?? now;

  if (!isInKorea(query.lat, query.lng)) {
    return { weather: null, reason: "out_of_area", cached: false };
  }
  if (!isWithinForecastRange(target, now)) {
    // 한 달 뒤 회차에 억지 예보를 붙이지 않습니다 — 부정확한 정보가 오해를 부릅니다(16-2).
    return { weather: null, reason: "out_of_range", cached: false };
  }

  const grid = toKmaGrid(query.lat, query.lng);
  const base = latestBaseTime(now);
  const targetKey = kstDateKey(target);
  const ref = deps.db.doc(`weatherCache/${cacheDocId(grid, base)}`);

  const snap = await ref.get();
  if (snap.exists) {
    const days = (snap.get("days") ?? {}) as Record<string, CachedDay>;
    const day = days[targetKey];
    if (day) {
      return { weather: toSnapshot(day, query.regionLabel), reason: null, cached: true };
    }
    // 발표본은 받았는데 그 날짜가 없는 경우 — 예보 범위 밖입니다.
    return { weather: null, reason: "out_of_range", cached: true };
  }

  let items: FcstItem[];
  try {
    items = await deps.kmaPort.fetchVilageFcst(base, grid);
  } catch (err) {
    console.error("[weather] 기상청 호출 실패", err);
    return { weather: null, reason: "unavailable", cached: false };
  }

  const days = summarizeAll(items);
  if (Object.keys(days).length === 0) {
    // 빈 응답을 캐시하면 3시간 동안 계속 빈 값을 돌려줍니다. 저장하지 않습니다.
    return { weather: null, reason: "unavailable", cached: false };
  }

  await ref.set({
    nx: grid.nx,
    ny: grid.ny,
    baseDate: base.baseDate,
    baseTime: base.baseTime,
    days,
    createdAt: FieldValue.serverTimestamp(),
    // Firestore TTL 정책이 이 필드를 보고 자동 삭제합니다(콘솔에서 1회 설정 — 16-1).
    expiresAt: Timestamp.fromMillis(now.getTime() + CACHE_TTL_MS),
  });

  const day = days[targetKey];
  if (!day) return { weather: null, reason: "out_of_range", cached: false };

  return { weather: toSnapshot(day, query.regionLabel), reason: null, cached: false };
}

/** 요청 파라미터 검증. 좌표가 없으면 격자를 만들 수 없습니다. */
export function parseWeatherQuery(raw: Record<string, unknown>): WeatherQuery {
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError("invalid-argument", "좌표(lat, lng)가 필요합니다");
  }

  let date: Date | undefined;
  if (typeof raw.date === "string" && raw.date.trim() !== "") {
    const parsed = new Date(raw.date);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError("invalid-argument", "date 형식이 올바르지 않습니다");
    }
    date = parsed;
  }

  const label = typeof raw.regionLabel === "string" ? raw.regionLabel.trim() : "";

  return {
    lat,
    lng,
    regionLabel: label.length > 0 ? label.slice(0, 40) : "현재 위치",
    date,
  };
}
